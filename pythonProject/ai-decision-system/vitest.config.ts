import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Allow TypeScript files to be imported with .js extension (Node ESM style)
    extensions: [".ts", ".js"],
  },
});
