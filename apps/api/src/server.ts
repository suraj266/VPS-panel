import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import authPlugin from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { containerRoutes } from "./routes/containers.js";
import { appRoutes } from "./routes/apps.js";
import { envVarRoutes } from "./routes/env-vars.js";
import { domainRoutes } from "./routes/domains.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { terminalRoutes } from "./routes/terminal.js";
import { logStreamRoutes } from "./routes/log-stream.js";
import { auditRoutes } from "./routes/audit.js";
import { containerFileRoutes } from "./routes/container-files.js";
import { statsRoutes } from "./routes/stats.js";
import { backupRoutes } from "./routes/backups.js";
import { networkRoutes } from "./routes/network.js";
import { githubRoutes } from "./routes/github.js";
import { projectRoutes } from "./routes/projects.js";
import { panelSettingsRoutes } from "./routes/panel-settings.js";

export async function buildServer() {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "HH:MM:ss" },
            },
          }
        : true,
    bodyLimit: 4 * 1024 * 1024, // 4 MB for file editor saves
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const msg = first
        ? `${first.path.join(".") || "(body)"}: ${first.message}`
        : "validation failed";
      return reply.code(400).send({ error: msg, issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: err.message });
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  if (env.NODE_ENV !== "production") {
    // In production the API and web are served from the same origin, so CORS
    // is unnecessary. In dev, Vite proxies through but cookies still need
    // credentials passthrough.
    await app.register(cors, {
      origin: env.CORS_ORIGIN,
      credentials: true,
    });
  }
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  await app.register(websocket);

  // All API routes live under /api so the same Fastify can also serve the SPA.
  await app.register(
    async (api) => {
      await api.register(authPlugin);
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(containerRoutes);
      await api.register(appRoutes);
      await api.register(envVarRoutes);
      await api.register(domainRoutes);
      await api.register(webhookRoutes);
      await api.register(terminalRoutes);
      await api.register(logStreamRoutes);
      await api.register(auditRoutes);
      await api.register(containerFileRoutes);
      await api.register(statsRoutes);
      await api.register(backupRoutes);
      await api.register(networkRoutes);
      await api.register(githubRoutes);
      await api.register(projectRoutes);
      await api.register(panelSettingsRoutes);
    },
    { prefix: "/api" },
  );

  // In production, serve the built web SPA from this same server.
  if (env.NODE_ENV === "production") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const webDist =
      process.env.PANEL_WEB_DIST ??
      path.resolve(__dirname, "../../web/dist");
    await app.register(staticPlugin, {
      root: webDist,
      prefix: "/",
      // Allow caching of hashed assets but not index.html
      setHeaders: (res, file) => {
        if (file.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });
    // SPA fallback: any non-/api 404 returns index.html so client-side routing
    // works on direct hits like /dashboard, /apps/:id.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
