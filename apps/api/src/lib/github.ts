import { App as OctokitApp } from "@octokit/app";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { decrypt } from "./crypto.js";

interface StoredGithubApp {
  githubAppId: number;
  privateKeyEnc: string;
}

function appPrivateKey(app: StoredGithubApp): string {
  return decrypt(app.privateKeyEnc);
}

/**
 * Octokit instance authenticated as the GitHub App itself (JWT). Use for
 * app-level reads (installation listing, app metadata).
 */
export function appClient(app: StoredGithubApp): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: app.githubAppId,
      privateKey: appPrivateKey(app),
    },
  });
}

/**
 * Octokit instance authenticated as a specific installation. Installation
 * tokens are short-lived (1h) but @octokit/auth-app auto-refreshes them
 * transparently.
 */
export function installationClient(
  app: StoredGithubApp,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: app.githubAppId,
      privateKey: appPrivateKey(app),
      installationId,
    },
  });
}

/**
 * Mint a one-shot installation access token. Returned token is valid for ~1h
 * and is used to compose authenticated clone URLs:
 *   https://x-access-token:<token>@github.com/owner/repo.git
 */
export async function mintInstallationToken(
  app: StoredGithubApp,
  installationId: number,
): Promise<string> {
  const octoApp = new OctokitApp({
    appId: app.githubAppId,
    privateKey: appPrivateKey(app),
  });
  const octo = await octoApp.getInstallationOctokit(installationId);
  // octo.auth() returns the current installation token (auto-refreshed).
  const auth = (await octo.auth({ type: "installation" })) as {
    token: string;
    expiresAt: string;
  };
  return auth.token;
}

export interface InstallationSummary {
  installationId: number;
  accountLogin: string;
  accountId: number;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
  suspendedAt: Date | null;
}

export async function listInstallations(
  app: StoredGithubApp,
): Promise<InstallationSummary[]> {
  const octo = appClient(app);
  const installations = await octo.paginate(octo.apps.listInstallations, {
    per_page: 100,
  });
  return installations.map((i) => ({
    installationId: i.id,
    accountLogin: (i.account as { login?: string })?.login ?? "(unknown)",
    accountId: (i.account as { id?: number })?.id ?? 0,
    accountType: (i.account as { type?: string })?.type ?? "User",
    accountAvatarUrl: (i.account as { avatar_url?: string })?.avatar_url ?? null,
    repositorySelection: i.repository_selection,
    suspendedAt: i.suspended_at ? new Date(i.suspended_at) : null,
  }));
}

export interface RepoSummary {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  pushedAt: string | null;
}

export async function listInstallationRepos(
  app: StoredGithubApp,
  installationId: number,
): Promise<RepoSummary[]> {
  const octo = installationClient(app, installationId);
  const repos = await octo.paginate(octo.apps.listReposAccessibleToInstallation, {
    per_page: 100,
  });
  return repos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description,
    htmlUrl: r.html_url,
    pushedAt: r.pushed_at,
  }));
}

export interface BranchSummary {
  name: string;
  sha: string;
  isDefault: boolean;
}

export async function listRepoBranches(
  app: StoredGithubApp,
  installationId: number,
  owner: string,
  repo: string,
): Promise<BranchSummary[]> {
  const octo = installationClient(app, installationId);
  // Pull repo to know default branch, plus branches list.
  const [{ data: repoData }, branches] = await Promise.all([
    octo.repos.get({ owner, repo }),
    octo.paginate(octo.repos.listBranches, {
      owner,
      repo,
      per_page: 100,
    }),
  ]);
  return branches.map((b) => ({
    name: b.name,
    sha: b.commit.sha,
    isDefault: b.name === repoData.default_branch,
  }));
}

/**
 * Build an authenticated clone URL using a fresh installation token. The token
 * is embedded in the URL; never persist this URL anywhere.
 */
export async function buildCloneUrl(
  app: StoredGithubApp,
  installationId: number,
  repoFullName: string,
): Promise<string> {
  const token = await mintInstallationToken(app, installationId);
  return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}
