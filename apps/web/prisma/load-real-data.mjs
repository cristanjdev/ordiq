// Replaces all domain data with the college's real data (see src/server/repo/real-data.load.test.ts).
// Usage (from apps/web):
//   pnpm load:real-data                     dry run: reports what would change, writes nothing
//   pnpm load:real-data --apply             deletes the seeded data and saves the real data
//   pnpm load:real-data --file <path.xlsx>  use another converted workbook
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const webDir = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(webDir, "package.json"));
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const fileIndex = process.argv.indexOf("--file");
const workbook = fileIndex > -1 ? process.argv[fileIndex + 1] : undefined;

const result = spawnSync(
  process.execPath,
  ["--env-file=.env", vitest, "run", "src/server/repo/real-data.load.test.ts", "--reporter=verbose"],
  {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ORDIQ_LOAD_REAL_DATA: "1",
      ORDIQ_LOAD_APPLY: process.argv.includes("--apply") ? "1" : "0",
      ...(workbook ? { ORDIQ_REAL_WORKBOOK: path.resolve(workbook) } : {}),
    },
  },
);
process.exit(result.status ?? 1);
