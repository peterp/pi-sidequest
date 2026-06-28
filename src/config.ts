import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesKey } from "@earendil-works/pi-tui";

export const SIDEQUEST_STATE_CUSTOM_TYPE = "sidequest-state";
export const LEGACY_SIDEQUEST_STATE_CUSTOM_TYPE = "sidequest-demo-state";
export const LEGACY_SIDECAR_STATE_CUSTOM_TYPE = "sidecar-demo-state";
const DEFAULT_SIDEQUEST_QUAKE_KEYS = ["§", "~"];
const EXTENSION_FILE = fs.realpathSync(fileURLToPath(import.meta.url));
export const SIDEQUEST_WEB_TOOLS_EXTENSION = path.join(path.dirname(EXTENSION_FILE), "web-tools.ts");
export const SIDEQUEST_TOOL_ALLOWLIST = "read,grep,find,ls,sidequest_web_search,sidequest_web_fetch";

export function getSidequestToolAllowlist(): string {
  return process.env.PI_SIDEQUEST_TOOLS ?? SIDEQUEST_TOOL_ALLOWLIST;
}

export const SIDEQUEST_SYSTEM_PROMPT = `You are a sidequest assistant inside pi.
The user is asking questions in sidequest threads. This sidequest is separate from the main pi session.
Answer the user's sidequest question using the provided active pi session context and prior Q/A from the selected sidequest thread.
Ground every claim in the provided context; do not invent missing details.
Be concise, practical, and explicit when the active session context is insufficient.`;

function parseQuakeKeys(value: unknown): string[] | undefined {
  const keys =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? value
        : undefined;

  const normalized = [...new Set((keys ?? []).map((key) => key.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function readSidequestConfig(): Record<string, unknown> | undefined {
  const configPath = process.env.PI_SIDEQUEST_CONFIG ?? (process.env.HOME ? path.join(process.env.HOME, ".pi", "agent", "sidequest.json") : undefined);
  if (!configPath || !fs.existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function getSidequestQuakeKeys(): string[] {
  const config = readSidequestConfig();
  return (
    parseQuakeKeys(process.env.PI_SIDEQUEST_QUAKE_KEYS) ??
    parseQuakeKeys(process.env.PI_SIDEQUEST_QUAKE_KEY) ??
    parseQuakeKeys(config?.quakeKeys) ??
    parseQuakeKeys(config?.quakeKey) ??
    DEFAULT_SIDEQUEST_QUAKE_KEYS
  );
}

export function matchesSidequestQuakeKey(data: string, keys: string[]): boolean {
  return keys.some((key) => {
    if (data === key) return true;
    try {
      return matchesKey(data, key);
    } catch {
      return false;
    }
  });
}

export function sidequestQuakeKeyHint(keys: string[]): string {
  return keys.join("/");
}
