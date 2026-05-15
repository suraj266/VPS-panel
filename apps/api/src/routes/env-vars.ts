import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { recordAudit } from "../lib/audit.js";

const appIdParam = z.object({ appId: z.string().min(1) });

const envVarSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z_][A-Z0-9_]*$/, "key must be UPPER_SNAKE_CASE"),
  value: z.string().max(8192),
  isSecret: z.boolean().default(false),
});

const setManySchema = z.object({
  vars: z.array(envVarSchema),
});

export const envVarRoutes: FastifyPluginAsync = async (app) => {
  app.get("/apps/:appId/env", async (req) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const vars = await prisma.envVar.findMany({
      where: { appId },
      orderBy: { key: "asc" },
    });
    return vars.map((v) => ({
      id: v.id,
      key: v.key,
      isSecret: v.isSecret,
      value: v.isSecret ? null : decrypt(v.valueEncrypted),
    }));
  });

  app.get("/apps/:appId/env/:id/reveal", async (req, reply) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const v = await prisma.envVar.findUnique({ where: { id } });
    if (!v || v.appId !== appId) {
      return reply.code(404).send({ error: "not found" });
    }
    return { value: decrypt(v.valueEncrypted) };
  });

  app.put("/apps/:appId/env", async (req) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { vars } = setManySchema.parse(req.body);

    await prisma.$transaction(async (tx) => {
      await tx.envVar.deleteMany({ where: { appId } });
      if (vars.length === 0) return;
      await tx.envVar.createMany({
        data: vars.map((v) => ({
          appId,
          key: v.key,
          valueEncrypted: encrypt(v.value),
          isSecret: v.isSecret,
        })),
      });
    });

    await recordAudit(req, {
      action: "env.set",
      targetType: "app",
      targetId: appId,
      diff: { keys: vars.map((v) => v.key), count: vars.length },
    });

    return { ok: true, count: vars.length };
  });

  app.delete("/apps/:appId/env/:id", async (req) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const existing = await prisma.envVar.findUnique({ where: { id } });
    await prisma.envVar.deleteMany({ where: { id, appId } });
    if (existing) {
      await recordAudit(req, {
        action: "env.delete",
        targetType: "app",
        targetId: appId,
        diff: { key: existing.key },
      });
    }
    return { ok: true };
  });
};
