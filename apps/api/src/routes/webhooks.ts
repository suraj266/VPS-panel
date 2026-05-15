import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db.js";
import {
  verifyGithubSignature,
  verifyGitlabToken,
  parsePushEvent,
} from "../lib/webhook.js";
import {
  buildAndDeployApp,
  composeDeployApp,
} from "../lib/deploy.js";

/**
 * Webhook receiver. Registered in its own Fastify scope so we can capture
 * the raw JSON body for HMAC verification.
 *
 * NOT auth-protected — anyone with the URL + matching signature can trigger.
 * Per-app shared secret is the only auth.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Override the JSON parser within this plugin scope so we get the raw body.
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

  app.post("/webhooks/:appId", async (req, reply) => {
    const params = req.params as { appId?: string };
    const appId = params.appId;
    if (!appId) return reply.code(400).send({ error: "missing appId" });

    const appRecord = await prisma.app.findUnique({ where: { id: appId } });
    if (!appRecord || !appRecord.webhookSecret) {
      return reply.code(404).send({ error: "unknown webhook" });
    }
    if (appRecord.sourceType !== "git-repo") {
      return reply.code(400).send({ error: "app is not git-backed" });
    }

    const headers = req.headers;
    const rawBody =
      (req as unknown as { rawBody?: string }).rawBody ??
      JSON.stringify(req.body ?? {});

    // GitHub or GitLab?
    const ghSig = headers["x-hub-signature-256"] as string | undefined;
    const glToken = headers["x-gitlab-token"] as string | undefined;

    let verified = false;
    if (ghSig) {
      verified = verifyGithubSignature(rawBody, ghSig, appRecord.webhookSecret);
    } else if (glToken) {
      verified = verifyGitlabToken(glToken, appRecord.webhookSecret);
    }

    if (!verified) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    // Only react to push events
    const event =
      (headers["x-github-event"] as string | undefined) ??
      (headers["x-gitlab-event"] as string | undefined);
    const isPush =
      event === "push" || event === "Push Hook" || event === undefined;
    if (!isPush) {
      return reply.code(202).send({ skipped: `event=${event}` });
    }

    const push = parsePushEvent(req.body);
    if (!push) {
      return reply.code(202).send({ skipped: "not a branch push" });
    }

    if (appRecord.branch && push.branch !== appRecord.branch) {
      return reply.code(202).send({
        skipped: `branch ${push.branch} != watched ${appRecord.branch}`,
      });
    }

    // Kick off deploy async — return immediately so the webhook caller isn't blocked.
    const meta = {
      trigger: "webhook" as const,
      commitMessage: push.commitMessage,
    };
    const deployFn =
      appRecord.buildMode === "compose"
        ? () => composeDeployApp(appRecord.id, meta)
        : () => buildAndDeployApp(appRecord.id, meta);

    setImmediate(async () => {
      try {
        await deployFn();
      } catch (err) {
        req.log.error({ err, appId }, "webhook-triggered deploy failed");
      }
    });

    req.log.info(
      {
        appId,
        slug: appRecord.slug,
        branch: push.branch,
        sha: push.sha,
      },
      "webhook accepted, deploy queued",
    );

    return reply.code(202).send({
      queued: true,
      branch: push.branch,
      sha: push.sha,
    });
  });
};
