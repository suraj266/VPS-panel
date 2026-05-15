import type { FastifyPluginAsync } from "fastify";
import { docker } from "../docker.js";

const ALLOWED_SHELLS = ["/bin/sh", "/bin/bash", "/bin/ash", "/bin/zsh"];

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function isResizeMessage(v: unknown): v is ResizeMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "resize" &&
    typeof (v as { cols?: unknown }).cols === "number" &&
    typeof (v as { rows?: unknown }).rows === "number"
  );
}

export const terminalRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { id: string };
    Querystring: { cmd?: string };
  }>(
    "/containers/:id/terminal",
    { websocket: true },
    async (socket, req) => {
      // Cookie-based auth ran in preHandler hook of authPlugin
      if (!req.userId) {
        socket.send("\r\nUnauthorized\r\n");
        socket.close();
        return;
      }

      const containerId = req.params.id;
      const requestedShell = req.query.cmd ?? "/bin/sh";
      const shell = ALLOWED_SHELLS.includes(requestedShell)
        ? requestedShell
        : "/bin/sh";

      let exec;
      let stream: NodeJS.ReadWriteStream | null = null;

      try {
        const container = docker.getContainer(containerId);
        exec = await container.exec({
          Cmd: [shell],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Env: ["TERM=xterm-256color"],
        });

        stream = (await exec.start({
          hijack: true,
          stdin: true,
        })) as unknown as NodeJS.ReadWriteStream;
      } catch (err) {
        const message = err instanceof Error ? err.message : "exec failed";
        socket.send(`\r\nerror: ${message}\r\n`);
        socket.close();
        return;
      }

      // Pipe Docker -> WebSocket
      stream.on("data", (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(chunk);
        }
      });

      stream.on("end", () => {
        if (socket.readyState === socket.OPEN) socket.close();
      });

      stream.on("error", (err) => {
        req.log.warn({ err, containerId }, "terminal stream error");
        if (socket.readyState === socket.OPEN) socket.close();
      });

      // Pipe WebSocket -> Docker (and handle resize control messages)
      socket.on("message", (raw: Buffer) => {
        if (!stream) return;
        // Try parse JSON control message first
        const text = raw.toString("utf8");
        if (text.startsWith("{")) {
          try {
            const parsed: unknown = JSON.parse(text);
            if (isResizeMessage(parsed)) {
              exec
                ?.resize({ h: parsed.rows, w: parsed.cols })
                .catch((err: unknown) => {
                  req.log.warn(
                    { err, containerId },
                    "resize failed",
                  );
                });
              return;
            }
          } catch {
            // not JSON — treat as input
          }
        }
        stream.write(raw);
      });

      socket.on("close", () => {
        stream?.end();
      });
    },
  );
};
