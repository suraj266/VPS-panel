import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import { getHostStats, getRunningContainerStats } from "../lib/stats.js";
import { getSystemLiveStats } from "../lib/system-stats.js";

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

  // Live host stats — CPU%, memory, disk, network throughput, loadavg, uptime.
  // Read via exec into the privileged panel_host sidecar (which shares pid +
  // network namespaces with the host and bind-mounts host's `/` at /host).
  app.get("/stats/system", async (req, reply) => {
    requireAuth(req);
    try {
      return await getSystemLiveStats();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "system stats failed";
      return reply.code(500).send({ error: message });
    }
  });
};
