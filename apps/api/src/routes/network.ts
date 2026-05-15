import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../plugins/auth.js";
import { getNetworkInfo } from "../lib/network.js";

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get("/network", async (req, reply) => {
    requireAuth(req);
    try {
      return await getNetworkInfo();
    } catch (err) {
      const message = err instanceof Error ? err.message : "network probe failed";
      return reply.code(500).send({ error: message });
    }
  });
};
