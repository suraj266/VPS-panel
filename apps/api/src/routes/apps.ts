import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";
import {
  deployApp,
  buildAndDeployApp,
  composeDeployApp,
  redeployToImageTag,
  removeAppContainer,
  stopAppContainer,
  composeWorkDirFor,
} from "../lib/deploy.js";
import { parseComposeServices } from "../lib/compose.js";
import { encrypt } from "../lib/crypto.js";
import { generateWebhookSecret } from "../lib/webhook.js";
import { recordAudit } from "../lib/audit.js";

const slugSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric + dashes");

const portSchema = z.object({
  host: z.number().int().min(1).max(65535),
  container: z.number().int().min(1).max(65535),
  proto: z.enum(["tcp", "udp"]).optional(),
});

const runtimeSchema = z.object({
  ports: z.array(portSchema).optional(),
  restartPolicy: z
    .enum(["no", "unless-stopped", "always", "on-failure"])
    .optional(),
  cmd: z.array(z.string()).optional(),
});

// Base shape — used directly for PATCH (.partial()). Create reuses this with
// a .refine() check requiring one of two source modes.
const gitSchemaBase = z.object({
  repoUrl: z.string().url().optional(),
  githubInstallationId: z.string().min(1).optional(),
  githubRepoFullName: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
  githubRepoId: z.number().int().positive().optional(),
  branch: z.string().min(1).default("main"),
  buildMode: z.enum(["dockerfile", "static", "compose"]).default("dockerfile"),
  dockerfilePath: z.string().min(1).default("Dockerfile"),
  publishDir: z.string().min(1).default("."),
  composePath: z.string().min(1).default("docker-compose.yml"),
  gitToken: z.string().optional(),
});

const gitSchema = gitSchemaBase.refine(
  (g) => !!g.repoUrl || (!!g.githubInstallationId && !!g.githubRepoFullName),
  {
    message:
      "either repoUrl or githubInstallationId + githubRepoFullName must be set",
  },
);

const createAppSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("prebuilt-image"),
    slug: slugSchema,
    projectId: z.string().min(1),
    description: z.string().max(500).optional(),
    imageRef: z.string().min(1),
    runtimeConfig: runtimeSchema.optional(),
  }),
  z.object({
    sourceType: z.literal("git-repo"),
    slug: slugSchema,
    projectId: z.string().min(1),
    description: z.string().max(500).optional(),
    runtimeConfig: runtimeSchema.optional(),
    git: gitSchema,
  }),
]);

const listAppsQuery = z.object({
  projectId: z.string().min(1).optional(),
});

const updateAppSchema = z.object({
  description: z.string().max(500).optional(),
  imageRef: z.string().min(1).optional(),
  runtimeConfig: runtimeSchema.optional(),
  git: gitSchemaBase.partial().optional(),
});

const idParam = z.object({ id: z.string().min(1) });

