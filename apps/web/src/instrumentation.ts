import { getEnv } from "./server/platform/env";
import { logger } from "./server/platform/logger";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const env = getEnv();
    logger.info("web_boot_validated", {
      llmProvider: env.LLM_PROVIDER,
      llmModel: env.LLM_MODEL,
      engineUrl: env.ENGINE_URL,
    });
  }
}

