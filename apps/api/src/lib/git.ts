import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  /** Optional PAT for private repos (e.g. GitHub fine-grained token). */
  token?: string;
}

export interface CloneResult {
  /** Absolute path to the cloned working tree. Caller must cleanup() when done. */
  dir: string;
  /** Short SHA of the checked-out commit. */
  sha: string;
  cleanup: () => Promise<void>;
}

function injectToken(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    // x-access-token works for GitHub PATs; for GitLab use "oauth2".
    u.username = "x-access-token";
    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

export async function cloneRepo(opts: CloneOptions): Promise<CloneResult> {
  const dir = await mkdtemp(join(tmpdir(), "panel-build-"));
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const url = injectToken(opts.repoUrl, opts.token);
    const git = simpleGit();
    await git.clone(url, dir, [
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      opts.branch,
    ]);

    const sha = (await simpleGit(dir).revparse(["HEAD"])).trim().slice(0, 12);
    return { dir, sha, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
