import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { safeZipPath, scanZip } from "./zip";

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
  it("supports exclusions before applying scan limits", async () => {
    const zip = new JSZip();
    zip.file("src/main.ts", "export const ready = true;");
    zip.file("node_modules/pkg/index.js", "ignored");
    const report = await scanZip(new Blob([await zip.generateAsync({ type: "arraybuffer" })]), undefined, {
      maxFiles: 1,
      exclude: ["node_modules/**"],
    });
    expect(report.files.map((file) => file.path)).toEqual(["src/main.ts"]);
  });
});
