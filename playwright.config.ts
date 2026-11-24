import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1, fullyParallel: false,
  timeout: 45_000, expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:3104', headless: true, trace: 'retain-on-failure' },
});
