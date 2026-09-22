import { describe, expect, it } from "vitest";
import { generateMarkdown } from "./markdown";

describe("Markdown generation", () => {
  it("includes readable content and useful binary metadata", () => {
    const output = generateMarkdown({ totalBytes: 4, warnings: [], files: [
      { path: "src/main.ts", extension: "ts", mime: "text/typescript", signature: "unknown", size: 3, status: "included", reason: "Readable text included in Markdown.", text: "const x = 1;" },
      { path: "logo.png", extension: "png", mime: "image/png", signature: "PNG", size: 1, status: "preserved", reason: "Binary or large file preserved outside Markdown.", hex: "89 50" },
    ] }, "field-notes");
    expect(output).toContain("```typescript");
    expect(output).toContain("const x = 1;");
    expect(output).toContain("logo.png");
    expect(output).toContain("PNG");
  });
  it("applies custom placeholders and instruction deterministically", () => {
    const output = generateMarkdown({ totalBytes: 0, warnings: [], files: [] }, "compact", "FILE {{path}}\\n{{metadata}}\\n{{content}}", "focus APIs");
    expect(output).toContain("Project snapshot");
    expect(output).toContain("focus APIs");
  });
});
