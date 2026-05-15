import { docker, pullImage, type PortMapping } from "../docker.js";
import { prisma } from "../db.js";
import { decrypt } from "./crypto.js";
import { buildFromGit } from "./build.js";
import { buildCloneUrl } from "./github.js";
import {
  composeUp,
  composeDown,
  composeStop,
  ensureComposeAvailable,
  attachProjectContainersToPanelNet,
} from "./compose.js";
import { simpleGit } from "simple-git";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

function panelBuildDir(): string {
  return process.env.PANEL_BUILD_DIR ?? path.join(homedir(), ".panel-builds");
}

export function composeWorkDirFor(slug: string): string {
  return path.join(panelBuildDir(), slug);
}

function authedRepoUrl(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    u.username = "x-access-token";
    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

/**
 * For an app, return a ready-to-clone URL + display URL + branch + token
 * (when applicable). Handles both PAT mode (encrypted token in App row) and
 * GitHub App mode (mints a fresh installation token at call time).
 *
 * The returned `cloneUrl` may have a short-lived token embedded; do not
 * persist or log it.
 */
async function resolveCloneSource(appRecord: {
  repoUrl: string | null;
  branch: string | null;
  gitTokenEncrypted: string | null;
  githubInstallationId: string | null;
  githubRepoFullName: string | null;
}): Promise<{ cloneUrl: string; displayUrl: string; branch: string; gitToken?: string }> {
  if (appRecord.githubInstallationId && appRecord.githubRepoFullName) {
    const installation = await prisma.githubInstallation.findUnique({
      where: { id: appRecord.githubInstallationId },
      include: { githubApp: true },
    });
    if (!installation) {
      throw new Error("linked GitHub installation no longer exists");
    }
    const cloneUrl = await buildCloneUrl(
      {
        githubAppId: installation.githubApp.githubAppId,
        privateKeyEnc: installation.githubApp.privateKeyEnc,
      },
      installation.installationId,
      appRecord.githubRepoFullName,
    );
    return {
      cloneUrl,
      displayUrl: `https://github.com/${appRecord.githubRepoFullName}.git`,
      branch: appRecord.branch ?? "main",
    };
  }

  if (!appRecord.repoUrl) throw new Error("app has no repoUrl");
  const gitToken = appRecord.gitTokenEncrypted
    ? decrypt(appRecord.gitTokenEncrypted)
    : undefined;
  return {
    cloneUrl: authedRepoUrl(appRecord.repoUrl, gitToken),
    displayUrl: appRecord.repoUrl,
    branch: appRecord.branch ?? "main",
    gitToken,
  };
}

export interface RuntimeConfig {
  ports?: PortMapping[];
  restartPolicy?: "no" | "unless-stopped" | "always" | "on-failure";
  cmd?: string[];
}

export function containerNameFor(slug: string): string {
  return `panel_${slug}`;
}

async function removeIfExists(name: string) {
  try {
    await docker.getContainer(name).remove({ force: true });
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode !== 404) throw err;
  }
}

interface RunContainerInput {
  slug: string;
  imageTag: string;
  envVars: Array<{ key: string; valueEncrypted: string }>;
  runtime: RuntimeConfig;
  deploymentId: string;
  appId: string;
  log: (line: string) => void;
}

