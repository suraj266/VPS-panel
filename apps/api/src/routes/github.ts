import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { prisma } from "../db.js";
import { requireAuth } from "../plugins/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { recordAudit } from "../lib/audit.js";
import {
  listInstallations,
  listInstallationRepos,
  listRepoBranches,
} from "../lib/github.js";
import {
  verifyGithubSignature,
  parsePushEvent,
} from "../lib/webhook.js";
import {
  buildAndDeployApp,
  composeDeployApp,
} from "../lib/deploy.js";

const idParam = z.object({ id: z.string().min(1) });

interface ManifestConversionResponse {
  id: number;
  slug: string;
  name: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
  html_url: string;
}

interface InstallationEventPayload {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
      type: string;
      avatar_url?: string;
    };
    repository_selection: string;
    suspended_at?: string | null;
  };
}

async function upsertInstallation(
  githubAppRowId: string,
  payload: InstallationEventPayload["installation"],
): Promise<void> {
  await prisma.githubInstallation.upsert({
    where: { installationId: payload.id },
    create: {
      githubAppId: githubAppRowId,
      installationId: payload.id,
      accountLogin: payload.account.login,
      accountId: payload.account.id,
      accountType: payload.account.type,
      accountAvatarUrl: payload.account.avatar_url ?? null,
      repositorySelection: payload.repository_selection,
      suspendedAt: payload.suspended_at ? new Date(payload.suspended_at) : null,
    },
    update: {
      accountLogin: payload.account.login,
      accountType: payload.account.type,
      accountAvatarUrl: payload.account.avatar_url ?? null,
      repositorySelection: payload.repository_selection,
      suspendedAt: payload.suspended_at ? new Date(payload.suspended_at) : null,
    },
  });
}

