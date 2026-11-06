import {
  DEFAULT_SYSTEM_SETTINGS,
  normalizeSystemSettings,
  type SystemSettings,
  systemSettingsSchema,
} from "@/lib/system-settings";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Dean-editable system settings, stored in the `system_settings` table
 * (Supabase) as one JSON row. Sign-in and session checks read them on every
 * request, so they are cached briefly in memory; a save refreshes the cache
 * immediately. Under the test runner (NODE_ENV=test) they live in memory only.
 */

const SETTINGS_KEY = "system";
const CACHE_TTL_MS = 15_000;

/** Defaults, with the AI token budget taken from LLM_MONTHLY_TOKEN_BUDGET when set. */
export function defaultSystemSettings(env: NodeJS.ProcessEnv = process.env): SystemSettings {
  const budget = Number(env.LLM_MONTHLY_TOKEN_BUDGET);
  return normalizeSystemSettings(
    {
      ai: {
        monthlyTokenBudget: Number.isInteger(budget) && budget > 0
          ? budget
          : DEFAULT_SYSTEM_SETTINGS.ai.monthlyTokenBudget,
      },
    },
    DEFAULT_SYSTEM_SETTINGS,
  );
}

const globalForSettings = globalThis as unknown as {
  __ordiqSettingsCache?: { value: SystemSettings; loadedAt: number };
  __ordiqSettingsMemory?: SystemSettings;
};

const isTestRuntime = () => process.env.NODE_ENV === "test";

async function readStored(): Promise<SystemSettings> {
  if (isTestRuntime()) {
    return globalForSettings.__ordiqSettingsMemory ?? defaultSystemSettings();
  }
  const { prisma } = await import("./db");
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return normalizeSystemSettings(row?.value, defaultSystemSettings());
}

/** Current settings (cached up to 15 s). Falls back to the defaults if the table is unreachable. */
export async function getSystemSettings(): Promise<SystemSettings> {
  const cached = globalForSettings.__ordiqSettingsCache;
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.value;
  try {
    const value = await readStored();
    globalForSettings.__ordiqSettingsCache = { value, loadedAt: Date.now() };
    return value;
  } catch (err) {
    // Keep signing in possible (with the last known or default, i.e. strict, rules).
    logger.warn("system_settings_read_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return cached?.value ?? defaultSystemSettings();
  }
}

/** Last loaded settings without waiting (for synchronous callers such as cookie options). */
export function currentSystemSettings(): SystemSettings {
  return globalForSettings.__ordiqSettingsCache?.value ?? defaultSystemSettings();
}

export async function updateSystemSettings(params: {
  next: unknown;
  actor: string;
  ipAddress?: string | null;
}): Promise<SystemSettings> {
  const next = systemSettingsSchema.parse(params.next);
  const before = await getSystemSettings();

  if (isTestRuntime()) {
    globalForSettings.__ordiqSettingsMemory = next;
  } else {
    const { prisma } = await import("./db");
    await prisma.systemSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: next, updatedBy: params.actor },
      update: { value: next, updatedBy: params.actor },
    });
  }
  globalForSettings.__ordiqSettingsCache = { value: next, loadedAt: Date.now() };

  await recordAudit({
    actor: params.actor,
    action: "SYSTEM_SETTINGS_UPDATED",
    entity: "SystemSetting",
    entityId: SETTINGS_KEY,
    before,
    after: next,
    ipAddress: params.ipAddress ?? null,
  });
  return next;
}

/** Test-only: forget saved settings and the cache. */
export function resetSystemSettingsForTests(): void {
  globalForSettings.__ordiqSettingsCache = undefined;
  globalForSettings.__ordiqSettingsMemory = undefined;
}
