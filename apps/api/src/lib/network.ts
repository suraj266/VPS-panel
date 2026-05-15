import { docker } from "../docker.js";

export interface NetworkAddress {
  family: "inet" | "inet6";
  address: string;
  prefixlen: number;
  scope: string;
}

export interface NetworkInterface {
  name: string;
  flags: string[];
  mtu: number;
  state: string;
  mac: string | null;
  addresses: NetworkAddress[];
}

export interface NetworkInfo {
  publicIPv4: string | null;
  publicIPv6: string | null;
  interfaces: NetworkInterface[];
}

const PUBLIC_TIMEOUT_MS = 3000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PUBLIC_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function getPublicIPv4(): Promise<string | null> {
  return (
    (await fetchText("https://api.ipify.org")) ??
    (await fetchText("https://ipv4.icanhazip.com"))
  );
}

export async function getPublicIPv6(): Promise<string | null> {
  return (
    (await fetchText("https://api6.ipify.org")) ??
    (await fetchText("https://ipv6.icanhazip.com"))
  );
}

interface IpJsonEntry {
  ifname: string;
  flags?: string[];
  mtu?: number;
  operstate?: string;
  address?: string;
  addr_info?: Array<{
    family: string;
    local: string;
    prefixlen: number;
    scope: string;
  }>;
}

/**
 * Get host network interfaces by execing `ip -j addr show` inside panel_host
 * (which runs with network_mode: host, so its interfaces == host interfaces).
 */
export async function getHostInterfaces(): Promise<NetworkInterface[]> {
  const container = docker.getContainer("panel_host");
  const exec = await container.exec({
    Cmd: ["ip", "-j", "addr", "show"],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      { write: (c: Buffer) => stdout.push(c) } as unknown as NodeJS.WritableStream,
      { write: (c: Buffer) => stderr.push(c) } as unknown as NodeJS.WritableStream,
    );
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });

  const text = Buffer.concat(stdout).toString("utf8").trim();
  if (!text) {
    throw new Error(
      `ip -j addr returned empty output; stderr=${Buffer.concat(stderr).toString("utf8")}`,
    );
  }

  const raw = JSON.parse(text) as IpJsonEntry[];

  return raw
    .filter((iface) => {
      // Skip loopback and Docker bridges — they aren't "the VPS IP" anyone cares about.
      if (iface.ifname === "lo") return false;
      if (iface.ifname.startsWith("docker")) return false;
      if (iface.ifname.startsWith("br-")) return false;
      if (iface.ifname.startsWith("veth")) return false;
      return true;
    })
    .map((iface) => ({
      name: iface.ifname,
      flags: iface.flags ?? [],
      mtu: iface.mtu ?? 0,
      state: iface.operstate ?? "UNKNOWN",
      mac: iface.address ?? null,
      addresses: (iface.addr_info ?? [])
        .filter(
          (a) =>
            (a.family === "inet" || a.family === "inet6") &&
            a.scope !== "link", // skip link-local fe80::/10 noise
        )
        .map((a) => ({
          family: a.family as "inet" | "inet6",
          address: a.local,
          prefixlen: a.prefixlen,
          scope: a.scope,
        })),
    }));
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  const [publicIPv4, publicIPv6, interfaces] = await Promise.all([
    getPublicIPv4(),
    getPublicIPv6(),
    getHostInterfaces().catch((err) => {
      // panel_host might not be running in some setups — return [] instead of failing.
      console.warn("[network] host interfaces probe failed:", err);
      return [] as NetworkInterface[];
    }),
  ]);
  return { publicIPv4, publicIPv6, interfaces };
}
