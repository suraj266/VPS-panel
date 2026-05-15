import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import { getHostStats, getRunningContainerStats } from "../lib/stats.js";

const containersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stats/host", async (req, reply) => {
    requireAuth(req);
    try {
      return await getHostStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : "stats failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.get("/stats/containers", async (req, reply) => {
    requireAuth(req);
    const { limit } = containersQuery.parse(req.query);
    try {
      const rows = await getRunningContainerStats(limit);
      return { rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : "stats failed";
      return reply.code(500).send({ error: message });
    }
  });
};
