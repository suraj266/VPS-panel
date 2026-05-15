import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit", async (req) => {
    requireAuth(req);
    const q = querySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (q.action) where.action = { startsWith: q.action };
    if (q.targetType) where.targetType = q.targetType;
    if (q.targetId) where.targetId = q.targetId;

    const entries = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: {
        actor: { select: { id: true, email: true } },
      },
    });

    const hasMore = entries.length > q.limit;
    const items = hasMore ? entries.slice(0, q.limit) : entries;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return { items, nextCursor };
  });
};
