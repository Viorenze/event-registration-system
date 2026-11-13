import { configDefaults, defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: [
      "PRD.md",
      "AGENTS.md",
      "D1_PLAN.md",
      "D2_PLAN.md",
      "D3_PLAN.md",
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
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.next/**",
      "**/*.integration.test.ts",
      "**/*.concurrency.test.ts",
      "e2e/**",
    ],
  },
});
