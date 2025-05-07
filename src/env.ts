import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export const REPO_PATH = '/home/faraaz/.graphsense/svelte';
export const SERVICE_PORT = 8080;
export const claude = anthropic('claude-3-5-sonnet-latest');
export const gemini = google('gemini-2.0-flash-lite-preview-02-05');
