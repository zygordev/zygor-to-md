import { describe, expect, it } from "vitest";
import { scanEntries } from "./zip";
import { tarEntries } from "./sources";

function tarFile(name: string, content: string): Uint8Array {
  const bytes = new Uint8Array(1024);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode(name), 0);
  bytes.set(encoder.encode(`${content.length.toString(8).padStart(11, "0")}\0`), 124);
  bytes[156] = 48;
  bytes.set(encoder.encode(content), 512);
  return bytes;
}

describe("archive sources and incremental cache", () => {
  it("reads TAR entries through the shared scanner", async () => {
    const report = await scanEntries(tarEntries(tarFile("src/main.ts", "export const ready = true;")));
    expect(report.files[0].path).toBe("src/main.ts");
    expect(report.files[0].status).toBe("included");
  });

  it("reuses a content-addressed report on a second scan", async () => {
    const cache = new Map();
    const entries = [{ name: "README.md", read: async () => new TextEncoder().encode("hello") }];
    const first = await scanEntries(entries, undefined, { cache });
    const second = await scanEntries(entries, undefined, { cache });
    expect(first.cache?.misses).toBe(1);
    expect(second.cache?.hits).toBe(1);
    expect(second.files[0].cache).toBe("hit");
  });
});