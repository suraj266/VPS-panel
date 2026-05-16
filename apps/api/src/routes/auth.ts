import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { verifyPassword, generateSessionId } from "../lib/crypto.js";
import { SESSION_COOKIE } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";
import {
  generateTotpSecret,
  buildOtpAuthUrl,
  buildQrDataUrl,
  verifyTotp,
} from "../lib/totp.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      await recordAudit(req, {
        action: "auth.login.failed",
        targetType: "email",
        targetId: body.email,
      });
      return reply.code(401).send({ error: "invalid credentials" });
    }

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
      await recordAudit(req, {
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        actorId: user.id,
      });
      return reply.code(401).send({ error: "invalid credentials" });
    }

    if (user.totpEnabled) {
      if (!body.totpCode) {
        return reply
          .code(401)
          .send({ error: "TOTP code required", needsTotp: true });
      }
      if (!user.totpSecret || !verifyTotp(user.totpSecret, body.totpCode)) {
        await recordAudit(req, {
          action: "auth.login.failed",
          targetType: "user",
          targetId: user.id,
          actorId: user.id,
          diff: { reason: "bad totp" },
        });
        return reply
          .code(401)
          .send({ error: "invalid TOTP code", needsTotp: true });
      }
    }

    const sid = generateSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: { id: sid, userId: user.id, expiresAt },
    });

    // `secure: true` cookies are rejected by browsers over plain HTTP. Base the
    // flag on whether the operator-configured canonical URL is https, NOT on
    // NODE_ENV alone — a production deploy reachable only over HTTP (e.g.
    // before the operator has set up a domain + Let's Encrypt) must use
    // non-secure cookies, otherwise login bounces back to the form.
    const panelOrigin = process.env.PANEL_ORIGIN ?? "";
    const useSecureCookies = panelOrigin.startsWith("https://");

    reply.setCookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
      secure: useSecureCookies,
    });

    await recordAudit(req, {
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      actorId: user.id,
    });

    return { id: user.id, email: user.email, role: user.role };
  });

  app.post("/auth/logout", async (req, reply) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (sid) {
      const session = await prisma.session
        .findUnique({ where: { id: sid } })
        .catch(() => null);
      await prisma.session.delete({ where: { id: sid } }).catch(() => {});
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      if (session) {
        await recordAudit(req, {
          action: "auth.logout",
          targetType: "user",
          targetId: session.userId,
          actorId: session.userId,
        });
      }
    }
    return { ok: true };
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthorized" });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        role: true,
        totpEnabled: true,
      },
    });
    return user;
  });

  app.post("/auth/2fa/setup", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthorized" });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
    });
    if (user.totpEnabled) {
      return reply.code(400).send({ error: "2FA already enabled" });
    }

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnabled: false },
    });

    const otpauthUrl = buildOtpAuthUrl(secret, user.email);
    const qrDataUrl = await buildQrDataUrl(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
  });

  const enableSchema = z.object({ token: z.string().min(6) });

  app.post("/auth/2fa/enable", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthorized" });
    const { token } = enableSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
    });
    if (!user.totpSecret) {
      return reply
        .code(400)
        .send({ error: "run /auth/2fa/setup first to get a secret" });
    }
    if (!verifyTotp(user.totpSecret, token)) {
      return reply.code(400).send({ error: "invalid code" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });
    await recordAudit(req, {
      action: "auth.2fa.enable",
      targetType: "user",
      targetId: user.id,
    });
    return { ok: true };
  });

  const disableSchema = z.object({
    password: z.string().min(1),
    token: z.string().optional(),
  });

  app.post("/auth/2fa/disable", async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: "unauthorized" });
    const body = disableSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.userId },
    });
    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) return reply.code(401).send({ error: "wrong password" });
    if (
      user.totpEnabled &&
      user.totpSecret &&
      (!body.token || !verifyTotp(user.totpSecret, body.token))
    ) {
      return reply.code(401).send({ error: "TOTP required to disable" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    await recordAudit(req, {
      action: "auth.2fa.disable",
      targetType: "user",
      targetId: user.id,
    });
    return { ok: true };
  });
};
