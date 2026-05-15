import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";

const slugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric + dashes");

const createSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
});

const idParam = z.object({ id: z.string().min(1) });

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects", async (req) => {
    requireAuth(req);
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { apps: true } },
        apps: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: {
            id: true,
            slug: true,
            sourceType: true,
            buildMode: true,
            deployments: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { status: true },
            },
          },
        },
      },
    });
    return projects;
  });

  app.get("/projects/:id", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        apps: {
          orderBy: { createdAt: "desc" },
          include: {
            deployments: {
              orderBy: { startedAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
            },
          },
        },
      },
    });
    if (!project) return reply.code(404).send({ error: "not found" });
    return project;
  });

  app.post("/projects", async (req, reply) => {
    requireAuth(req);
    const body = createSchema.parse(req.body);
    try {
      const created = await prisma.project.create({ data: body });
      await recordAudit(req, {
        action: "project.create",
        targetType: "project",
        targetId: created.id,
        diff: { slug: created.slug, name: created.name },
      });
      return created;
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === "P2002") {
        return reply.code(409).send({ error: "slug already exists" });
      }
      throw err;
    }
  });

  app.patch("/projects/:id", async (req) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    const updated = await prisma.project.update({
      where: { id },
      data: body,
    });
    await recordAudit(req, {
      action: "project.update",
      targetType: "project",
      targetId: id,
      diff: body,
    });
    return updated;
  });

  app.delete("/projects/:id", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const project = await prisma.project.findUnique({
      where: { id },
      include: { _count: { select: { apps: true } } },
    });
    if (!project) return reply.code(404).send({ error: "not found" });
    if (project._count.apps > 0) {
      return reply.code(400).send({
        error: `cannot delete: ${project._count.apps} apps still belong to this project. Move or delete them first.`,
      });
    }
    if (project.slug === "default") {
      return reply
        .code(400)
        .send({ error: "the Default project cannot be deleted" });
    }
    await prisma.project.delete({ where: { id } });
    await recordAudit(req, {
      action: "project.delete",
      targetType: "project",
      targetId: id,
      diff: { slug: project.slug },
    });
    return { ok: true };
  });
};
