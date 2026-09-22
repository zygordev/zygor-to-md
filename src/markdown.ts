import type { FileReport, ScanReport } from "./types";

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

export function generateMarkdown(report: ScanReport, style: Style, template = defaultTemplate, instruction = ""): string {
  const title = style === "catalog" ? "# Project catalog" : style === "compact" ? "# Project snapshot" : "# Project field notes";
  const hint = instruction.trim() ? `\n> Local formatting instruction: ${instruction.trim()}\n` : "";
  const intro = `${title}\n\n> Generated locally by Zygor-to-MD. Original files are never uploaded.${hint}\n\n**${report.files.length} files** · **${size(report.totalBytes)} uncompressed**`;
  const body = report.files.map((file) => renderFile(file, template)).join("\n\n---\n\n");
  const warnings = report.warnings.length ? `\n\n## Warnings\n\n${report.warnings.map((w) => `- ${w}`).join("\n")}` : "";
  return `${intro}\n\n## Files\n\n${body}${warnings}\n`;
}
