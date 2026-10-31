/**
 * Structured JSON logger for ORDIQ Web (apps/web).
 *
 * Engineering Standards (Section 4):
 * - Structured JSON output
 * - Never log personal names, chat message content, or tokens/secrets
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const REDACTED_KEYS = new Set([
  "password",
  "token",
  "secret",
  "auth_secret",
  "app_encryption_key",
  "engine_token",
  "x-engine-token",
  "authorization",
  "llm_api_key",
  "apikey",
  "api_key",
  "name",
  "facultyname",
  "faculty_name",
  "content",
  "message",
  "prompt",
]);

export function sanitizeLogContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const normalized = key.toLowerCase();
    if (REDACTED_KEYS.has(normalized)) {
      sanitized[key] = "[REDACTED]";
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      sanitized[key] = sanitizeLogContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: "ordiq-web";
  event: string;
  context?: Record<string, unknown>;
}

export function formatLogEntry(
  level: LogLevel,
  event: string,
  context?: Record<string, unknown>,
): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: "ordiq-web",
    event,
    ...(context ? { context: sanitizeLogContext(context) } : {}),
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(event: string, context?: Record<string, unknown>): void {
    console.debug(formatLogEntry("DEBUG", event, context));
  },
  info(event: string, context?: Record<string, unknown>): void {
    console.info(formatLogEntry("INFO", event, context));
  },
  warn(event: string, context?: Record<string, unknown>): void {
    console.warn(formatLogEntry("WARN", event, context));
  },
  error(event: string, context?: Record<string, unknown>): void {
    console.error(formatLogEntry("ERROR", event, context));
  },
};

