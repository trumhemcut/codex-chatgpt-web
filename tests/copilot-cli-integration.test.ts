import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { copilotCliProviderEnv } from "../src/copilot-cli-integration";

test("Copilot CLI provider config uses the dedicated client-tool Responses endpoint", () => {
  const config = defaultConfig();
  config.port = 19001;
  const env = copilotCliProviderEnv(config);
  expect(env.COPILOT_PROVIDER_BASE_URL).toBe("http://127.0.0.1:19001/copilot/v1");
  expect(env.COPILOT_PROVIDER_WIRE_API).toBe("responses");
  expect(env.COPILOT_PROVIDER_TRANSPORT).toBe("http");
  expect(env.COPILOT_PROVIDER_WIRE_MODEL).toBe("chatgpt-web/gpt-5.6-sol");
});
