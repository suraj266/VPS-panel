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
  // Nullable because "Clear" in the UI sends null to drop any custom block.
  customNginxConfig: z.string().max(8192).nullable(),
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

  // Edit per-domain custom nginx directives. Writes the new value, regenerates
  // the nginx site config, and validates via `nginx -t`. On validation failure
  // we revert the DB row back to its previous value AND the on-disk conf is
  // restored to the previous good copy by applySiteConfig — so a bad edit
  // never knocks the live site offline.
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

    const newConfig = body.customNginxConfig?.trim() || null;
    const previousConfig = domain.customNginxConfig;

    const updated = await prisma.domain.update({
      where: { id },
      data: { customNginxConfig: newConfig },
    });

    try {
      await applySiteConfig({
        hostname: domain.hostname,
        upstream: {
          host: upstreamHostFor(appRecord, domain.serviceName),
          port: domain.port,
        },
        sslEnabled: domain.sslEnabled,
        customNginxConfig: newConfig,
      });
    } catch (err) {
      // Revert DB so it stays in sync with the on-disk conf we just restored.
      await prisma.domain
        .update({
          where: { id },
          data: { customNginxConfig: previousConfig },
        })
        .catch(() => {});
      const message =
        err instanceof Error ? err.message : "nginx apply failed";
      return reply.code(400).send({ error: message });
    }

    await recordAudit(req, {
      action: "domain.update.nginx_config",
      targetType: "domain",
      targetId: domain.id,
      diff: { hostname: domain.hostname },
    });

    return updated;
  });
};