async function runContainer(input: RunContainerInput): Promise<string> {
  const { slug, imageTag, envVars, runtime, deploymentId, appId, log } = input;
  const containerName = containerNameFor(slug);

  log(`removing existing container ${containerName} (if any)`);
  await removeIfExists(containerName);

  const env = envVars.map(
    (v) => `${v.key}=${decrypt(v.valueEncrypted)}`,
  );

  const exposedPorts: Record<string, Record<string, never>> = {};
  const portBindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const p of runtime.ports ?? []) {
    const key = `${p.container}/${p.proto ?? "tcp"}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(p.host) }];
  }

  log(`creating container ${containerName} from ${imageTag}`);
  const container = await docker.createContainer({
    name: containerName,
    Image: imageTag,
    Env: env,
    Cmd: runtime.cmd,
    ExposedPorts: exposedPorts,
    Labels: {
      "panel.app": slug,
      "panel.app_id": appId,
      "panel.deployment_id": deploymentId,
      "panel.managed": "true",
    },
    HostConfig: {
      PortBindings: portBindings,
      RestartPolicy: { Name: runtime.restartPolicy ?? "unless-stopped" },
      NetworkMode: "panel_net",
    },
    NetworkingConfig: {
      EndpointsConfig: {
        panel_net: { Aliases: [slug] },
      },
    },
  });

  log(`starting container ${container.id.slice(0, 12)}`);
  await container.start();
  return container.id;
}

export interface DeployMeta {
  trigger?: "manual" | "webhook";
  commitMessage?: string;
}

export async function deployApp(
  appId: string,
  meta: DeployMeta = {},
): Promise<{
  deploymentId: string;
  containerId: string;
}> {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: { envVars: true },
  });
  if (!app.imageRef) throw new Error("app has no imageRef");

  const runtime = (app.runtimeConfig as RuntimeConfig | null) ?? {};

  const deployment = await prisma.deployment.create({
    data: {
      appId: app.id,
      imageTag: app.imageRef,
      status: "building",
      log: "",
      trigger: meta.trigger ?? "manual",
      commitMessage: meta.commitMessage,
    },
  });

  const lines: string[] = [];
  const log = (line: string) =>
    lines.push(`[${new Date().toISOString()}] ${line}`);

  try {
    log(`pulling ${app.imageRef}`);
    await pullImage(app.imageRef);

    const containerId = await runContainer({
      slug: app.slug,
      imageTag: app.imageRef,
      envVars: app.envVars,
      runtime,
      deploymentId: deployment.id,
      appId: app.id,
      log,
    });

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });

    return { deploymentId: deployment.id, containerId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    throw err;
  }
}

export async function buildAndDeployApp(
  appId: string,
  meta: DeployMeta = {},
): Promise<{
  deploymentId: string;
  containerId: string;
  imageTag: string;
}> {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: { envVars: true },
  });
  if (app.sourceType !== "git-repo") {
    throw new Error("app is not a git-repo source");
  }
  if (!app.branch) {
    throw new Error("app missing branch");
  }

  const runtime = (app.runtimeConfig as RuntimeConfig | null) ?? {};

  const deployment = await prisma.deployment.create({
    data: {
      appId: app.id,
      imageTag: "(pending)",
      status: "building",
      log: "",
      trigger: meta.trigger ?? "manual",
      commitMessage: meta.commitMessage,
    },
  });

  const lines: string[] = [];
  const log = (line: string) =>
    lines.push(`[${new Date().toISOString()}] ${line}`);

  // Periodically flush log lines to DB so the UI can poll progress
  const flushInterval = setInterval(() => {
    prisma.deployment
      .update({
        where: { id: deployment.id },
        data: { log: lines.join("\n") },
      })
      .catch(() => {});
  }, 1500);

  try {
    log(`starting build for ${app.slug}`);
    const source = await resolveCloneSource(app);
    log(`source: ${source.displayUrl} @ ${source.branch}`);

    const buildMode = (app.buildMode === "static" ? "static" : "dockerfile") as
      | "static"
      | "dockerfile";

    // We pass the (potentially pre-authed) cloneUrl directly. For GitHub App
    // mode the URL already has a short-lived token embedded; gitToken stays
    // undefined to avoid double-injecting credentials.
    const { imageTag, gitSha } = await buildFromGit({
      slug: app.slug,
      repoUrl: source.cloneUrl,
      branch: source.branch,
      buildMode,
      dockerfilePath: app.dockerfilePath ?? "Dockerfile",
      publishDir: app.publishDir ?? ".",
      gitToken: source.gitToken,
      onLog: log,
    });

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { imageTag, gitSha },
    });

    const containerId = await runContainer({
      slug: app.slug,
      imageTag,
      envVars: app.envVars,
      runtime,
      deploymentId: deployment.id,
      appId: app.id,
      log,
    });

    clearInterval(flushInterval);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });

    return { deploymentId: deployment.id, containerId, imageTag };
  } catch (err) {
    clearInterval(flushInterval);
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    throw err;
  }
}

export async function composeDeployApp(
  appId: string,
  meta: DeployMeta = {},
): Promise<{
  deploymentId: string;
}> {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: { envVars: true },
  });
  if (app.sourceType !== "git-repo" || app.buildMode !== "compose") {
    throw new Error("app is not a compose source");
  }
  if (!app.branch) {
    throw new Error("app missing branch");
  }
  if (!app.repoUrl && !(app.githubInstallationId && app.githubRepoFullName)) {
    throw new Error("app missing repo source");
  }

  await ensureComposeAvailable();

  const composeFile = app.composePath ?? "docker-compose.yml";
  const workDir = composeWorkDirFor(app.slug);

  const deployment = await prisma.deployment.create({
    data: {
      appId: app.id,
      imageTag: `compose:${app.slug}`,
      status: "building",
      log: "",
      trigger: meta.trigger ?? "manual",
      commitMessage: meta.commitMessage,
    },
  });

  const lines: string[] = [];
  const log = (line: string) =>
    lines.push(`[${new Date().toISOString()}] ${line}`);

  const flushInterval = setInterval(() => {
    prisma.deployment
      .update({
        where: { id: deployment.id },
        data: { log: lines.join("\n") },
      })
      .catch(() => {});
  }, 1500);

  try {
    // 1. Fresh clone (remove existing workdir to get latest)
    log(`preparing workdir ${workDir}`);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(path.dirname(workDir), { recursive: true });

    const source = await resolveCloneSource(app);
    log(`cloning ${source.displayUrl} (branch=${source.branch})`);
    await simpleGit().clone(source.cloneUrl, workDir, [
      "--depth",
      "1",
      "--branch",
      source.branch,
      "--single-branch",
    ]);

    // 2. Verify compose file exists
    try {
      await stat(path.join(workDir, composeFile));
    } catch {
      throw new Error(`${composeFile} not found in repo`);
    }

    const sha = (await simpleGit(workDir).revparse(["HEAD"]))
      .trim()
      .slice(0, 12);
    log(`HEAD: ${sha}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: { gitSha: sha },
    });

    // 3. Prepare env vars
    const envFileLines = app.envVars.map(
      (v) => `${v.key}=${decrypt(v.valueEncrypted)}`,
    );

    // 4. compose up
    log(`compose up: project=panel_${app.slug}`);
    await composeUp({
      slug: app.slug,
      workDir,
      composeFile,
      envFileLines,
      onLog: log,
    });

    // 5. Attach all project containers to panel_net so nginx can reach them
    log(`attaching services to panel_net`);
    await attachProjectContainersToPanelNet(app.slug, log);

    clearInterval(flushInterval);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    return { deploymentId: deployment.id };
  } catch (err) {
    clearInterval(flushInterval);
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    throw err;
  }
}

