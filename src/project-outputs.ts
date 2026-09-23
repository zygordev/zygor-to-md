import { analyzeProject } from "./model";
import type { Evidence, ProjectFact, ScanReport } from "./types";
import { generateMarkdown, type Style } from "./markdown";

function evidenceLink(item: Evidence): string {
  return `[${item.path}:${item.startLine}${item.endLine === item.startLine ? "" : `-${item.endLine}`}](${item.path}#L${item.startLine})`;
}

function factLine(fact: ProjectFact): string {
  const evidence = fact.evidence.length ? ` — ${fact.evidence.map(evidenceLink).join(", ")}` : " — no direct file evidence";
  return `- **${fact.label}:** ${fact.value}${evidence}`;
}

function section(title: string, facts: ProjectFact[]): string {
  return `## ${title}\n\n${facts.length ? facts.map(factLine).join("\n") : "No evidence detected."}`;
}

function mermaidId(value: string): string { return `n${[...value].map((char) => char.charCodeAt(0).toString(16)).join("")}`; }
function escapeMermaid(value: string): string { return value.replaceAll('"', "'"); }

export function generateProjectGuide(report: ScanReport, style: Style, template: string, instruction = ""): string {
  const model = analyzeProject(report);
  const imports = model.imports.length
    ? `## Dependency map\n\n\`\`\`mermaid\nflowchart LR\n${model.imports.slice(0, 120).map((edge) => `  ${mermaidId(edge.from)}["${escapeMermaid(edge.from)}"] -->|imports| ${mermaidId(edge.to)}["${escapeMermaid(edge.to)}"]`).join("\n")}\n\`\`\``
    : "## Dependency map\n\nNo import relationships detected.";
  const overview = [
    section("How to run this project", model.runCommands),
    section("Architecture overview", [...model.manifests, ...model.entryPoints, ...model.infrastructure]),
    section("Important files", [...model.manifests, ...model.entryPoints, ...model.databases, ...model.tests]),
    section("Public APIs", model.publicApis),
    section("Configuration reference", model.configuration),
    section("Dependency map", model.dependencies),
    imports,
    section("Risk and maintenance notes", [...model.risks, ...model.recommendations]),
    section("Recommended reading order", [...model.entryPoints, ...model.manifests, ...model.publicApis.slice(0, 10)]),
  ].join("\n\n");
  return `${generateMarkdown(report, style, template, instruction)}\n\n# Project model\n\n${overview}\n`;
}

export function generateMermaid(report: ScanReport): string {
  const model = analyzeProject(report);
  const edges = model.imports.slice(0, 200).map((edge) => `  ${mermaidId(edge.from)}["${escapeMermaid(edge.from)}"] --> ${mermaidId(edge.to)}["${escapeMermaid(edge.to)}"]`);
  return `flowchart LR\n${edges.length ? edges.join("\n") : "  project[\"Project files\"]"}\n`;
}

export function generateLlms(report: ScanReport): string {
  const model = analyzeProject(report);
  return ["# Project context", "", "Generated deterministically by Zygor-to-MD.", "", "## Start here", ...model.entryPoints.map(factLine), ...model.runCommands.map(factLine), "", "## Important source", ...model.publicApis.slice(0, 40).map(factLine), "", "## Configuration", ...model.configuration.slice(0, 40).map(factLine), "", "## Files", ...report.files.map((file) => `- ${file.path} (${file.status}, ${file.size} bytes)`), ""].join("\n");
}

export function generateContextPack(report: ScanReport): string {
  const model = analyzeProject(report);
  return JSON.stringify({ schema: "zygor-to-md/context-pack/v1", model, files: report.files.filter((file) => file.text !== undefined).map((file) => ({ path: file.path, sha256: file.sha256, text: file.text })) }, null, 2);
}

export function generateSarif(report: ScanReport): string {
  const model = analyzeProject(report);
  return JSON.stringify({ version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "Zygor-to-MD", version: "1" } }, results: model.risks.map((risk) => ({ ruleId: risk.label.toLowerCase().replaceAll(" ", "-"), level: "warning", message: { text: risk.value }, locations: risk.evidence.map((item) => ({ physicalLocation: { artifactLocation: { uri: item.path }, region: { startLine: item.startLine, endLine: item.endLine } } })) })) }] }, null, 2);
}

function htmlEscape(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

export function generateHtml(report: ScanReport, style: Style, template: string, instruction = ""): string {
  const markdown = generateProjectGuide(report, style, template, instruction);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Project guide</title><style>body{max-width:1100px;margin:40px auto;padding:0 24px;font:16px system-ui;line-height:1.5;color:#17231f}pre{white-space:pre-wrap;background:#f3f6f1;padding:16px;border-radius:8px}code{background:#eef2eb;padding:2px 4px}</style><main><pre>${htmlEscape(markdown)}</pre></main></html>`;
}