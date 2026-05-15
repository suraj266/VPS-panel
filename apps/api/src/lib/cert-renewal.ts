import { prisma } from "../db.js";
import { renewAllCertificates, CERT_LIFETIME_DAYS } from "./certbot.js";
import {
  applySiteConfig,
  nginxIsRunning,
} from "./nginx.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let scheduled = false;

/**
 * Daily check: if any SSL-enabled domain has a cert that will expire within
 * 30 days, run `certbot renew` (handles all). On success, bump certExpiresAt
 * on all SSL-enabled domains and reload nginx site configs.
 *
 * Safe to call even when there's nothing to renew — certbot will no-op.
 */
export function startCertRenewalSchedule(): void {
  if (scheduled) return;
  scheduled = true;

  const run = async () => {
    try {
      if (!(await nginxIsRunning())) {
        console.log("[cert-renew] panel_nginx not running, skipping");
        return;
      }
      const sslDomains = await prisma.domain.findMany({
        where: { sslEnabled: true },
      });
      if (sslDomains.length === 0) return;

      const lines: string[] = [];
      const exit = await renewAllCertificates((l) => lines.push(l));
      if (exit !== 0) {
        console.error(
          `[cert-renew] certbot exited ${exit}: ${lines.slice(-10).join("\n")}`,
        );
        return;
      }

      // Reload nginx for any sites whose certs were swapped on disk.
      for (const d of sslDomains) {
        const app = await prisma.app.findUnique({ where: { id: d.appId } });
        if (!app) continue;
        const upstreamHost =
          app.sourceType === "git-repo" && app.buildMode === "compose"
            ? (d.serviceName ?? app.slug)
            : `panel_${app.slug}`;
        try {
          await applySiteConfig({
            hostname: d.hostname,
            upstream: { host: upstreamHost, port: d.port },
            sslEnabled: true,
          });
        } catch (err) {
          console.error(
            `[cert-renew] reapply nginx for ${d.hostname} failed:`,
            err,
          );
        }
      }

      // Optimistically bump certExpiresAt; certbot only renews within 30 days
      // of expiry, so this isn't quite accurate, but it's good enough for UI.
      const fresh = new Date(Date.now() + CERT_LIFETIME_DAYS * DAY_MS);
      await prisma.domain.updateMany({
        where: { sslEnabled: true, certExpiresAt: { lt: new Date(Date.now() + 31 * DAY_MS) } },
        data: { certExpiresAt: fresh },
      });

      console.log(
        `[cert-renew] daily ok (${sslDomains.length} ssl domains checked)`,
      );
    } catch (err) {
      console.error("[cert-renew] daily failed:", err);
    }
  };

  // First check 15 min after boot, then every 24h.
  setTimeout(run, 15 * 60 * 1000);
  setInterval(run, DAY_MS);
}
