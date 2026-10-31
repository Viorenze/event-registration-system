#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const separatorIndex = args.indexOf("--");

if (separatorIndex === -1 || separatorIndex === 0 || separatorIndex === args.length - 1) {
  console.error("Usage: node scripts/repeat.mjs <N> -- <command> [args...]");
  process.exit(1);
}

const nStr = args[0];
const count = parseInt(nStr, 10);
if (Number.isNaN(count) || count <= 0) {
  console.error(`Invalid repetition count: "${nStr}". Must be a positive integer.`);
  process.exit(1);
}

const commandArgs = args.slice(separatorIndex + 1);
const commandString = commandArgs.join(" ");

console.log(`[repeat] Repeating command ${count} times: ${commandString}`);

for (let i = 1; i <= count; i++) {
  console.log(`\n[repeat] === Iteration ${i} / ${count} ===`);
  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    stdio: "inherit",
    shell: true,
  });

  const exitCode = result.status ?? (result.error ? 1 : 0);
  if (exitCode !== 0) {
    console.error(`\n[repeat] Command failed at iteration ${i} of ${count}`);
    console.error(`[repeat] Command: ${commandString}`);
    console.error(`[repeat] Exit code: ${exitCode}`);
    process.exit(exitCode);
  }
}

console.log(`\n[repeat] All ${count} iterations completed successfully.`);
process.exit(0);
