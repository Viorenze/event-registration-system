import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const repeatScript = path.resolve(__dirname, "repeat.mjs");

describe("scripts/repeat.mjs", () => {
  it("rejects invalid arguments and exits with code 1", () => {
    const resNoArgs = spawnSync("node", [repeatScript], { encoding: "utf8" });
    expect(resNoArgs.status).toBe(1);
    expect(resNoArgs.stderr).toContain("Usage: node scripts/repeat.mjs");

    const resInvalidCount = spawnSync("node", [repeatScript, "abc", "--", "echo", "ok"], {
      encoding: "utf8",
    });
    expect(resInvalidCount.status).toBe(1);
    expect(resInvalidCount.stderr).toContain("Invalid repetition count");
  });

  it("repeats successful command for specified iterations and exits with code 0", () => {
    const tmpSuccess = path.join(os.tmpdir(), `repeat_success_${Date.now()}.cjs`);
    try {
      fs.writeFileSync(tmpSuccess, "process.exit(0);\n", "utf8");
      const res = spawnSync("node", [repeatScript, "3", "--", "node", tmpSuccess], {
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("=== Iteration 1 / 3 ===");
      expect(res.stdout).toContain("=== Iteration 2 / 3 ===");
      expect(res.stdout).toContain("=== Iteration 3 / 3 ===");
      expect(res.stdout).toContain("All 3 iterations completed successfully.");
    } finally {
      try {
        fs.unlinkSync(tmpSuccess);
      } catch {}
    }
  });

  it("stops immediately on iteration failure and propagates exit code", () => {
    const tmpCounter = path.join(os.tmpdir(), `repeat_count_${Date.now()}.txt`);
    const tmpHelper = path.join(os.tmpdir(), `repeat_helper_${Date.now()}.cjs`);
    try {
      const helperContent = `
const fs = require("node:fs");
let count = 0;
try { count = parseInt(fs.readFileSync(${JSON.stringify(tmpCounter)}, "utf8"), 10) || 0; } catch {}
count++;
fs.writeFileSync(${JSON.stringify(tmpCounter)}, count.toString(), "utf8");
if (count === 2) {
  process.exit(42);
}
process.exit(0);
`;
      fs.writeFileSync(tmpHelper, helperContent, "utf8");

      const res = spawnSync("node", [repeatScript, "4", "--", "node", tmpHelper], {
        encoding: "utf8",
      });

      expect(res.status).toBe(42);
      expect(res.stdout).toContain("=== Iteration 1 / 4 ===");
      expect(res.stdout).toContain("=== Iteration 2 / 4 ===");
      expect(res.stdout).not.toContain("=== Iteration 3 / 4 ===");
      expect(res.stderr).toContain("Command failed at iteration 2 of 4");
      expect(res.stderr).toContain("Exit code: 42");
    } finally {
      try {
        fs.unlinkSync(tmpCounter);
      } catch {}
      try {
        fs.unlinkSync(tmpHelper);
      } catch {}
    }
  });

  it("stops immediately when child process is terminated by signal", () => {
    if (process.platform === "win32") {
      return;
    }
    const tmpSignal = path.join(os.tmpdir(), `repeat_signal_${Date.now()}.cjs`);
    try {
      fs.writeFileSync(tmpSignal, 'process.kill(process.pid, "SIGTERM");\n', "utf8");
      const res = spawnSync("node", [repeatScript, "3", "--", "node", tmpSignal], {
        encoding: "utf8",
      });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("Command failed at iteration 1 of 3");
    } finally {
      try {
        fs.unlinkSync(tmpSignal);
      } catch {}
    }
  });
});
