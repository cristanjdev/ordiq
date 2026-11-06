/**
 * Edge-safe authentication constants shared by the server platform, the Next.js
 * middleware, and client code. This module must stay free of imports so it can
 * be bundled into every runtime (Edge, Node, browser).
 */
export const SESSION_COOKIE_NAME = "ordiq_session";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute timeout

export const LOGIN_PATH = "/login";
export const SESSION_ENDPOINT = "/api/v1/auth/session";
export const LOGOUT_ENDPOINT = "/api/v1/auth/logout";

/** Same-origin channel used to propagate sign-out to every open tab. */
export const AUTH_BROADCAST_CHANNEL = "ordiq-auth";

/** Reasons a user can be sent to the sign-in screen (rendered as a notice). */
export const LOGIN_NOTICE_REASONS = [
  "expired",
  "signed_out",
  "required",
] as const;
export type LoginNoticeReason = (typeof LOGIN_NOTICE_REASONS)[number];
