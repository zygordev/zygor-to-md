import { defineConfig } from "vitest/config";

const repository = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_REPOSITORY;

export default defineConfig({
  base: repository ? `/${repository.split("/")[1]}/` : "/",
  test: {
    environment: "node",
  },
});
