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
  const result = spawnSync(commandString, {
    stdio: "inherit",
    shell: true,
  });

  const exitCode =
    result.status !== null ? result.status : result.signal ? 1 : result.error ? 1 : 0;

  if (exitCode !== 0 || result.signal) {
    const finalExitCode = exitCode !== 0 ? exitCode : 1;
    console.error(`\n[repeat] Command failed at iteration ${i} of ${count}`);
    console.error(`\n[repeat] Command: ${commandString}`);
    if (result.signal) {
      console.error(`[repeat] Terminated by signal: ${result.signal}`);
    }
    console.error(`\n[repeat] Exit code: ${finalExitCode}`);
    process.exit(finalExitCode);
  }
}

console.log(`\n[repeat] All ${count} iterations completed successfully.`);
process.exit(0);
