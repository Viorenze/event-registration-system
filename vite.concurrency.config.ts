import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["**/*.concurrency.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
