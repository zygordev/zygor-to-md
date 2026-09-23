import { readFile, writeFile, mkdir, stat, readdir, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanEntries, scanZip, type ScanEntry } from "./zip";
import { defaultTemplate, generateManifest, type Style } from "./markdown";
import { analyzeProject } from "./model";
import { generateContextPack, generateHtml, generateLlms, generateMermaid, generateProjectGuide, generateSarif } from "./project-outputs";

const execFileAsync = promisify(execFile);

function input(name: string, fallback = ""): string {
  return process.env[`INPUT_${name.toUpperCase().replaceAll("-", "_")}`] || fallback;
}
function numberInput(name: string, fallback: number): number {
  const value = Number(input(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const inputPath = resolve(input("input", "."));
  const outputPath = resolve(input("output", "project-overview.md"));
  const style = input("style", "field-notes") as Style;
  const template = input("template", defaultTemplate);
  const instruction = input("instruction");
  const exclude = input("exclude").split(",").map((value) => value.trim()).filter(Boolean);
  const maxFiles = numberInput("max-files", 2000);
  const maxBytes = numberInput("max-uncompressed-mb", 100) * 1024 * 1024;
  const changedOnly = input("changed-only").toLowerCase() === "true";
  const failOnWarning = input("fail-on-warning").toLowerCase() === "true";
  const failOnSecret = input("fail-on-secret").toLowerCase() === "true";
  const writeOutput = async (path: string, content: string) => { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), content, "utf8"); };
  const inputStat = await stat(inputPath);
  let report;
  if (inputStat.isDirectory()) {
    const entries: ScanEntry[] = [];
    async function collectDirectory(directory: string, prefix: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const fullPath = resolve(directory, entry.name);
        const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await collectDirectory(fullPath, archivePath);
        else if (entry.isFile()) entries.push({ name: archivePath, read: async () => new Uint8Array(await readFile(fullPath)) });
      }
    }
    await collectDirectory(inputPath, "");
    if (changedOnly) {
      try {
        const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD^", "HEAD"], { cwd: inputPath });
        const changed = new Set(stdout.split(/\r?\n/).map((path) => path.trim().replaceAll("\\", "/")).filter(Boolean));
        for (let index = entries.length - 1; index >= 0; index--) if (!changed.has(entries[index].name)) entries.splice(index, 1);
      } catch {
        console.warn("changed-only requested, but the input has no readable Git parent diff; scanning all files.");
      }
    }
    report = await scanEntries(entries, undefined, { exclude, maxFiles, maxUncompressedBytes: maxBytes });
  } else {
    report = await scanZip(new Blob([await readFile(inputPath)]), undefined, { exclude, maxFiles, maxUncompressedBytes: maxBytes });
  }
  const markdown = generateProjectGuide(report, style, template, instruction);
  const model = analyzeProject(report);
  if (failOnSecret && model.risks.some((risk) => risk.label === "Potential secret")) throw new Error("Potential secret detected; fail-on-secret is enabled.");
  if (failOnWarning && report.warnings.length) throw new Error("Scan warnings detected; fail-on-warning is enabled.");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Generated ${outputPath} (${report.files.length} files scanned).`);
  console.log(`Included ${report.files.filter((file) => file.status === "included").length} readable files; preserved ${report.files.filter((file) => file.status !== "included").length} binary or unsupported files.`);
  if (report.warnings.length) console.warn(report.warnings.join("\n"));
  const summaryPath = input("summary");
  if (summaryPath) {
    await writeOutput(summaryPath, JSON.stringify(report, null, 2));
  }
  const manifestPath = input("manifest");
  if (manifestPath) {
    await writeOutput(manifestPath, generateManifest(report));
  }
  const llmsPath = input("llms");
  if (llmsPath) await writeOutput(llmsPath, generateLlms(report));
  const contextPath = input("context-pack");
  if (contextPath) await writeOutput(contextPath, generateContextPack(report));
  const sarifPath = input("sarif");
  if (sarifPath) await writeOutput(sarifPath, generateSarif(report));
  const htmlPath = input("html");
  if (htmlPath) await writeOutput(htmlPath, generateHtml(report, style, template, instruction));
  const mermaidPath = input("mermaid");
  if (mermaidPath) await writeOutput(mermaidPath, generateMermaid(report));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Zygor-to-MD\n\n- Files scanned: ${report.files.length}\n- Readable files: ${report.files.filter((file) => file.status === "included").length}\n- Preserved files: ${report.files.filter((file) => file.status !== "included").length}\n- Warnings: ${report.warnings.length}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
