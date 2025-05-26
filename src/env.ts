import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export function getRepoQualifier(repoUri: string) {
  const isHttpUrl =
    repoUri.startsWith("http://") || repoUri.startsWith("https://");
  const isSshUrl = repoUri.startsWith("git@");

  if (!isHttpUrl && !isSshUrl) {
    return "";
  }

  let org: string, repoName: string, cloneUrl: string;

  if (isHttpUrl) {
    cloneUrl = repoUri.replace("github", `faraazahmad:${GITHUB_PAT}@github`);
    const url = new URL(cloneUrl);
    const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
    org = pathParts[0];
    repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
  } else {
    // SSH URL format: git@github.com:org/repo.git
    cloneUrl = repoUri;
    const colonIndex = repoUri.indexOf(":");
    const pathAfterColon = repoUri.substring(colonIndex + 1);
    const pathParts = pathAfterColon.split("/");
    org = pathParts[0];
    repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
  }

  return `${org}/${repoName}`;
}

export const GITHUB_PAT = process.env.GITHUB_PAT;
export const NEON_API_KEY = process.env.NEON_API_KEY as string;
export const HOME_PATH = process.env.HOME as string;
export const REPO_URI = process.env.REPO_URI as string;
export const REPO_PATH = `${HOME_PATH}/.graphsense/${getRepoQualifier(REPO_URI)}`;
export const SERVICE_PORT = 8080;
export const claude = anthropic("claude-3-5-sonnet-latest");
export const gemini = google("gemini-2.0-flash-lite-preview-02-05");
