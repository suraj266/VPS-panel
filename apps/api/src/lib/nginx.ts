import tar from "tar-stream";
import { docker } from "../docker.js";

const NGINX_CONTAINER = "panel_nginx";
const CONF_DIR = "/etc/nginx/conf.d";

interface UpstreamTarget {
  /** Container network alias (app.slug) */
  host: string;
  /** Port inside the container */
  port: number;
}

interface SiteConfigInput {
  hostname: string;
  upstream: UpstreamTarget;
  sslEnabled: boolean;
}

export function siteConfigFor(input: SiteConfigInput): string {
  const { hostname, upstream, sslEnabled } = input;
  const upstreamUrl = `http://${upstream.host}:${upstream.port}`;

  const httpServer = `
server {
    listen 80;
    server_name ${hostname};

    # ACME HTTP-01 challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    ${
      sslEnabled
        ? `# Force HTTPS
    location / {
        return 301 https://$host$request_uri;
    }`
        : `location / {
        proxy_pass ${upstreamUrl};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }`
    }
}
`.trim();

  const httpsServer = sslEnabled
    ? `

server {
    listen 443 ssl http2;
    server_name ${hostname};

    ssl_certificate     /etc/letsencrypt/live/${hostname}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${hostname}/privkey.pem;

    location / {
        proxy_pass ${upstreamUrl};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
`
    : "";

  return httpServer + httpsServer + "\n";
}

function buildTar(filename: string, content: string): NodeJS.ReadableStream {
  const pack = tar.pack();
  pack.entry({ name: filename, mode: 0o644 }, content);
  pack.finalize();
  return pack;
}

export async function execNginx(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const container = docker.getContainer(NGINX_CONTAINER);
  const exec = await container.exec({
    Cmd: args,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      {
        write: (chunk: Buffer) => out.push(chunk),
      } as unknown as NodeJS.WritableStream,
      {
        write: (chunk: Buffer) => err.push(chunk),
      } as unknown as NodeJS.WritableStream,
    );
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const inspect = await exec.inspect();
  return {
    stdout: Buffer.concat(out).toString("utf8"),
    stderr: Buffer.concat(err).toString("utf8"),
    exitCode: inspect.ExitCode ?? -1,
  };
}

async function writeFileToNginx(filename: string, content: string): Promise<void> {
  const container = docker.getContainer(NGINX_CONTAINER);
  await container.putArchive(buildTar(filename, content), { path: CONF_DIR });
}

async function deleteFileFromNginx(filename: string): Promise<void> {
  await execNginx(["rm", "-f", `${CONF_DIR}/${filename}`]);
}

export async function applySiteConfig(input: SiteConfigInput): Promise<void> {
  const filename = `${input.hostname}.conf`;
  const config = siteConfigFor(input);

  await writeFileToNginx(filename, config);

  const test = await execNginx(["nginx", "-t"]);
  if (test.exitCode !== 0) {
    await deleteFileFromNginx(filename);
    throw new Error(
      `nginx config invalid for ${input.hostname}:\n${test.stderr || test.stdout}`,
    );
  }

  const reload = await execNginx(["nginx", "-s", "reload"]);
  if (reload.exitCode !== 0) {
    throw new Error(`nginx reload failed: ${reload.stderr || reload.stdout}`);
  }
}

export async function removeSiteConfig(hostname: string): Promise<void> {
  const filename = `${hostname}.conf`;
  await deleteFileFromNginx(filename);
  // Reload but tolerate the error case where the file never existed.
  await execNginx(["nginx", "-s", "reload"]).catch(() => {});
}

export async function nginxIsRunning(): Promise<boolean> {
  try {
    const info = await docker.getContainer(NGINX_CONTAINER).inspect();
    return info.State.Running;
  } catch {
    return false;
  }
}
