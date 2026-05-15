import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { requireAuth } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";
import {
  applySiteConfig,
  removeSiteConfig,
  nginxIsRunning,
} from "../lib/nginx.js";
import { issueCertificate } from "../lib/certbot.js";
import { promises as dns } from "node:dns";
import { getPublicIPv4, getPublicIPv6 } from "../lib/network.js";

const SINGLETON_ID = "global";

const hostnameRegex =
  /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

async function getOrInitSettings() {
  return prisma.panelSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
}

function panelUpstream() {
  return { host: env.PANEL_UPSTREAM_HOST, port: env.PANEL_UPSTREAM_PORT };
}

export const panelSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/panel-settings", async (req) => {
    requireAuth(req);
    const s = await getOrInitSettings();
    return {
      panelDomain: s.panelDomain,
      panelSslEnabled: s.panelSslEnabled,
      panelCertEmail: s.panelCertEmail,
      panelCertExpiresAt: s.panelCertExpiresAt,
      upstream: panelUpstream(),
    };
  });

  app.put("/panel-settings/domain", async (req, reply) => {
    requireAuth(req);
    const { domain } = z
      .object({ domain: z.string().regex(hostnameRegex, "invalid hostname") })
      .parse(req.body);

    if (!(await nginxIsRunning())) {
      return reply.code(503).send({
        error: "panel_nginx is not running. Start it with docker compose up.",
      });
    }

    const current = await getOrInitSettings();

    // If we're changing the domain, remove the old site config first.
    if (current.panelDomain && current.panelDomain !== domain) {
      await removeSiteConfig(current.panelDomain).catch(() => {});
    }

    try {
      await applySiteConfig({
        hostname: domain,
        upstream: panelUpstream(),
        sslEnabled: false, // start HTTP-only; SSL is a separate explicit step
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "nginx apply failed";
      return reply.code(400).send({ error: message });
    }

    const updated = await prisma.panelSettings.update({
      where: { id: SINGLETON_ID },
      data: {
        panelDomain: domain,
        panelSslEnabled: false,
        panelCertExpiresAt: null,
      },
    });

    await recordAudit(req, {
      action: "panel.domain.set",
      targetType: "panel",
      targetId: SINGLETON_ID,
      diff: { domain },
    });

    return updated;
  });

  app.delete("/panel-settings/domain", async (req) => {
    requireAuth(req);
    const current = await getOrInitSettings();
    if (current.panelDomain) {
      await removeSiteConfig(current.panelDomain).catch(() => {});
    }
    const updated = await prisma.panelSettings.update({
      where: { id: SINGLETON_ID },
      data: {
        panelDomain: null,
        panelSslEnabled: false,
        panelCertExpiresAt: null,
      },
    });
    await recordAudit(req, {
      action: "panel.domain.unset",
      targetType: "panel",
      targetId: SINGLETON_ID,
    });
    return updated;
  });

  app.post("/panel-settings/domain/ssl/issue", async (req, reply) => {
    requireAuth(req);
    const { email, staging } = z
      .object({
        email: z.string().email(),
        staging: z.boolean().default(false),
      })
      .parse(req.body);

    const current = await getOrInitSettings();
    if (!current.panelDomain) {
      return reply
        .code(400)
        .send({ error: "set the panel domain first, then issue SSL" });
    }

    const logs: string[] = [];
    const log = (line: string) => logs.push(line);

    try {
      const result = await issueCertificate({
        hostname: current.panelDomain,
        email,
        staging,
        onLog: log,
      });

      // Re-apply nginx config with HTTPS server block now that the cert
      // is on disk in the nginx volume.
      await applySiteConfig({
        hostname: current.panelDomain,
        upstream: panelUpstream(),
        sslEnabled: true,
      });

      const updated = await prisma.panelSettings.update({
        where: { id: SINGLETON_ID },
        data: {
          panelSslEnabled: true,
          panelCertEmail: email,
          panelCertExpiresAt: result.expiresAt,
        },
      });

      await recordAudit(req, {
        action: "panel.ssl.issue",
        targetType: "panel",
        targetId: SINGLETON_ID,
        diff: { domain: current.panelDomain, staging },
      });

      return {
        ok: true,
        panelDomain: updated.panelDomain,
        panelSslEnabled: true,
        panelCertExpiresAt: updated.panelCertExpiresAt,
        staging: result.staging,
        logs: logs.slice(-100),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "cert issue failed";
      return reply.code(400).send({ error: message, logs: logs.slice(-100) });
    }
  });

  // Domain health check: confirms DNS resolves to the VPS's public IP AND
  // that the panel itself answers over HTTP at that hostname. Returned object
  // is structured so the UI can show a green/red checklist.
  app.get("/panel-settings/domain/health-check", async (req, reply) => {
    requireAuth(req);
    const { domain } = z
      .object({ domain: z.string().regex(hostnameRegex, "invalid hostname") })
      .parse(req.query);

    const [publicV4, publicV6] = await Promise.all([
      getPublicIPv4(),
      getPublicIPv6(),
    ]);

    const dnsA: string[] = await dns
      .resolve4(domain)
      .catch(() => []);
    const dnsAAAA: string[] = await dns
      .resolve6(domain)
      .catch(() => []);

    const v4Match = publicV4 ? dnsA.includes(publicV4) : false;
    const v6Match = publicV6 ? dnsAAAA.includes(publicV6) : false;

    // HTTP probe — try the panel's own /api/health endpoint via the public
    // hostname. If nginx is configured right this should return 200.
    type Probe = {
      ok: boolean;
      status?: number;
      error?: string;
      latencyMs?: number;
    };
    async function probe(scheme: "http" | "https"): Promise<Probe> {
      const url = `${scheme}://${domain}/api/health`;
      const t0 = Date.now();
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4000);
        const res = await fetch(url, { signal: ac.signal, redirect: "manual" });
        clearTimeout(timer);
        return {
          ok: res.status >= 200 && res.status < 400,
          status: res.status,
          latencyMs: Date.now() - t0,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        };
      }
    }

    const [http, https] = await Promise.all([probe("http"), probe("https")]);

    return {
      domain,
      publicIPv4: publicV4,
      publicIPv6: publicV6,
      dns: {
        a: dnsA,
        aaaa: dnsAAAA,
        ipv4Match: v4Match,
        ipv6Match: v6Match,
      },
      http,
      https,
    };
  });
};
