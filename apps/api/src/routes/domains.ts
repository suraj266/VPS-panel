import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";
import {
  applySiteConfig,
  removeSiteConfig,
  nginxIsRunning,
} from "../lib/nginx.js";
import { issueCertificate } from "../lib/certbot.js";
import { recordAudit } from "../lib/audit.js";

const idParam = z.object({ id: z.string().min(1) });
const appIdParam = z.object({ appId: z.string().min(1) });

const hostnameRegex =
  /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

const createSchema = z.object({
  hostname: z.string().regex(hostnameRegex, "invalid hostname"),
  port: z.number().int().min(1).max(65535),
  serviceName: z.string().regex(/^[a-zA-Z0-9_.-]+$/, "invalid service name").optional(),
  sslEnabled: z.boolean().default(false),
  customNginxConfig: z.string().max(8192).optional(),
});

const updateSchema = z.object({
  hostname: z.string().regex(hostnameRegex, "invalid hostname").optional(),
  port: z.number().int().min(1).max(65535).optional(),
  serviceName: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/, "invalid service name")
    .nullable()
    .optional(),
  // Nullable because "Clear" in the UI sends null to drop any custom block.
  customNginxConfig: z.string().max(8192).nullable().optional(),
});

interface AppWithMode {
  slug: string;
  sourceType: string;
  buildMode: string | null;
}

function upstreamHostFor(app: AppWithMode, serviceName: string | null): string {
  if (app.sourceType === "git-repo" && app.buildMode === "compose") {
    // Compose: containers are aliased to their service name on panel_net.
    // Service name is required for compose apps.
    if (!serviceName) {
      throw new Error("serviceName required for compose apps");
    }
    return serviceName;
  }
  // Single-container apps
  return `panel_${app.slug}`;
}

