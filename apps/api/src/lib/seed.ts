import { prisma } from "../db.js";
import { hashPassword } from "./crypto.js";
import { env } from "../env.js";

export async function seedAdminIfEmpty(): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;
  await prisma.user.create({
    data: {
      email: env.ADMIN_EMAIL,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: "admin",
    },
  });
  console.log(`[seed] admin user created: ${env.ADMIN_EMAIL}`);
}

const DEFAULT_PROJECT_SLUG = "default";

/**
 * Ensure a "Default" project exists, and assign any apps that don't yet have
 * a project to it. Idempotent — safe to run every boot.
 */
export async function seedDefaultProject(): Promise<void> {
  const project = await prisma.project.upsert({
    where: { slug: DEFAULT_PROJECT_SLUG },
    update: {},
    create: {
      slug: DEFAULT_PROJECT_SLUG,
      name: "Default",
      description: "Auto-created. Apps without an explicit project land here.",
    },
  });

  const unassigned = await prisma.app.count({ where: { projectId: null } });
  if (unassigned > 0) {
    await prisma.app.updateMany({
      where: { projectId: null },
      data: { projectId: project.id },
    });
    console.log(
      `[seed] backfilled ${unassigned} apps into the Default project`,
    );
  }
}
