import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import JSZip from "jszip";
import { scanZip } from "./zip";
import { defaultTemplate, generateMarkdown, type Style } from "./markdown";

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
  const inputStat = await stat(inputPath);
  let archive: Uint8Array;
  if (inputStat.isDirectory()) {
    const zip = new JSZip();
    async function addDirectory(directory: string, prefix: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const fullPath = resolve(directory, entry.name);
        const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await addDirectory(fullPath, archivePath);
        else if (entry.isFile()) zip.file(archivePath, await readFile(fullPath));
      }
    }
    await addDirectory(inputPath, "");
    archive = await zip.generateAsync({ type: "uint8array" });
  } else {
    archive = await readFile(inputPath);
  }
  const report = await scanZip(new Blob([archive]), undefined, { exclude, maxFiles, maxUncompressedBytes: maxBytes });
  const markdown = generateMarkdown(report, style, template, instruction);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  console.log(`Generated ${outputPath} (${report.files.length} files scanned).`);
  console.log(`Included ${report.files.filter((file) => file.status === "included").length} readable files; preserved ${report.files.filter((file) => file.status !== "included").length} binary or unsupported files.`);
  if (report.warnings.length) console.warn(report.warnings.join("\n"));
  const summaryPath = input("summary");
  if (summaryPath) {
    await mkdir(dirname(resolve(summaryPath)), { recursive: true });
    await writeFile(resolve(summaryPath), JSON.stringify(report, null, 2), "utf8");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