export const domainRoutes: FastifyPluginAsync = async (app) => {
  app.get("/apps/:appId/domains", async (req) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    return prisma.domain.findMany({
      where: { appId },
      orderBy: { hostname: "asc" },
    });
  });

  app.post("/apps/:appId/domains", async (req, reply) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const body = createSchema.parse(req.body);

    const appRecord = await prisma.app.findUnique({ where: { id: appId } });
    if (!appRecord) return reply.code(404).send({ error: "app not found" });

    if (
      appRecord.sourceType === "git-repo" &&
      appRecord.buildMode === "compose" &&
      !body.serviceName
    ) {
      return reply.code(400).send({
        error: "serviceName is required for compose apps",
      });
    }

    if (!(await nginxIsRunning())) {
      return reply.code(503).send({
        error: "panel_nginx container is not running. Start it with `pnpm dev:services`.",
      });
    }

    let domain;
    try {
      domain = await prisma.domain.create({
        data: {
          appId,
          hostname: body.hostname,
          port: body.port,
          serviceName: body.serviceName ?? null,
          sslEnabled: body.sslEnabled,
          customNginxConfig: body.customNginxConfig?.trim() || null,
        },
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "P2002") {
        return reply.code(409).send({ error: "hostname already bound" });
      }
      throw err;
    }

    try {
      await applySiteConfig({
        hostname: body.hostname,
        upstream: {
          host: upstreamHostFor(appRecord, body.serviceName ?? null),
          port: body.port,
        },
        sslEnabled: body.sslEnabled,
        customNginxConfig: domain.customNginxConfig,
      });
    } catch (err) {
      // Rollback DB row if nginx config failed
      await prisma.domain.delete({ where: { id: domain.id } }).catch(() => {});
      const message = err instanceof Error ? err.message : "nginx apply failed";
      return reply.code(400).send({ error: message });
    }

    await recordAudit(req, {
      action: "domain.create",
      targetType: "app",
      targetId: appId,
      diff: {
        hostname: domain.hostname,
        port: domain.port,
        serviceName: domain.serviceName,
      },
    });

    return domain;
  });

  app.delete("/apps/:appId/domains/:id", async (req) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { id } = idParam.parse(req.params);
    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain || domain.appId !== appId) {
      return { ok: true };
    }
    await removeSiteConfig(domain.hostname);
    await prisma.domain.delete({ where: { id } });
    await recordAudit(req, {
      action: "domain.delete",
      targetType: "app",
      targetId: appId,
      diff: { hostname: domain.hostname },
    });
    return { ok: true };
  });

  const issueSchema = z.object({
    email: z.string().email(),
    staging: z.boolean().default(false),
  });

  app.post(
    "/apps/:appId/domains/:id/ssl/issue",
    async (req, reply) => {
      requireAuth(req);
      const { appId } = appIdParam.parse(req.params);
      const { id } = idParam.parse(req.params);
      const body = issueSchema.parse(req.body);

      const domain = await prisma.domain.findUnique({ where: { id } });
      if (!domain || domain.appId !== appId) {
        return reply.code(404).send({ error: "domain not found" });
      }
      const appRecord = await prisma.app.findUniqueOrThrow({
        where: { id: appId },
      });

      const logs: string[] = [];
      const log = (line: string) => logs.push(line);

      try {
        const result = await issueCertificate({
          hostname: domain.hostname,
          email: body.email,
          staging: body.staging,
          onLog: log,
        });

        await prisma.domain.update({
          where: { id },
          data: {
            sslEnabled: true,
            certExpiresAt: result.expiresAt,
          },
        });

        // Re-apply nginx config with the HTTPS server block
        await applySiteConfig({
          hostname: domain.hostname,
          upstream: {
            host: upstreamHostFor(appRecord, domain.serviceName),
            port: domain.port,
          },
          sslEnabled: true,
          customNginxConfig: domain.customNginxConfig,
        });

        await recordAudit(req, {
          action: "domain.ssl.issue",
          targetType: "domain",
          targetId: domain.id,
          diff: {
            hostname: domain.hostname,
            staging: body.staging,
          },
        });

        return {
          ok: true,
          hostname: result.hostname,
          expiresAt: result.expiresAt.toISOString(),
          staging: result.staging,
          logs: logs.slice(-100),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "ssl issue failed";
        return reply.code(400).send({
          error: message,
          logs: logs.slice(-100),
        });
      }
    },
  );

  app.post("/apps/:appId/domains/:id/reapply", async (req, reply) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { id } = idParam.parse(req.params);
    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain || domain.appId !== appId) {
      return reply.code(404).send({ error: "not found" });
    }
    const appRecord = await prisma.app.findUniqueOrThrow({ where: { id: appId } });
    try {
      await applySiteConfig({
        hostname: domain.hostname,
        upstream: {
          host: upstreamHostFor(appRecord, domain.serviceName),
          port: domain.port,
        },
        sslEnabled: domain.sslEnabled,
        customNginxConfig: domain.customNginxConfig,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "nginx apply failed";
      return reply.code(400).send({ error: message });
    }
  });

  // Edit a domain in-place — hostname, port, service, and/or custom nginx
  // directives. Mirrors Coolify's "change domain → save → done" flow so the
  // user doesn't have to remove-and-recreate. Atomicity rules:
  //   1. Compute the merged target state (untouched fields keep their current
  //      values).
  //   2. Reject hostname collisions explicitly (409) so the user gets a clear
  //      message instead of a generic Prisma unique violation.
  //   3. Update the DB row first, then call applySiteConfig with the new
  //      hostname. applySiteConfig backs up the prior conf at the new path
  //      (none, for a fresh hostname) — if `nginx -t` fails we revert the DB
  //      row and the on-disk state is already clean.
  //   4. On hostname change: clear the old hostname's conf only AFTER the new
  //      one validates. Cert files are intentionally left alone so a user who
  //      flips back later still has them. The new hostname starts SSL-off
  //      because the old cert doesn't match it — user re-issues a fresh cert.
  app.patch("/apps/:appId/domains/:id", async (req, reply) => {
    requireAuth(req);
    const { appId } = appIdParam.parse(req.params);
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);

    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain || domain.appId !== appId) {
      return reply.code(404).send({ error: "domain not found" });
    }
    const appRecord = await prisma.app.findUniqueOrThrow({
      where: { id: appId },
    });

    const oldHostname = domain.hostname;
    const newHostname = body.hostname ?? domain.hostname;
    const newPort = body.port ?? domain.port;
    const newServiceName =
      body.serviceName === undefined ? domain.serviceName : body.serviceName;
    const newCustomConfig =
      body.customNginxConfig === undefined
        ? domain.customNginxConfig
        : body.customNginxConfig?.trim() || null;

    const hostnameChanged = newHostname !== oldHostname;
    // The cert at the old hostname doesn't match a new one — drop SSL state so
    // the UI prompts the user to re-issue. (Cert files stay on disk; certbot
    // will overwrite if the user re-issues later.)
    const newSslEnabled = hostnameChanged ? false : domain.sslEnabled;
    const newCertExpiresAt = hostnameChanged ? null : domain.certExpiresAt;

    if (
      appRecord.sourceType === "git-repo" &&
      appRecord.buildMode === "compose" &&
      !newServiceName
    ) {
      return reply.code(400).send({
        error: "serviceName is required for compose apps",
      });
    }

    // Reject collisions with another domain before we touch anything else.
    if (hostnameChanged) {
      const conflict = await prisma.domain.findUnique({
        where: { hostname: newHostname },
      });
      if (conflict && conflict.id !== id) {
        return reply.code(409).send({ error: "hostname already bound" });
      }
    }

    // Snapshot pre-update state so we can roll the row back if nginx rejects.
    const prevState = {
      hostname: domain.hostname,
      port: domain.port,
      serviceName: domain.serviceName,
      sslEnabled: domain.sslEnabled,
      certExpiresAt: domain.certExpiresAt,
      customNginxConfig: domain.customNginxConfig,
    };

    const updated = await prisma.domain.update({
      where: { id },
      data: {
        hostname: newHostname,
        port: newPort,
        serviceName: newServiceName,
        customNginxConfig: newCustomConfig,
        sslEnabled: newSslEnabled,
        certExpiresAt: newCertExpiresAt,
      },
    });

    try {
      await applySiteConfig({
        hostname: newHostname,
        upstream: {
          host: upstreamHostFor(appRecord, newServiceName),
          port: newPort,
        },
        sslEnabled: newSslEnabled,
        customNginxConfig: newCustomConfig,
      });

      if (hostnameChanged) {
        // New conf is live; safe to drop the old hostname's site config.
        // Best-effort — if removeSiteConfig fails (e.g. file already gone)
        // we don't fail the whole edit.
        await removeSiteConfig(oldHostname).catch(() => {});
      }
    } catch (err) {
      // applySiteConfig already rolled back the on-disk conf at the new
      // hostname (no prior file existed for a renamed domain, so it deleted).
      // We just need to put the DB row back.
      await prisma.domain
        .update({ where: { id }, data: prevState })
        .catch(() => {});
      const message =
        err instanceof Error ? err.message : "nginx apply failed";
      return reply.code(400).send({ error: message });
    }

    await recordAudit(req, {
      action: hostnameChanged ? "domain.update.hostname" : "domain.update",
      targetType: "domain",
      targetId: domain.id,
      diff: {
        from: prevState,
        to: {
          hostname: newHostname,
          port: newPort,
          serviceName: newServiceName,
          sslEnabled: newSslEnabled,
          customNginxConfig: newCustomConfig,
        },
      },
    });

    return updated;
  });
};
