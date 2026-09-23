import { describe, expect, it } from "vitest";
import { analyzeProject } from "./model";
import { generateContextPack, generateLlms, generateMermaid, generateProjectGuide, generateSarif } from "./project-outputs";
import type { ScanReport } from "./types";

const report: ScanReport = {
  totalBytes: 250,
  warnings: [],
  duplicateGroups: [],
  files: [
    { path: "package.json", extension: "json", mime: "application/json", signature: "unknown", size: 100, status: "included", reason: "included", text: '{\n  "scripts": { "start": "node src/server.js", "test": "vitest" },\n  "dependencies": { "hono": "^4.0.0" }\n}' },
    { path: "src/server.js", extension: "js", mime: "text/javascript", signature: "unknown", size: 100, status: "included", reason: "included", text: 'import { app } from "./app.js";\nexport function start() {}\napp.get("/health", handler);' },
    { path: ".env", extension: "env", mime: "application/octet-stream", signature: "unknown", size: 50, status: "preserved", reason: "sensitive", hex: "" },
  ],
};

describe("project model", () => {
  it("extracts facts with line-level evidence", () => {
    const model = analyzeProject(report);
    expect(model.manifests[0].value).toBe("package.json");
    expect(model.dependencies[0].value).toBe("hono@^4.0.0");
    expect(model.runCommands.some((fact) => fact.value.includes("node src/server.js"))).toBe(true);
    expect(model.runCommands.find((fact) => fact.label === "npm start")?.evidence[0].startLine).toBe(2);
    expect(model.publicApis[0].evidence[0].path).toBe("src/server.js");
    expect(model.risks.some((fact) => fact.value === ".env")).toBe(true);
  });

  it("emits portable intelligence formats from the same model", () => {
    expect(generateProjectGuide(report, "field-notes", "{{path}} {{content}}")).toContain("How to run this project");
    expect(generateMermaid(report)).toContain("src/server.js");
    expect(generateLlms(report)).toContain("# Project context");
    expect(generateContextPack(report)).toContain('"schema": "zygor-to-md/context-pack/v1"');
    expect(generateSarif(report)).toContain('"version": "2.1.0"');
  });
});