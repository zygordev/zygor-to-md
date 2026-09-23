import type { FileReport, ScanReport } from "./types";
import { analyzeProject } from "./model";

export type Style = "field-notes" | "catalog" | "compact";
export const defaultTemplate = `## {{path}}\n\n{{metadata}}\n\n{{content}}`;

function language(file: FileReport): string {
  const map: Record<string, string> = { js: "javascript", ts: "typescript", tsx: "tsx", jsx: "jsx", py: "python", rb: "ruby", rs: "rust", sh: "bash", ps1: "powershell", yml: "yaml", md: "markdown", html: "html", css: "css", json: "json" };
  return map[file.extension] ?? (file.extension === "(none)" ? "" : file.extension);
}
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function metadata(file: FileReport): string {
  return [`- **Path:** \`${file.path}\``, `- **Extension:** \`${file.extension}\``, `- **MIME:** \`${file.mime}\``, `- **Signature:** \`${file.signature}\``, `- **Size:** ${size(file.size)}`, `- **SHA-256:** \`${file.sha256 ?? "unavailable"}\``, `- **Status:** ${file.status} — ${file.reason}`].join("\n");
}
function renderFile(file: FileReport, template: string): string {
  const content = file.text !== undefined ? `\`\`\`${language(file)}\n${file.text.replaceAll("```", "``\\`")}\n\`\`\`` : `> Preview: ${file.preview ?? "none"}\n>\n> Hex: \`${file.hex ?? "unavailable"}\``;
  return template.replaceAll("{{path}}", file.path).replaceAll("{{metadata}}", metadata(file)).replaceAll("{{content}}", content);
}

function anchor(path: string): string {
  return path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function generateManifest(report: ScanReport): string {
  return JSON.stringify({
    schema: "zygor-to-md/v1",
    generatedAt: new Date().toISOString(),
    totals: {
      files: report.files.length,
      bytes: report.totalBytes,
      readable: report.files.filter((file) => file.status === "included").length,
      preserved: report.files.filter((file) => file.status !== "included").length,
      duplicateGroups: report.duplicateGroups.length,
    },
    files: report.files,
    duplicateGroups: report.duplicateGroups,
    warnings: report.warnings,
    projectModel: analyzeProject(report),
  }, null, 2);
}

export function generateMarkdown(report: ScanReport, style: Style, template = defaultTemplate, instruction = ""): string {
  const title = style === "catalog" ? "# Project catalog" : style === "compact" ? "# Project snapshot" : "# Project field notes";
  const hint = instruction.trim() ? `\n> Local formatting instruction: ${instruction.trim()}\n` : "";
  const intro = `${title}\n\n> Generated locally by Zygor-to-MD. Original files are never uploaded.${hint}\n\n**${report.files.length} files** · **${size(report.totalBytes)} uncompressed**`;
  const body = report.files.map((file) => renderFile(file, template)).join("\n\n---\n\n");
  const directories = [...new Set(report.files.map((file) => file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "(root)"))].sort();
  const directorySummary = `## Directory map\n\n${directories.map((directory) => `- \`${directory}\``).join("\n")}`;
  const toc = `## Contents\n\n- [Directory map](#directory-map)\n- [File inventory](#files)\n${report.files.map((file) => `- [\`${file.path}\`](#${anchor(file.path)})`).join("\n")}`;
  const extensionCounts = new Map<string, number>();
  for (const file of report.files) extensionCounts.set(file.extension, (extensionCounts.get(file.extension) ?? 0) + 1);
  const typeSummary = `## File types\n\n${[...extensionCounts.entries()].sort((a, b) => b[1] - a[1]).map(([extension, count]) => `- \`${extension}\`: ${count}`).join("\n")}`;
  const largest = [...report.files].sort((a, b) => b.size - a.size).slice(0, 10);
  const largestSummary = largest.length ? `## Largest files\n\n${largest.map((file) => `- \`${file.path}\` — ${size(file.size)}`).join("\n")}` : "";
  const duplicates = report.duplicateGroups.length
    ? `\n\n## Duplicate content\n\n${report.duplicateGroups.map((group) => `- ${group.map((path) => `\`${path}\``).join(" · ")}`).join("\n")}`
    : "";
  const warnings = report.warnings.length ? `\n\n## Warnings\n\n${report.warnings.map((w) => `- ${w}`).join("\n")}` : "";
  const bodyWithAnchors = report.files.map((file) => `<a id="${anchor(file.path)}"></a>\n${renderFile(file, template)}`).join("\n\n---\n\n");
  return `${intro}\n\n${toc}\n\n${directorySummary}\n\n${typeSummary}\n\n${largestSummary}\n\n## Files\n\n${bodyWithAnchors}${duplicates}${warnings}\n`;
}
