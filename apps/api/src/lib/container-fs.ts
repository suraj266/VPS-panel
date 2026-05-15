import tar from "tar-stream";
import path from "node:path/posix";
import { Readable } from "node:stream";
import { docker } from "../docker.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB safety limit

export interface ReadFileResult {
  content: string;
  size: number;
  encoding: "utf8" | "base64";
  mode: number;
}

/**
 * Read a single file from inside a container. Uses Docker's archive API:
 * `getArchive(path)` returns a tar containing the file. We extract the
 * first regular-file entry.
 *
 * Text files are returned as UTF-8 string. If we detect binary content
 * (null bytes in the first 8KB), we return base64 instead.
 */
export async function readContainerFile(
  containerId: string,
  filePath: string,
): Promise<ReadFileResult> {
  const container = docker.getContainer(containerId);
  const archive = (await container.getArchive({
    path: filePath,
  })) as unknown as NodeJS.ReadableStream;

  return await new Promise<ReadFileResult>((resolve, reject) => {
    const extract = tar.extract();
    let resolved = false;

    extract.on("entry", (header, stream, next) => {
      if (header.type !== "file") {
        stream.resume();
        next();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_FILE_BYTES) {
          stream.destroy(new Error(`file too large (>${MAX_FILE_BYTES} bytes)`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        if (resolved) return next();
        resolved = true;
        const buf = Buffer.concat(chunks);
        const probe = buf.subarray(0, Math.min(buf.length, 8192));
        const isBinary = probe.includes(0);
        resolve({
          content: isBinary ? buf.toString("base64") : buf.toString("utf8"),
          size: buf.length,
          encoding: isBinary ? "base64" : "utf8",
          mode: header.mode ?? 0o644,
        });
        next();
      });
      stream.on("error", reject);
    });

    extract.on("finish", () => {
      if (!resolved) reject(new Error("file not found in archive"));
    });
    extract.on("error", reject);

    archive.pipe(extract);
  });
}

export async function writeContainerFile(
  containerId: string,
  filePath: string,
  content: string,
  options: { encoding?: "utf8" | "base64"; mode?: number } = {},
): Promise<void> {
  const container = docker.getContainer(containerId);
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);

  const buf =
    options.encoding === "base64"
      ? Buffer.from(content, "base64")
      : Buffer.from(content, "utf8");

  if (buf.length > MAX_FILE_BYTES) {
    throw new Error(`file too large (>${MAX_FILE_BYTES} bytes)`);
  }

  const pack = tar.pack();
  pack.entry({ name: filename, mode: options.mode ?? 0o644, size: buf.length }, buf);
  pack.finalize();

  await container.putArchive(pack as unknown as Readable, { path: dir });
}

export interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mode: string;
  mtime: string;
}

/**
 * List a directory inside a container by running `ls -la --time-style=long-iso`.
 * Falls back to `ls -la` if --time-style isn't supported (e.g. BusyBox).
 */
export async function listContainerDir(
  containerId: string,
  dirPath: string,
): Promise<DirEntry[]> {
  const output = await runExec(containerId, [
    "sh",
    "-c",
    `ls -la --time-style=long-iso "${dirPath}" 2>/dev/null || ls -la "${dirPath}"`,
  ]);
  return parseLs(output);
}

async function runExec(
  containerId: string,
  cmd: string[],
): Promise<string> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  const out: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      {
        write: (chunk: Buffer) => out.push(chunk),
      } as unknown as NodeJS.WritableStream,
      {
        write: (chunk: Buffer) => out.push(chunk),
      } as unknown as NodeJS.WritableStream,
    );
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(out).toString("utf8");
}

function parseLs(output: string): DirEntry[] {
  const lines = output.split(/\r?\n/);
  const entries: DirEntry[] = [];
  for (const line of lines) {
    // Format: drwxr-xr-x  2  user group  size  YYYY-MM-DD HH:MM  name
    // Or BusyBox: drwxr-xr-x    2 user     group         size Mon DD  YYYY name
    const m = line.match(
      /^([dl-])([rwxstST-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(.+?)\s{1,2}(\S+.*)$/,
    );
    if (!m) continue;
    const [, kind, perms, sizeStr, mtime, name] = m;
    if (name === "." || name === "..") continue;
    entries.push({
      name: name!,
      type:
        kind === "d" ? "dir" : kind === "l" ? "symlink" : kind === "-" ? "file" : "other",
      size: Number.parseInt(sizeStr!, 10),
      mode: perms!,
      mtime: mtime!,
    });
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === "dir") return -1;
      if (b.type === "dir") return 1;
    }
    return a.name.localeCompare(b.name);
  });
}
