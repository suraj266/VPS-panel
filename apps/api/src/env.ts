import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be >= 32 chars"),
  PANEL_MASTER_KEY: z.string().min(16, "PANEL_MASTER_KEY too short"),
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  // Let's Encrypt: email used for cert issuance + staging flag for testing.
  // Defaults to ADMIN_EMAIL if unset.
  CERTBOT_EMAIL: z.string().email().optional(),
  CERTBOT_STAGING: z
    .enum(["true", "false"])
    .default("false")
    .transform((s) => s === "true"),
  // Where the panel API listens, from nginx's perspective. In prod this is
  // the `panel_app` service on docker-compose. In dev you can point it at
  // `host.docker.internal` if you want to try the panel-domain flow locally.
  PANEL_UPSTREAM_HOST: z.string().default("panel_app"),
  PANEL_UPSTREAM_PORT: z.coerce.number().int().positive().default(4000),
});

export const env = envSchema.parse(process.env);
