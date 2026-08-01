import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["server/tests/**/*.real.test.ts"], testTimeout: 30_000, sequence: { concurrent: false } } });
