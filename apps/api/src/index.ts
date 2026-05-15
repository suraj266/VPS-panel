import { buildServer } from "./server.js";
import { env } from "./env.js";
import { seedAdminIfEmpty, seedDefaultProject } from "./lib/seed.js";
import { startBackupSchedule } from "./lib/backup.js";
import { startCertRenewalSchedule } from "./lib/cert-renewal.js";

const app = await buildServer();
await seedAdminIfEmpty();
await seedDefaultProject();
startBackupSchedule();
startCertRenewalSchedule();

try {
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
