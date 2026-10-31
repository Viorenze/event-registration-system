#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const counterFile = path.join(os.tmpdir(), "ci_repeat_counter.txt");
let count = 0;
if (fs.existsSync(counterFile)) {
  try {
    count = parseInt(fs.readFileSync(counterFile, "utf8"), 10) || 0;
  } catch {}
}
count += 1;
fs.writeFileSync(counterFile, count.toString(), "utf8");

console.log(`[ci-fail-second] Counter is ${count}`);

if (count === 2) {
  console.error(`[ci-fail-second] Intentional failure on iteration 2`);
  process.exit(1);
}

const result = spawnSync("pnpm", ["test:concurrency"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? (result.error ? 1 : 0));
