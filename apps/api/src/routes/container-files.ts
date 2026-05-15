import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  readContainerFile,
  writeContainerFile,
  listContainerDir,
} from "../lib/container-fs.js";
import { requireAuth } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";

const idSchema = z.object({ id: z.string().min(1) });
const pathQuery = z.object({ path: z.string().min(1).max(4096) });

const writeBodySchema = z.object({
  content: z.string().max(2 * 1024 * 1024), // 2 MB
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

export const containerFileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/containers/:id/file", async (req, reply) => {
    requireAuth(req);
    const { id } = idSchema.parse(req.params);
    const { path } = pathQuery.parse(req.query);
    try {
      const result = await readContainerFile(id, path);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "read failed";
      return reply.code(404).send({ error: message });
    }
  });

  app.put("/containers/:id/file", async (req, reply) => {
    requireAuth(req);
    const { id } = idSchema.parse(req.params);
    const { path } = pathQuery.parse(req.query);
    const body = writeBodySchema.parse(req.body);
    try {
      await writeContainerFile(id, path, body.content, {
        encoding: body.encoding,
      });
      await recordAudit(req, {
        action: "container.file.write",
        targetType: "container",
        targetId: id,
        diff: { path, size: body.content.length },
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "write failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/containers/:id/files", async (req, reply) => {
    requireAuth(req);
    const { id } = idSchema.parse(req.params);
    const { path } = pathQuery.parse(req.query);
    try {
      const entries = await listContainerDir(id, path);
      return { path, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : "ls failed";
      return reply.code(400).send({ error: message });
    }
  });
};