export const appRoutes: FastifyPluginAsync = async (app) => {
  app.get("/apps", async (req) => {
    requireAuth(req);
    const { projectId } = listAppsQuery.parse(req.query);
    const apps = await prisma.app.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        deployments: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { id: true, status: true, startedAt: true, finishedAt: true },
        },
      },
    });
    return apps;
  });

  app.post("/apps", async (req, reply) => {
    requireAuth(req);
    const body = createAppSchema.parse(req.body);
    try {
      const data =
        body.sourceType === "prebuilt-image"
          ? {
              slug: body.slug,
              projectId: body.projectId,
              description: body.description,
              sourceType: "prebuilt-image",
              imageRef: body.imageRef,
              runtimeConfig: body.runtimeConfig ?? {},
            }
          : {
              slug: body.slug,
              projectId: body.projectId,
              description: body.description,
              sourceType: "git-repo",
              repoUrl: body.git.repoUrl ?? null,
              branch: body.git.branch,
              buildMode: body.git.buildMode,
              dockerfilePath: body.git.dockerfilePath,
              publishDir: body.git.publishDir,
              composePath: body.git.composePath,
              gitTokenEncrypted: body.git.gitToken
                ? encrypt(body.git.gitToken)
                : null,
              githubInstallationId: body.git.githubInstallationId ?? null,
              githubRepoFullName: body.git.githubRepoFullName ?? null,
              githubRepoId: body.git.githubRepoId ?? null,
              // PAT mode still needs a per-app webhook secret. GitHub App mode
              // uses the app-level secret instead, so this is just a fallback.
              webhookSecret: body.git.githubInstallationId
                ? null
                : generateWebhookSecret(),
              runtimeConfig: body.runtimeConfig ?? {},
            };
      const created = await prisma.app.create({ data });
      await recordAudit(req, {
        action: "app.create",
        targetType: "app",
        targetId: created.id,
        diff: { slug: created.slug, sourceType: created.sourceType },
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

  app.get("/apps/:id", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const found = await prisma.app.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, slug: true, name: true } },
        envVars: { select: { id: true, key: true, isSecret: true } },
        domains: { orderBy: { hostname: "asc" } },
        deployments: {
          orderBy: { startedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!found) return reply.code(404).send({ error: "not found" });
    return found;
  });

  app.patch("/apps/:id", async (req) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const body = updateAppSchema.parse(req.body);
    const data: Record<string, unknown> = {};
    if (body.description !== undefined) data.description = body.description;
    if (body.imageRef !== undefined) data.imageRef = body.imageRef;
    if (body.runtimeConfig !== undefined) data.runtimeConfig = body.runtimeConfig;
    if (body.git) {
      if (body.git.repoUrl !== undefined) data.repoUrl = body.git.repoUrl;
      if (body.git.branch !== undefined) data.branch = body.git.branch;
      if (body.git.buildMode !== undefined) data.buildMode = body.git.buildMode;
      if (body.git.dockerfilePath !== undefined)
        data.dockerfilePath = body.git.dockerfilePath;
      if (body.git.publishDir !== undefined) data.publishDir = body.git.publishDir;
      if (body.git.composePath !== undefined)
        data.composePath = body.git.composePath;
      if (body.git.gitToken !== undefined) {
        data.gitTokenEncrypted = body.git.gitToken
          ? encrypt(body.git.gitToken)
          : null;
      }
    }
    const updated = await prisma.app.update({ where: { id }, data });
    return updated;
  });

  app.delete("/apps/:id", async (req) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const found = await prisma.app.findUniqueOrThrow({ where: { id } });
    await removeAppContainer(found.slug);
    await prisma.app.delete({ where: { id } });
    await recordAudit(req, {
      action: "app.delete",
      targetType: "app",
      targetId: id,
      diff: { slug: found.slug },
    });
    return { ok: true };
  });

  app.post("/apps/:id/deploy", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    try {
      const appRecord = await prisma.app.findUniqueOrThrow({ where: { id } });
      let result;
      if (appRecord.sourceType === "git-repo" && appRecord.buildMode === "compose") {
        result = await composeDeployApp(id);
      } else if (appRecord.sourceType === "git-repo") {
        result = await buildAndDeployApp(id);
      } else {
        result = await deployApp(id);
      }
      await recordAudit(req, {
        action: "app.deploy",
        targetType: "app",
        targetId: id,
        diff: { slug: appRecord.slug },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "deploy failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/apps/:id/build-and-deploy", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    try {
      const result = await buildAndDeployApp(id);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "build failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/apps/:id/stop", async (req) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const found = await prisma.app.findUniqueOrThrow({ where: { id } });
    await stopAppContainer(found.slug);
    await recordAudit(req, {
      action: "app.stop",
      targetType: "app",
      targetId: id,
      diff: { slug: found.slug },
    });
    return { ok: true };
  });

  app.post(
    "/apps/:id/deployments/:depId/redeploy",
    async (req, reply) => {
      requireAuth(req);
      const { id, depId } = z
        .object({ id: z.string().min(1), depId: z.string().min(1) })
        .parse(req.params);

      const dep = await prisma.deployment.findUnique({ where: { id: depId } });
      if (!dep || dep.appId !== id) {
        return reply.code(404).send({ error: "deployment not found" });
      }
      if (dep.status !== "succeeded") {
        return reply
          .code(400)
          .send({ error: "can only roll back to a succeeded deployment" });
      }
      if (!dep.imageTag || dep.imageTag === "(pending)") {
        return reply
          .code(400)
          .send({ error: "deployment has no usable image tag" });
      }

      try {
        const result = await redeployToImageTag(id, dep.imageTag, {
          fromDeploymentId: dep.id,
          gitSha: dep.gitSha,
          commitMessage: dep.commitMessage,
        });
        await recordAudit(req, {
          action: "app.rollback",
          targetType: "app",
          targetId: id,
          diff: { imageTag: dep.imageTag, fromDeploymentId: dep.id },
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "redeploy failed";
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.post("/apps/:id/webhook/regenerate", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const found = await prisma.app.findUnique({ where: { id } });
    if (!found) return reply.code(404).send({ error: "not found" });
    if (found.sourceType !== "git-repo") {
      return reply.code(400).send({ error: "webhook only applies to git-repo apps" });
    }
    const secret = generateWebhookSecret();
    await prisma.app.update({ where: { id }, data: { webhookSecret: secret } });
    await recordAudit(req, {
      action: "app.webhook.regenerate",
      targetType: "app",
      targetId: id,
    });
    return { webhookSecret: secret };
  });

  // Parse the app's compose file and return its services (with port hints) so
  // the domain-binding UI can offer a dropdown instead of asking the user to
  // type the service name manually.
  app.get("/apps/:id/compose/services", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const found = await prisma.app.findUnique({ where: { id } });
    if (!found) return reply.code(404).send({ error: "not found" });
    if (found.sourceType !== "git-repo" || found.buildMode !== "compose") {
      return reply
        .code(400)
        .send({ error: "this app is not a compose-source app" });
    }
    const workDir = composeWorkDirFor(found.slug);
    const composeFile = found.composePath ?? "docker-compose.yml";
    try {
      const services = await parseComposeServices(workDir, composeFile);
      return { services };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "compose file not found";
      return reply.code(404).send({
        error: message,
        hint: "Deploy the app at least once so the compose file is cached locally.",
      });
    }
  });
};
