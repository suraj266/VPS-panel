import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { prisma } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

export const SESSION_COOKIE = "panel_session";

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("userId", undefined);

  app.addHook("preHandler", async (req) => {
    const sid = req.cookies[SESSION_COOKIE];
    if (!sid) return;
    const session = await prisma.session.findUnique({ where: { id: sid } });
    if (!session) return;
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: sid } }).catch(() => {});
      return;
    }
    req.userId = session.userId;
  });
};

export default fp(authPlugin);

export function requireAuth(req: FastifyRequest): string {
  if (!req.userId) {
    const err = new Error("unauthorized") as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return req.userId;
}
