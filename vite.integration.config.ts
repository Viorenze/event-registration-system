import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
