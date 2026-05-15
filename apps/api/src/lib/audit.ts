import type { FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export interface AuditInput {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  diff?: unknown;
  actorId?: string | null; // override req.userId (for unauth events like failed login)
}

/**
 * Records an audit log entry. Never throws — audit failures must not break the
 * request flow. The IP is taken from the request; actor defaults to req.userId.
 */
export async function recordAudit(
  req: FastifyRequest,
  input: AuditInput,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? req.userId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        diff:
          input.diff === undefined
            ? Prisma.JsonNull
            : (input.diff as Prisma.InputJsonValue),
        ip:
          (req.headers["x-forwarded-for"] as string | undefined)
            ?.split(",")[0]
            ?.trim() ??
          req.ip ??
          null,
      },
    });
  } catch (err) {
    req.log.warn({ err }, "audit write failed");
  }
}
