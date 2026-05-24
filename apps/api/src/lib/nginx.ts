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
  /**
   * Free-form nginx directives the user pasted in the per-domain Advanced
   * panel. Injected at server level inside both HTTP and HTTPS server blocks
   * so directives like client_max_body_size / proxy_read_timeout apply to all
   * locations. Null/empty = no injection.
   */
  customNginxConfig?: string | null;
}

// Render the user-supplied directives as an indented block surrounded by
// marker comments. Empty/whitespace-only input is treated as absent so the
// generated conf doesn't end up with naked markers around nothing.
function customBlock(raw: string | null | undefined, indent = "    "): string {
  if (!raw) return "";
  const normalised = raw.replace(/\r\n/g, "\n");
  if (!normalised.trim()) return "";
  const body = normalised
    .split("\n")
    .map((line) => (line.trim() ? `${indent}${line.trim()}` : ""))
    .join("\n")
    .replace(/\n+$/, "");
  return `${indent}# --- custom nginx config (panel-managed) ---
${body}
${indent}# --- end custom ---
`;
}

// Common proxy block reused by HTTP-only and HTTPS server blocks. Pulled into
// a constant so future tweaks (caching, gzip, body limits) live in one place.
//
// Notes:
//  - Connection: $connection_upgrade — we set this via a server-level `map`
//    so non-WebSocket requests get an empty Connection header (proper HTTP
//    keep-alive) while WS upgrades still flow through. The old version
//    always sent "upgrade", which confuses some backends.
//  - proxy_buffers tuned for typical SPA bundles (200-500KB JS) so we don't
//    spill responses to disk. nginx logged a warning about that on the SPA.
function proxyBlock(upstreamUrl: string): string {
  return `        proxy_pass ${upstreamUrl};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
        proxy_buffers 16 16k;
        proxy_buffer_size 32k;`;
}

export function siteConfigFor(input: SiteConfigInput): string {
  const { hostname, upstream, sslEnabled, customNginxConfig } = input;
  const upstreamUrl = `http://${upstream.host}:${upstream.port}`;

  // Per-server-name `map` that turns the HTTP Upgrade request header into a
  // proper Connection header value. WebSocket clients send `Upgrade: websocket`
  // → we forward `Connection: upgrade`. Plain HTTP clients have no Upgrade
  // header → we forward `Connection: ""` (defaults to keep-alive). Using a
  // unique variable suffix per hostname so multiple site configs co-exist
  // without "duplicate map" errors.
  const mapName = `connection_upgrade_${hostname.replace(/[^a-z0-9]/gi, "_")}`;

  const mapBlock = `map $http_upgrade $${mapName} {
    default upgrade;
    ''      "";
}
`;

  // Only inject custom directives into server blocks that actually serve the
  // app. The HTTP→HTTPS redirect variant skips them because its only job is to
  // 301 to the HTTPS block (which gets the custom block anyway).
  const custom = customBlock(customNginxConfig);

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
        : `${custom ? custom + "\n" : ""}    location / {
${proxyBlock(upstreamUrl).replace(/\$connection_upgrade/g, `$${mapName}`)}
    }`
    }
}
`.trim();

  const httpsServer = sslEnabled
    ? `

server {
    listen 443 ssl;
    http2 on;
    server_name ${hostname};

    ssl_certificate     /etc/letsencrypt/live/${hostname}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${hostname}/privkey.pem;

${custom ? custom + "\n" : ""}    location / {
${proxyBlock(upstreamUrl).replace(/\$connection_upgrade/g, `$${mapName}`)}
    }
}
`
    : "";

  return mapBlock + httpServer + httpsServer + "\n";
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

  // Back up any existing conf so a bad edit (e.g. malformed custom directives)
  // doesn't knock the live site offline — if `nginx -t` rejects the new file,
  // we restore the previous good copy. For a brand-new domain there's no
  // backup, so the rollback path falls back to deleting the file.
  const priorConfig = await readNginxConf(filename);

  await writeFileToNginx(filename, config);

  const test = await execNginx(["nginx", "-t"]);
  if (test.exitCode !== 0) {
    if (priorConfig !== null) {
      await writeFileToNginx(filename, priorConfig);
    } else {
      await deleteFileFromNginx(filename);
    }
    throw new Error(
      `nginx config invalid for ${input.hostname}:\n${test.stderr || test.stdout}`,
    );
  }

  const reload = await execNginx(["nginx", "-s", "reload"]);
  if (reload.exitCode !== 0) {
    throw new Error(`nginx reload failed: ${reload.stderr || reload.stdout}`);
  }
}

async function readNginxConf(filename: string): Promise<string | null> {
  const res = await execNginx(["cat", `${CONF_DIR}/${filename}`]);
  if (res.exitCode !== 0) return null;
  return res.stdout;
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