/**
 * Redeploy the app using an image tag that already exists locally — typically
 * an old build's tag from a previous deployment. No pull, no clone, no build.
 * Creates a new Deployment row with trigger="rollback".
 *
 * Not supported for compose apps (their state lives in the workdir + compose
 * file at a specific commit; proper rollback needs re-clone at old SHA).
 */
export async function redeployToImageTag(
  appId: string,
  imageTag: string,
  source: { fromDeploymentId: string; gitSha?: string | null; commitMessage?: string | null },
): Promise<{ deploymentId: string; containerId: string }> {
  const app = await prisma.app.findUniqueOrThrow({
    where: { id: appId },
    include: { envVars: true },
  });

  if (app.sourceType === "git-repo" && app.buildMode === "compose") {
    throw new Error("rollback not supported for compose apps");
  }

  const runtime = (app.runtimeConfig as RuntimeConfig | null) ?? {};

  const deployment = await prisma.deployment.create({
    data: {
      appId: app.id,
      imageTag,
      gitSha: source.gitSha ?? undefined,
      status: "building",
      log: "",
      trigger: "rollback",
      commitMessage: source.commitMessage
        ? `rollback to: ${source.commitMessage}`
        : `rollback of deployment ${source.fromDeploymentId.slice(0, 8)}`,
    },
  });

  const lines: string[] = [];
  const log = (line: string) =>
    lines.push(`[${new Date().toISOString()}] ${line}`);

  try {
    log(`rolling back to image ${imageTag}`);
    // Verify image exists locally (for prebuilt-image apps we may need to pull).
    if (app.sourceType === "prebuilt-image") {
      log(`pulling ${imageTag} (prebuilt-image source)`);
      await pullImage(imageTag);
    } else {
      log(`reusing locally-built image (no rebuild)`);
    }

    const containerId = await runContainer({
      slug: app.slug,
      imageTag,
      envVars: app.envVars,
      runtime,
      deploymentId: deployment.id,
      appId: app.id,
      log,
    });

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    return { deploymentId: deployment.id, containerId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        log: lines.join("\n"),
      },
    });
    throw err;
  }
}

export async function stopAppContainer(slug: string): Promise<void> {
  const app = await prisma.app.findUnique({ where: { slug } });
  if (app?.sourceType === "git-repo" && app.buildMode === "compose") {
    const workDir = composeWorkDirFor(slug);
    const composeFile = app.composePath ?? "docker-compose.yml";
    await composeStop(slug, workDir, composeFile);
    return;
  }
  const name = containerNameFor(slug);
  try {
    await docker.getContainer(name).stop();
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode !== 304 && e.statusCode !== 404) throw err;
  }
}

export async function removeAppContainer(slug: string): Promise<void> {
  const app = await prisma.app.findUnique({ where: { slug } });
  if (app?.sourceType === "git-repo" && app.buildMode === "compose") {
    const workDir = composeWorkDirFor(slug);
    const composeFile = app.composePath ?? "docker-compose.yml";
    await composeDown(slug, workDir, composeFile);
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    return;
  }
  await removeIfExists(containerNameFor(slug));
}
