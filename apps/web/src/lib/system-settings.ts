import { z } from "zod";

/**
 * Dean-editable system settings, shared by the server (enforcement) and the
 * Settings page (form). Kept free of server imports so client code can use it.
 */

export const SETTINGS_LIMITS = {
  idleTimeoutMinutes: { min: 5, max: 480 },
  absoluteSessionHours: { min: 1, max: 72 },
  maxFailedLoginAttempts: { min: 3, max: 10 },
  lockoutMinutes: { min: 1, max: 1440 },
  monthlyTokenBudget: { min: 1_000, max: 100_000_000 },
} as const;

const int = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

export const securitySettingsSchema = z.object({
  /** Ask for the authenticator code (Google Authenticator) after the password. */
  twoFactorRequired: z.boolean(),
  /** Sign the Dean out after a period without activity. */
  idleTimeoutEnabled: z.boolean(),
  idleTimeoutMinutes: int(SETTINGS_LIMITS.idleTimeoutMinutes),
  /** Longest a session lasts, active or not, before signing in again. */
  absoluteSessionHours: int(SETTINGS_LIMITS.absoluteSessionHours),
  maxFailedLoginAttempts: int(SETTINGS_LIMITS.maxFailedLoginAttempts),
  lockoutMinutes: int(SETTINGS_LIMITS.lockoutMinutes),
});

export const aiSettingsSchema = z.object({
  /** Show the AI Assistant and allow chat requests. */
  assistantEnabled: z.boolean(),
  /** Provider tokens allowed per calendar month (input + output). */
  monthlyTokenBudget: int(SETTINGS_LIMITS.monthlyTokenBudget),
});

export const systemSettingsSchema = z.object({
  security: securitySettingsSchema,
  ai: aiSettingsSchema,
});

export type SecuritySettings = z.infer<typeof securitySettingsSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

/** Values used until the Dean saves the Settings page (the original fixed rules). */
export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  security: {
    twoFactorRequired: true,
    idleTimeoutEnabled: true,
    idleTimeoutMinutes: 30,
    absoluteSessionHours: 12,
    maxFailedLoginAttempts: 5,
    lockoutMinutes: 15,
  },
  ai: {
    assistantEnabled: true,
    monthlyTokenBudget: 500_000,
  },
};

/**
 * Fill missing fields from the defaults (settings saved by an older version)
 * and validate. Invalid stored data falls back to the defaults.
 */
export function normalizeSystemSettings(
  stored: unknown,
  defaults: SystemSettings = DEFAULT_SYSTEM_SETTINGS,
): SystemSettings {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Partial<
    Record<keyof SystemSettings, Record<string, unknown>>
  >;
  const merged = {
    security: { ...defaults.security, ...(raw.security ?? {}) },
    ai: { ...defaults.ai, ...(raw.ai ?? {}) },
  };
  const parsed = systemSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaults;
}

/** Fields whose change weakens or strengthens sign-in; saving them needs the password. */
export function securitySettingsChanged(before: SystemSettings, after: SystemSettings): boolean {
  return (Object.keys(before.security) as Array<keyof SecuritySettings>).some(
    (k) => before.security[k] !== after.security[k],
  );
}
