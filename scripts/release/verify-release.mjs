#!/usr/bin/env node
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const steps = [
  ["pnpm", ["format:check"]],
  ["pnpm", ["lint"]],
  ["pnpm", ["--filter", "@statecore/core", "test"]],
  ["pnpm", ["build"]],
  ["node", ["--check", "scripts/benchmark/run-benchmark.mjs"]],
  ["node", ["--check", "scripts/benchmark/run-ablations.mjs"]],
  ["node", ["--check", "scripts/benchmark/run-replay-check.mjs"]],
  ["node", ["--check", "scripts/benchmark/generate-trend-report.mjs"]],
  ["node", ["--check", "scripts/benchmark/generate-research-report.mjs"]]
];

for (const [command, args] of steps) {
  // eslint-disable-next-line no-console
  console.log(`\n==> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// eslint-disable-next-line no-console
console.log("\nRelease verification passed.");
