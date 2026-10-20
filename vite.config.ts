import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "PRD.md",
      "AGENTS.md",
      "D1_PLAN.md",
      "docs/**",
      ".agents/**",
      "pnpm-lock.yaml",
      "**/next-env.d.ts",
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  },
  lint: {
    ignorePatterns: ["**/.next/**", "**/dist/**", "**/node_modules/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
