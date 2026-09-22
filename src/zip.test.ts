import { describe, expect, it } from "vitest";
import { safeZipPath } from "./zip";

describe("ZIP path safety", () => {
  it("rejects traversal, absolute, and drive paths", () => {
    expect(safeZipPath("../secret.txt")).toBe(false);
    expect(safeZipPath("folder/../../secret.txt")).toBe(false);
    expect(safeZipPath("/etc/passwd")).toBe(false);
    expect(safeZipPath("C:\\temp\\file.txt")).toBe(false);
  });
  it("accepts normal relative project paths", () => {
    expect(safeZipPath("src/main.ts")).toBe(true);
    expect(safeZipPath("README.md")).toBe(true);
  });
});
