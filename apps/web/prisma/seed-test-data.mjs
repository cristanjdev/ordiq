// Seeds an EMPTY database with realistic test data through the real services.
// Usage (from apps/web):
//   pnpm seed:test-data              full seed; refuses if any domain table has rows
//   pnpm seed:test-data --statuses   add every status value to already seeded data (once)
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const webDir = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(webDir, "package.json"));
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");

const result = spawnSync(
  process.execPath,
  ["--env-file=.env", vitest, "run", "src/server/repo/test-data.seed.test.ts", "--reporter=verbose"],
  {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ORDIQ_SEED_TEST_DATA: "1",
      ORDIQ_SEED_MODE: process.argv.includes("--statuses") ? "statuses" : "full",
    },
  },
);
process.exit(result.status ?? 1);
