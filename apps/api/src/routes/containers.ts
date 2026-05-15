import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  listContainers,
  containerAction,
  containerLogs,
  createAndStartContainer,
} from "../docker.js";
import { requireAuth } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";

const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "remove"]),
});

const idSchema = z.object({ id: z.string().min(1) });

const logsQuerySchema = z.object({
  tail: z.coerce.number().int().positive().max(5000).default(200),
});

const createSchema = z.object({
  image: z.string().min(1),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, "invalid container name"),
  ports: z
    .array(
      z.object({
        host: z.number().int().min(1).max(65535),
        container: z.number().int().min(1).max(65535),
        proto: z.enum(["tcp", "udp"]).optional(),
      }),
    )
    .default([]),
  env: z.record(z.string()).default({}),
  restartPolicy: z
    .enum(["no", "always", "unless-stopped", "on-failure"])
    .optional(),
});

export const containerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/containers", async (req) => {
    requireAuth(req);
    return listContainers();
  });

  app.post("/containers", async (req, reply) => {
    requireAuth(req);
    const input = createSchema.parse(req.body);
    try {
      const id = await createAndStartContainer(input);
      await recordAudit(req, {
        action: "container.create",
        targetType: "container",
        targetId: id,
        diff: { image: input.image, name: input.name },
      });
      return { id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "create failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/containers/:id/action", async (req, reply) => {
    requireAuth(req);
    const { id } = idSchema.parse(req.params);
    const { action } = actionSchema.parse(req.body);
    try {
      await containerAction(id, action);
      await recordAudit(req, {
        action: `container.${action}`,
        targetType: "container",
        targetId: id,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "action failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/containers/:id/logs", async (req, reply) => {
    requireAuth(req);
    const { id } = idSchema.parse(req.params);
    const { tail } = logsQuerySchema.parse(req.query);
    try {
      const text = await containerLogs(id, tail);
      return { logs: text };
    } catch (err) {
      const message = err instanceof Error ? err.message : "logs failed";
      return reply.code(400).send({ error: message });
    }
  });
};
