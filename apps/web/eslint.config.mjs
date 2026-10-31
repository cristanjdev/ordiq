import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Architectural import boundary rules (Section 2 of IMPLEMENTATION_PLAN.md):
 * - Allowed direction: app -> features, app/api -> server/modules -> repo -> platform
 * - Client & UI code (src/features/**, src/components/**) NEVER imports src/server/**
 * - Non-API app routes (src/app/(shell)/**) NEVER import src/server/** directly
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    ignores: [".next/**", "node_modules/**", "dist/**"],
  },
  {
    files: [
      "src/features/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/app/(shell)/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/server/**", "*/server/*", "*/server/**"],
              message:
                "Architecture Rule violation: UI and client code must never import from src/server/. Use /api/v1 endpoints instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/features/**", "@/app/*", "@/app/**"],
              message:
                "Architecture Rule violation: server modules must never import from features/ or app/.",
            },
          ],
        },
      ],
    },
  },
);