export const githubRoutes: FastifyPluginAsync = async (app) => {
  // --- Manifest registration flow ---------------------------------------
  // The frontend POSTs here to get a manifest payload to send to GitHub. The
  // panel decides the app's permissions and webhook URL; the user just names
  // it on GitHub.
  app.post("/github-apps/manifest", async (req, reply) => {
    requireAuth(req);
    const { origin } = z
      .object({
        origin: z.string().url(),
        // `state` is still accepted from the client (it's appended to the
        // GitHub form action URL by the frontend), but we do NOT bake it
        // into redirect_url — GitHub adds `state` (and `code`) to the
        // redirect itself, and rejects manifests whose redirect_url has
        // arbitrary query strings ("redirect_url must be a valid URL").
        state: z.string().min(8).optional(),
      })
      .parse(req.body);

    const manifest = {
      name: "VPS Panel",
      url: origin,
      hook_attributes: {
        url: `${origin}/api/github/webhook`,
        active: true,
      },
      redirect_url: `${origin}/api/github-apps/callback`,
      // GitHub requires callback_urls but we don't use OAuth user-auth flow;
      // point at the same callback route as a placeholder.
      callback_urls: [`${origin}/api/github-apps/callback`],
      public: false,
      default_permissions: {
        contents: "read",
        metadata: "read",
        // Optional for future commit status posting:
        statuses: "write",
        pull_requests: "read",
      },
      default_events: ["push", "pull_request"],
    };

    return { manifest };
  });

  // Step 2 of manifest flow — GitHub redirects here with a code that we
  // exchange for the app credentials. This route DOES require auth because
  // the user just came back from GitHub in the browser; cookie is intact.
  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/github-apps/callback",
    async (req, reply) => {
      requireAuth(req);
      const { code } = req.query;
      if (!code) {
        return reply.code(400).send({ error: "missing code" });
      }

      const octo = new Octokit();
      const r = await octo.request("POST /app-manifests/{code}/conversions", {
        code,
      });
      const data = r.data as unknown as ManifestConversionResponse;

      const stored = await prisma.githubApp.create({
        data: {
          githubAppId: data.id,
          slug: data.slug,
          name: data.name,
          privateKeyEnc: encrypt(data.pem),
          webhookSecretEnc: encrypt(data.webhook_secret),
          clientId: data.client_id,
          clientSecretEnc: encrypt(data.client_secret),
          htmlUrl: data.html_url,
          createdBy: req.userId ?? null,
        },
      });

      await recordAudit(req, {
        action: "github.app.register",
        targetType: "github-app",
        targetId: stored.id,
        diff: { slug: stored.slug, name: stored.name },
      });

      // Bounce the user back to the integrations page with a flag so the UI
      // can immediately prompt "Install on an account".
      const dest = `/integrations?registered=${stored.id}`;
      return reply.redirect(dest);
    },
  );

  // --- App / installation listings --------------------------------------
  app.get("/github-apps", async (req) => {
    requireAuth(req);
    const apps = await prisma.githubApp.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        installations: {
          orderBy: { accountLogin: "asc" },
        },
      },
    });
    // Strip encrypted secrets from the response.
    return apps.map((a) => ({
      id: a.id,
      githubAppId: a.githubAppId,
      slug: a.slug,
      name: a.name,
      htmlUrl: a.htmlUrl,
      createdAt: a.createdAt,
      installUrl: `${a.htmlUrl}/installations/new`,
      installations: a.installations.map((i) => ({
        id: i.id,
        installationId: i.installationId,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        accountAvatarUrl: i.accountAvatarUrl,
        repositorySelection: i.repositorySelection,
        suspendedAt: i.suspendedAt,
      })),
    }));
  });

  app.delete("/github-apps/:id", async (req) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const app = await prisma.githubApp.findUnique({ where: { id } });
    if (!app) return { ok: true };
    await prisma.githubApp.delete({ where: { id } });
    await recordAudit(req, {
      action: "github.app.disconnect",
      targetType: "github-app",
      targetId: id,
      diff: { slug: app.slug },
    });
    return { ok: true };
  });

  // Refresh installations from GitHub (for the case where webhook events were
  // missed before the app was registered in the panel).
  app.post("/github-apps/:id/refresh-installations", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const app = await prisma.githubApp.findUnique({ where: { id } });
    if (!app) return reply.code(404).send({ error: "not found" });

    const installs = await listInstallations({
      githubAppId: app.githubAppId,
      privateKeyEnc: app.privateKeyEnc,
    });

    for (const inst of installs) {
      await prisma.githubInstallation.upsert({
        where: { installationId: inst.installationId },
        create: {
          githubAppId: app.id,
          installationId: inst.installationId,
          accountLogin: inst.accountLogin,
          accountId: inst.accountId,
          accountType: inst.accountType,
          accountAvatarUrl: inst.accountAvatarUrl,
          repositorySelection: inst.repositorySelection,
          suspendedAt: inst.suspendedAt,
        },
        update: {
          accountLogin: inst.accountLogin,
          accountType: inst.accountType,
          accountAvatarUrl: inst.accountAvatarUrl,
          repositorySelection: inst.repositorySelection,
          suspendedAt: inst.suspendedAt,
        },
      });
    }

    return { count: installs.length };
  });

  app.get("/github-installations/:id/repos", async (req, reply) => {
    requireAuth(req);
    const { id } = idParam.parse(req.params);
    const installation = await prisma.githubInstallation.findUnique({
      where: { id },
      include: { githubApp: true },
    });
    if (!installation) return reply.code(404).send({ error: "not found" });

    try {
      const repos = await listInstallationRepos(
        {
          githubAppId: installation.githubApp.githubAppId,
          privateKeyEnc: installation.githubApp.privateKeyEnc,
        },
        installation.installationId,
      );
      return { repos };
    } catch (err) {
      const message = err instanceof Error ? err.message : "repo list failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.get(
    "/github-installations/:id/repos/:owner/:repo/branches",
    async (req, reply) => {
      requireAuth(req);
      const { id, owner, repo } = z
        .object({
          id: z.string().min(1),
          owner: z.string().min(1),
          repo: z.string().min(1),
        })
        .parse(req.params);
      const installation = await prisma.githubInstallation.findUnique({
        where: { id },
        include: { githubApp: true },
      });
      if (!installation) return reply.code(404).send({ error: "not found" });

      try {
        const branches = await listRepoBranches(
          {
            githubAppId: installation.githubApp.githubAppId,
            privateKeyEnc: installation.githubApp.privateKeyEnc,
          },
          installation.installationId,
          owner,
          repo,
        );
        return { branches };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "branch list failed";
        return reply.code(500).send({ error: message });
      }
    },
  );

  // --- Single global GitHub App webhook receiver ------------------------
  //
  // Configured at app-manifest time as ${origin}/api/github/webhook. GitHub
  // signs each delivery with the app's webhook_secret. We try every
  // registered app's secret because we don't know which app fired the event
  // until the signature matches.
  app.removeContentTypeParser(["application/json"]);
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.post("/github/webhook", async (req, reply) => {
    const headers = req.headers;
    const sig = headers["x-hub-signature-256"] as string | undefined;
    const event = headers["x-github-event"] as string | undefined;
    const rawBody =
      (req as unknown as { rawBody?: string }).rawBody ??
      JSON.stringify(req.body ?? {});

    if (!sig || !event) {
      return reply.code(400).send({ error: "missing signature/event" });
    }

    // Find which GitHub App this belongs to by trying each registered secret.
    const allApps = await prisma.githubApp.findMany();
    let matched: (typeof allApps)[number] | null = null;
    for (const a of allApps) {
      const secret = decrypt(a.webhookSecretEnc);
      if (verifyGithubSignature(rawBody, sig, secret)) {
        matched = a;
        break;
      }
    }
    if (!matched) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const body = req.body as Record<string, unknown>;

    // installation / installation_repositories — keep our DB in sync
    if (event === "installation") {
      const payload = body as unknown as InstallationEventPayload;
      const action = payload.action;
      if (action === "created" || action === "unsuspend") {
        await upsertInstallation(matched.id, payload.installation);
      } else if (action === "deleted") {
        await prisma.githubInstallation
          .delete({ where: { installationId: payload.installation.id } })
          .catch(() => {});
      } else if (action === "suspend") {
        await prisma.githubInstallation
          .update({
            where: { installationId: payload.installation.id },
            data: { suspendedAt: new Date() },
          })
          .catch(() => {});
      }
      return reply.code(202).send({ handled: action });
    }

    if (event === "installation_repositories") {
      // Repo set changed for this installation; we don't cache repos in DB so
      // nothing to do beyond acknowledging.
      return reply.code(202).send({ handled: "ack" });
    }

    if (event === "push") {
      const push = parsePushEvent(body);
      const repo = body.repository as
        | { full_name?: string; id?: number }
        | undefined;
      const installationId = (
        body.installation as { id?: number } | undefined
      )?.id;
      if (!push || !repo?.full_name || !installationId) {
        return reply.code(202).send({ skipped: "incomplete push payload" });
      }

      // Find all apps watching this repo on this installation.
      const installation = await prisma.githubInstallation.findUnique({
        where: { installationId },
      });
      if (!installation) {
        return reply.code(202).send({ skipped: "unknown installation" });
      }

      const targetApps = await prisma.app.findMany({
        where: {
          githubInstallationId: installation.id,
          githubRepoFullName: repo.full_name,
        },
      });

      for (const targetApp of targetApps) {
        if (targetApp.branch && push.branch !== targetApp.branch) continue;
        const meta = {
          trigger: "webhook" as const,
          commitMessage: push.commitMessage,
        };
        const deployFn =
          targetApp.buildMode === "compose"
            ? () => composeDeployApp(targetApp.id, meta)
            : () => buildAndDeployApp(targetApp.id, meta);
        setImmediate(async () => {
          try {
            await deployFn();
          } catch (err) {
            req.log.error(
              { err, appId: targetApp.id },
              "github-app webhook deploy failed",
            );
          }
        });
      }

      return reply.code(202).send({
        queued: targetApps.length,
        branch: push.branch,
        sha: push.sha,
      });
    }

    return reply.code(202).send({ handled: "ignored" });
  });
};
