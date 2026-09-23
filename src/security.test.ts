import { describe, expect, it } from "vitest";
import { scanEntries } from "./zip";

describe("archive safety", () => {
  it("rejects unsafe source entries and reports normalized collisions", async () => {
    const report = await scanEntries([
      { name: "link", unsafeReason: "Symbolic link", read: async () => new Uint8Array() },
      { name: "Readme.md", read: async () => new TextEncoder().encode("a") },
      { name: "Ｒｅａｄｍｅ.md", read: async () => new TextEncoder().encode("b") },
    ]);
    expect(report.files[0].status).toBe("unsafe");
    expect(report.warnings.some((warning) => warning.includes("collision"))).toBe(true);
  });
});