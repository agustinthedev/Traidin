import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["server/tests/**/*.test.ts"], exclude: ["server/tests/**/*.real.test.ts"], testTimeout: 20_000, sequence: { concurrent: false } } });
