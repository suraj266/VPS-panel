import { docker, pullImage } from "../docker.js";

const CERTBOT_IMAGE = "certbot/certbot:latest";

// Standard Let's Encrypt cert lifetime is 90 days. We schedule renewal well
// before then (60 days into the validity).
export const CERT_LIFETIME_DAYS = 90;
export const RENEWAL_WINDOW_DAYS = 30;

export interface IssueCertInput {
  hostname: string;
  email: string;
  staging?: boolean;
  onLog: (line: string) => void;
}

export interface IssueCertResult {
  hostname: string;
  expiresAt: Date;
  staging: boolean;
}

interface NginxVolumes {
  webroot: string; // volume name
  certs: string; // volume name
}

/**
 * Look up the actual Docker volume names backing the panel_nginx container's
 * webroot + certs mounts. This works whether the panel runs from
 * docker-compose.dev.yml (project-prefixed volumes) or any other naming
 * scheme — we just trust whatever is already attached to panel_nginx.
 */
async function findNginxVolumes(): Promise<NginxVolumes> {
  const info = await docker.getContainer("panel_nginx").inspect();
  const webroot = info.Mounts.find(
    (m) => m.Destination === "/var/www/certbot",
  )?.Name;
  const certs = info.Mounts.find(
    (m) => m.Destination === "/etc/letsencrypt",
  )?.Name;
  if (!webroot || !certs) {
    throw new Error(
      "panel_nginx is missing required volume mounts (/var/www/certbot and /etc/letsencrypt). Check docker-compose config.",
    );
  }
  return { webroot, certs };
}

async function runCertbot(args: string[], onLog: (line: string) => void): Promise<number> {
  await pullImage(CERTBOT_IMAGE);
  const volumes = await findNginxVolumes();

  const out: Buffer[] = [];

  // dockerode.run() creates + starts + waits for exit. We pipe a sink that
  // both buffers and forwards lines.
  const sink = {
    write: (chunk: Buffer) => {
      out.push(chunk);
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog(line);
      }
      return true;
    },
    end: () => {},
  } as unknown as NodeJS.WritableStream;

  const [result] = (await docker.run(CERTBOT_IMAGE, args, sink, {
    HostConfig: {
      AutoRemove: true,
      Binds: [
        `${volumes.webroot}:/var/www/certbot`,
        `${volumes.certs}:/etc/letsencrypt`,
      ],
    },
  })) as unknown as Array<{ StatusCode: number }>;
  return result?.StatusCode ?? -1;
}

export async function issueCertificate(
  input: IssueCertInput,
): Promise<IssueCertResult> {
  const args = [
    "certonly",
    "--webroot",
    "-w",
    "/var/www/certbot",
    "-d",
    input.hostname,
    "--email",
    input.email,
    "--agree-tos",
    "--non-interactive",
    "--no-eff-email",
    ...(input.staging ? ["--staging"] : []),
  ];
  input.onLog(`certbot ${args.join(" ")}`);
  const exit = await runCertbot(args, input.onLog);
  if (exit !== 0) {
    throw new Error(`certbot exited ${exit}; see logs above`);
  }
  return {
    hostname: input.hostname,
    expiresAt: new Date(Date.now() + CERT_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
    staging: input.staging ?? false,
  };
}

/**
 * Run `certbot renew` for all certs in the volume. Certbot only actually
 * renews ones in the renewal window, so this is safe to call daily.
 */
export async function renewAllCertificates(
  onLog: (line: string) => void = () => {},
): Promise<number> {
  const args = [
    "renew",
    "--webroot",
    "--webroot-path",
    "/var/www/certbot",
    "--non-interactive",
  ];
  onLog(`certbot ${args.join(" ")}`);
  return runCertbot(args, onLog);
}
