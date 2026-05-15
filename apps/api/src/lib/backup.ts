import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { PassThrough } from "node:stream";
import { docker } from "../docker.js";

const POSTGRES_CONTAINER = "panel_postgres";
const POSTGRES_USER = "panel";
const POSTGRES_DB = "panel";
const FILENAME_RE = /^panel-[0-9T:.\-]+\.sql\.gz$/;

export interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export function backupDir(): string {
  return process.env.PANEL_BACKUP_DIR ?? path.join(homedir(), ".panel-backups");
}

function safeJoin(filename: string): string {
  if (!FILENAME_RE.test(filename)) throw new Error("invalid backup filename");
  return path.join(backupDir(), filename);
}

export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir);
  const out: BackupFile[] = [];
  for (const f of files) {
    if (!f.endsWith(".sql.gz")) continue;
    const s = await stat(path.join(dir, f));
    out.push({
      filename: f,
      sizeBytes: s.size,
      createdAt: s.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(): Promise<BackupFile> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `panel-${ts}.sql.gz`;
  const filepath = path.join(dir, filename);

  // Exec pg_dump inside the postgres container
  const container = docker.getContainer(POSTGRES_CONTAINER);
  const exec = await container.exec({
    Cmd: ["pg_dump", "-U", POSTGRES_USER, "-d", POSTGRES_DB],
    AttachStdout: true,
    AttachStderr: true,
    Env: [`PGPASSWORD=${POSTGRES_USER}`],
  });

  const stream = (await exec.start({})) as unknown as NodeJS.ReadableStream;

  // dockerode multiplexes stdout/stderr — demux into separate sinks
  const stdoutPipe = new PassThrough();
  const stderrChunks: Buffer[] = [];
  const stderrSink = {
    write: (c: Buffer) => stderrChunks.push(c),
  } as unknown as NodeJS.WritableStream;

  docker.modem.demuxStream(stream, stdoutPipe, stderrSink);

  // Drain the source stream and finalize PassThrough
  stream.on("end", () => stdoutPipe.end());
  stream.on("error", (e) => stdoutPipe.destroy(e));

  await pipeline(stdoutPipe, createGzip(), createWriteStream(filepath));

  const inspect = await exec.inspect();
  if (inspect.ExitCode !== 0) {
    // Best-effort cleanup
    await unlink(filepath).catch(() => {});
    const err = Buffer.concat(stderrChunks).toString("utf8");
    throw new Error(
      `pg_dump failed (exit ${inspect.ExitCode}): ${err.slice(-500)}`,
    );
  }

  const s = await stat(filepath);
  return {
    filename,
    sizeBytes: s.size,
    createdAt: s.mtime.toISOString(),
  };
}

export async function deleteBackup(filename: string): Promise<void> {
  await unlink(safeJoin(filename));
}

export function backupFilePath(filename: string): string {
  return safeJoin(filename);
}

export async function pruneBackups(keep = 14): Promise<number> {
  const all = await listBackups();
  const toDelete = all.slice(keep);
  for (const b of toDelete) {
    await deleteBackup(b.filename).catch(() => {});
  }
  return toDelete.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;
let scheduleStarted = false;

export function startBackupSchedule(retention = 14): void {
  if (scheduleStarted) return;
  scheduleStarted = true;

  const run = async () => {
    try {
      const b = await createBackup();
      const pruned = await pruneBackups(retention);
      console.log(
        `[backup] daily ok: ${b.filename} (${b.sizeBytes} bytes), pruned ${pruned}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[backup] daily failed: ${message}`);
    }
  };

  // Run first backup 5 minutes after boot, then every 24h.
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, DAY_MS);
}
