import { defineConfig, devices } from "@playwright/test";
import os from "os";
import path from "path";

const PORT = 3100;
const runtimePath = path.join(os.tmpdir(), "olvm-test-users.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 40_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: require.resolve("./tests/e2e/global-setup.ts"),
  webServer: {
    command:
      "cross-env NEXT_DISABLE_TURBOPACK=1 NEXT_WEBPACK_USE_LEGACY=1 next dev -H 127.0.0.1 -p " +
      PORT,
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      USER_STORE_PATH: runtimePath,
      CLUSTER_STORE_PATH: path.join(os.tmpdir(), "olvm-test-clusters.json"),
      E2E_TEST_MODE: "1",
      AUTH_SECRET: "e2e-test-secret-0123456789",
      REQUIRE_2FA: "true",
      TWO_FACTOR_COOLDOWN_MS: "0",
      RESEND_API_KEY: "",
      RESEND_FROM: "noreply@sixmanager.io",
      OLVM_TENANTS: JSON.stringify([
        {
          id: "tenant-a",
          name: "Tenant A",
          baseUrl: "https://olvm-a.example/api",
          username: "admin@internal",
          password: "x",
          allowInsecure: true,
        },
        {
          id: "tenant-b",
          name: "Tenant B",
          baseUrl: "https://olvm-b.example/api",
          username: "admin@internal",
          password: "x",
          allowInsecure: true,
        },
      ]),
    },
  },
});
