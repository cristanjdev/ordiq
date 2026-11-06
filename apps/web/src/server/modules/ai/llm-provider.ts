import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { wrapLanguageModel } from "ai";

/** A concrete provider model (what `wrapLanguageModel` accepts). */
export type ProviderLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

/**
 * Provider configuration for the AI assistant (plan D-09: provider-neutral
 * through the Vercel AI SDK). Switching providers is an `.env` change only:
 *
 *   LLM_PROVIDER = openai | anthropic | gemini | ollama | offline
 *   LLM_MODEL    = model id (defaults below)
 *   LLM_API_KEY  = key for openai / anthropic / gemini (not needed for ollama)
 *   LLM_BASE_URL = OpenAI-compatible endpoint for ollama (or a proxy)
 *
 * When no usable key is configured, or under the test runner, the assistant
 * stays on its offline deterministic path, so it never fails just because a
 * provider is missing.
 */

export type LlmProvider = "openai" | "anthropic" | "gemini" | "ollama";

export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-5-5",
  gemini: "gemini-3.5-flash",
  ollama: "qwen2.5:7b",
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  /** True when a real provider call will be made. */
  live: boolean;
  /** Why the assistant is offline, when it is. */
  offlineReason?: string;
  apiKey?: string;
  baseURL?: string;
}

function isProvider(value: string | undefined): value is LlmProvider {
  return value === "openai" || value === "anthropic" || value === "gemini" || value === "ollama";
}

function usableKey(key: string | undefined): string | undefined {
  const trimmed = key?.trim();
  if (!trimmed || /placeholder|changeme|your[-_]?key/i.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Resolve which provider and model a turn uses. A per-request provider
 * override only changes the provider label and default model; keys and URLs
 * always come from the server environment.
 */
export function resolveLlmConfig(override?: LlmProvider): LlmConfig {
  const configured = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const provider: LlmProvider = override ?? (isProvider(configured) ? configured : "openai");
  const configuredModel = process.env.LLM_MODEL?.trim();
  // A model id configured for one provider is meaningless for another.
  const model =
    configuredModel && (!override || override === configured)
      ? configuredModel
      : DEFAULT_LLM_MODELS[provider];
  const baseURL = process.env.LLM_BASE_URL?.trim() || undefined;
  const apiKey = usableKey(process.env.LLM_API_KEY);

  const offline = (offlineReason: string): LlmConfig => ({
    provider,
    model,
    live: false,
    offlineReason,
  });

  if (configured === "offline") return offline("LLM_PROVIDER is set to offline.");
  if (process.env.NODE_ENV === "test" && process.env.LLM_LIVE_TESTS !== "1") {
    return offline("Live provider calls are disabled under the test runner.");
  }
  if (provider === "ollama") {
    return { provider, model, live: true, baseURL: baseURL ?? DEFAULT_OLLAMA_BASE_URL, apiKey };
  }
  if (!apiKey) return offline(`No LLM_API_KEY is configured for ${provider}.`);
  // The sample env's LLM_BASE_URL points at Ollama; OpenAI only uses a base
  // URL that is something else (a proxy or Azure-style endpoint).
  const openAiBaseURL =
    provider === "openai" && baseURL && !baseURL.includes(":11434") ? baseURL : undefined;
  return { provider, model, live: true, apiKey, baseURL: openAiBaseURL };
}

/** Build the AI SDK language model for a live configuration. */
export function createLanguageModel(config: LlmConfig): ProviderLanguageModel {
  switch (config.provider) {
    case "openai":
      return createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      })(config.model);
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    case "gemini":
      // Google AI Studio key (free tier available at aistudio.google.com/apikey).
      return createGoogle({ apiKey: config.apiKey })(config.model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: config.baseURL ?? DEFAULT_OLLAMA_BASE_URL,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      }).chatModel(config.model);
  }
}

/** Estimated cost in PHP per 1,000 tokens; override with LLM_COST_PHP_PER_1K_IN / _OUT. */
export function estimateCostPhp(provider: LlmProvider, tokensIn: number, tokensOut: number): number {
  if (provider === "ollama") return 0;
  const rateIn = Number(process.env.LLM_COST_PHP_PER_1K_IN ?? "0.009");
  const rateOut = Number(process.env.LLM_COST_PHP_PER_1K_OUT ?? "0.035");
  return Number(((tokensIn * rateIn + tokensOut * rateOut) / 1000).toFixed(4));
}
