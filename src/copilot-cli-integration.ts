import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AppConfig } from "./config";

const SUPPORTED_VERSION = "1.0.79-9";
const DEFAULT_MODEL_ID = "gpt-5.4";

export interface CopilotCliStatus {
  enabled: boolean;
  detected: boolean;
  version?: string;
  compatible: boolean;
  bridgeUrl: string;
  modelId: string;
  wireModel: string;
  env: Record<string, string>;
}

export function copilotCliProviderEnv(config: AppConfig): Record<string, string> {
  const modelId = config.integrations.copilotCli.modelId || DEFAULT_MODEL_ID;
  const wireModel = config.integrations.copilotCli.wireModel
    || (config.solAvailable ? "chatgpt-web/gpt-5.6-sol" : "chatgpt-web/gpt-5.6-luna");
  return {
    COPILOT_PROVIDER_BASE_URL: `http://${config.host}:${config.port}/copilot/v1`,
    COPILOT_PROVIDER_TYPE: "openai",
    COPILOT_PROVIDER_WIRE_API: "responses",
    COPILOT_PROVIDER_TRANSPORT: "http",
    COPILOT_PROVIDER_MODEL_ID: modelId,
    COPILOT_PROVIDER_WIRE_MODEL: wireModel,
  };
}

export function inspectCopilotCli(config: AppConfig): CopilotCliStatus {
  const result = spawnSync(process.platform === "win32" ? "copilot.cmd" : "copilot", ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const raw = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const version = raw.match(/\d+\.\d+\.\d+(?:-\d+)?/)?.[0];
  const env = copilotCliProviderEnv(config);
  return {
    enabled: config.integrations.copilotCli.enabled,
    detected: result.status === 0 && Boolean(version),
    ...(version ? { version } : {}),
    compatible: version === SUPPORTED_VERSION,
    bridgeUrl: env.COPILOT_PROVIDER_BASE_URL!,
    modelId: env.COPILOT_PROVIDER_MODEL_ID!,
    wireModel: env.COPILOT_PROVIDER_WIRE_MODEL!,
    env,
  };
}

export function copilotCliShellSnippet(config: AppConfig): string {
  const env = copilotCliProviderEnv(config);
  if (process.platform === "win32") {
    return Object.entries(env).map(([key, value]) => `$env:${key}=${JSON.stringify(value)}`).join("\n");
  }
  return Object.entries(env).map(([key, value]) => `export ${key}=${JSON.stringify(value)}`).join("\n");
}

// Copilot CLI's documented BYOK provider settings are process environment variables. Keep lifecycle
// transactional by owning only this project's config flag and emitting a shell snippet; never rewrite
// ~/.copilot or GitHub credentials.
export function assertCopilotCliConfigIsExternal(): void {
  const userConfig = join(homedir(), ".copilot", "config.json");
  if (!existsSync(userConfig)) return;
  readFileSync(userConfig, "utf8");
}

export const COPILOT_CLI_SUPPORTED_VERSION = SUPPORTED_VERSION;
