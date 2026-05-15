import type { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { requireAuth } from "../plugins/auth.js";
import { recordAudit } from "../lib/audit.js";
import {
  listBackups,
  createBackup,
  deleteBackup,
  backupFilePath,
} from "../lib/backup.js";

const filenameParam = z.object({
  filename: z.string().regex(/^panel-[0-9T:.\-]+\.sql\.gz$/),
});

export const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/backups", async (req) => {
    requireAuth(req);
    const files = await listBackups();
    return { files };
  });

  app.post("/backups", async (req, reply) => {
    requireAuth(req);
    try {
      const file = await createBackup();
      await recordAudit(req, {
        action: "backup.create",
        targetType: "backup",
        targetId: file.filename,
        diff: { sizeBytes: file.sizeBytes },
      });
      return file;
    } catch (err) {
      const message = err instanceof Error ? err.message : "backup failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.get("/backups/:filename/download", async (req, reply) => {
    requireAuth(req);
    const { filename } = filenameParam.parse(req.params);
    const filepath = backupFilePath(filename);
    try {
      const s = await stat(filepath);
      reply.header("content-type", "application/gzip");
      reply.header(
        "content-disposition",
        `attachment; filename="${filename}"`,
      );
      reply.header("content-length", s.size);
      return reply.send(createReadStream(filepath));
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  app.delete("/backups/:filename", async (req, reply) => {
    requireAuth(req);
    const { filename } = filenameParam.parse(req.params);
    try {
      await deleteBackup(filename);
      await recordAudit(req, {
        action: "backup.delete",
        targetType: "backup",
        targetId: filename,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      return reply.code(400).send({ error: message });
    }
  });
};
