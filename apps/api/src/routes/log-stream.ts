import type { FastifyPluginAsync } from "fastify";
import { docker } from "../docker.js";

interface LogStream extends NodeJS.ReadableStream {
  destroy?: (err?: Error) => void;
}

/**
 * WebSocket route that streams a container's logs in real time.
 *
 * Docker multiplexes stdout/stderr into a single stream with an 8-byte header
 * per frame for non-TTY containers. dockerode's modem exposes `demuxStream`
 * which strips those headers and routes content to two writable streams.
 * We funnel both into the same WebSocket so the UI sees a unified log.
 */
export const logStreamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { id: string };
    Querystring: { tail?: string };
  }>(
    "/containers/:id/logs/stream",
    { websocket: true },
    async (socket, req) => {
      if (!req.userId) {
        socket.send("\r\nUnauthorized\r\n");
        socket.close();
        return;
      }

      const containerId = req.params.id;
      const tail = Number.parseInt(req.query.tail ?? "200", 10);

      let stream: LogStream | undefined;

      try {
        const container = docker.getContainer(containerId);
        stream = (await container.logs({
          stdout: true,
          stderr: true,
          follow: true,
          tail: Number.isFinite(tail) && tail > 0 ? tail : 200,
          timestamps: false,
        })) as unknown as LogStream;
      } catch (err) {
        const message = err instanceof Error ? err.message : "logs failed";
        socket.send(`\r\nerror: ${message}\r\n`);
        socket.close();
        return;
      }

      const writeToSocket = (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(chunk);
        }
      };

      // Use a fake writable to receive demuxed bytes from dockerode.
      const stdoutSink = {
        write: writeToSocket,
        end: () => {},
      } as unknown as NodeJS.WritableStream;
      const stderrSink = {
        write: writeToSocket,
        end: () => {},
      } as unknown as NodeJS.WritableStream;

      docker.modem.demuxStream(stream, stdoutSink, stderrSink);

      stream.on("end", () => {
        if (socket.readyState === socket.OPEN) socket.close();
      });
      stream.on("error", (err) => {
        req.log.warn({ err, containerId }, "logs stream error");
        if (socket.readyState === socket.OPEN) socket.close();
      });

      socket.on("close", () => {
        try {
          stream?.destroy?.();
        } catch {
          /* ignore */
        }
      });
    },
  );
};
