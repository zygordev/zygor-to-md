import JSZip from "jszip";
import "./style.css";
import { defaultTemplate, type Style } from "./markdown";
import { generateContextPack, generateHtml, generateLlms, generateMermaid, generateProjectGuide, generateSarif } from "./project-outputs";
import { loadScanCache, loadWorkspaces, saveScanCache, saveWorkspace } from "./cache";
import type { ScanReport } from "./types";

const app = document.querySelector<HTMLDivElement>("#app")!;
let report: ScanReport | undefined;
let originalZip: File | undefined;
let originalInputName = "Project";
let markdown = "";
let filter = "";

app.innerHTML = `
  <header class="topbar"><a class="brand" href="#"><span class="mark">Z</span><span>Zygor<span class="muted">→MD</span></span></a><span class="privacy">◎ 100% in your browser</span></header>
  <main>
    <section class="hero"><p class="eyebrow">LOCAL-FIRST PROJECT INTELLIGENCE</p><h1>Make any ZIP <em>understandable.</em></h1><p class="lede">Turn a project archive into one searchable Markdown field guide—without sending a byte to a server.</p></section>
    <section class="workspace">
      <div class="panel upload-panel">
        <div id="dropzone" class="dropzone" tabindex="0" role="button" aria-label="Choose an archive"><div class="upload-icon">↥</div><h2>Drop a project archive</h2><p><label class="file-label">browse an archive<input id="fileInput" type="file" accept=".zip,.tar,.gz,.tgz,application/zip,application/gzip" hidden></label> or <label class="file-label">choose a folder<input id="folderInput" type="file" webkitdirectory directory multiple hidden></label></p><small>ZIP, TAR, TAR.GZ, or folder · up to 2,000 files / 100 MB unpacked</small></div>
        <div id="progress" class="progress hidden"><div class="progress-head"><span id="progressLabel">Scanning…</span><span id="progressValue">0%</span></div><div class="bar"><i id="progressBar"></i></div></div>
        <div id="error" class="error hidden"></div>
      </div>
      <aside class="panel controls">
        <div class="panel-title"><span>Format</span><span class="pill">DETERMINISTIC</span></div>
        <label>Recent projects<select id="workspaceHistory"><option value="">Current project</option></select></label>
        <label>Built-in style<select id="style"><option value="field-notes">Field notes</option><option value="catalog">Catalog</option><option value="compact">Compact snapshot</option></select></label>
        <label>Template editor<textarea id="template" rows="5">${defaultTemplate}</textarea></label>
        <p class="help">Placeholders: <code>{{path}}</code> <code>{{metadata}}</code> <code>{{content}}</code></p>
        <label>Local instruction <input id="instruction" placeholder="e.g. emphasize API files"></label>
        <p class="help">This is a formatting hint, not an external AI call.</p>
      </aside>
    </section>
    <section id="results" class="results hidden">
      <div class="results-head"><div><p class="eyebrow">CONVERSION READY</p><h2 id="resultTitle">Project overview</h2></div><div class="actions"><button id="downloadMd" class="primary">Download Markdown</button><button id="downloadPackage" class="secondary">Package ZIP</button><button id="downloadOriginal" class="ghost">Original ZIP</button></div></div>
      <div class="stats" id="stats"></div>
      <div class="result-grid">
        <div class="panel tree-panel"><div class="panel-title"><span>File tree</span><input id="filter" class="filter" placeholder="Filter files…" aria-label="Filter files"></div><div id="fileTree" class="file-tree"></div></div>
        <div class="panel preview-panel"><div class="panel-title"><span>Markdown preview</span><button id="copy" class="text-button">Copy</button></div><textarea id="preview" aria-label="Markdown preview"></textarea></div>
      </div>
    </section>
    <footer><span>Private by design. No server. No tracking.</span><span>ZIP contents are read, never executed.</span></footer>
  </main>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
function on(selector: string, event: string, handler: EventListener) {
  document.querySelector(selector)?.addEventListener(event, handler);
}
const dropzone = $("#dropzone") as HTMLElement;
const input = $("#fileInput") as HTMLInputElement;
const folderInput = $("#folderInput") as HTMLInputElement;
dropzone.addEventListener("click", () => input.click());
dropzone.addEventListener("keydown", (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") input.click(); });
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragging"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event: DragEvent) => { event.preventDefault(); dropzone.classList.remove("dragging"); const file = event.dataTransfer?.files[0]; if (file) process([file]); });
input.addEventListener("change", () => { if (input.files?.[0]) process([input.files[0]]); });
folderInput.addEventListener("change", () => { if (folderInput.files?.length) process(Array.from(folderInput.files)); });

async function process(files: File[]) {
  const file = files[0];
  const archive = file.name.toLowerCase().endsWith(".zip") || file.name.toLowerCase().endsWith(".tar") || file.name.toLowerCase().endsWith(".tar.gz") || file.name.toLowerCase().endsWith(".tgz");
  if (files.length === 1 && !archive) return showError("Please choose a ZIP, TAR, TAR.GZ archive, or a folder.");
  originalZip = files.length === 1 ? file : undefined;
  originalInputName = files.length === 1 ? file.name.replace(/\.(?:zip|tar|tar\.gz|tgz)$/i, "") : ((file as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ?? "Project");
  $("#error").classList.add("hidden"); $("#progress").classList.remove("hidden");
  try {
    const cache = await loadScanCache();
    const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
    report = await new Promise<ScanReport>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; report?: ScanReport; message?: string; done?: number; total?: number }>) => {
        if (event.data.type === "progress") { const percent = event.data.total ? Math.round((event.data.done ?? 0) / event.data.total * 100) : 100; ($("#progressBar") as HTMLElement).style.width = `${percent}%`; $("#progressValue").textContent = `${percent}%`; $("#progressLabel").textContent = `Scanning ${event.data.done} of ${event.data.total} files`; }
        if (event.data.type === "complete" && event.data.report) { worker.terminate(); resolve(event.data.report); }
        if (event.data.type === "error") { worker.terminate(); reject(new Error(event.data.message)); }
      };
      worker.postMessage({ files, cache: [...cache.entries()] });
    });
    await saveScanCache(report.files);
    render();
  } catch (error) { showError(error instanceof Error ? error.message : "Could not read this ZIP."); }
}
function showError(message: string) { const el = $("#error"); el.textContent = message; el.classList.remove("hidden"); $("#progress").classList.add("hidden"); }
function render() {
  if (!report) return;
  $("#progress").classList.add("hidden"); $("#results").classList.remove("hidden");
  $("#resultTitle").textContent = originalInputName;
  saveWorkspace(originalInputName, report);
  const workspaceHistory = $("#workspaceHistory") as HTMLSelectElement;
  workspaceHistory.innerHTML = `<option value="">Current project</option>${loadWorkspaces().map((workspace) => `<option value="${workspace.name.replaceAll('"', "&quot;")}">${workspace.name}</option>`).join("")}`;
  $("#stats").innerHTML = `<div><strong>${report.files.length}</strong><span>files scanned</span></div><div><strong>${report.files.filter((f) => f.status === "included").length}</strong><span>in Markdown</span></div><div><strong>${report.files.filter((f) => f.status !== "included").length}</strong><span>preserved</span></div><div><strong>${(report.totalBytes / 1024 / 1024).toFixed(1)} MB</strong><span>unpacked</span></div>`;
  markdown = generateProjectGuide(report, ($("#style") as HTMLSelectElement).value as Style, ($("#template") as HTMLTextAreaElement).value, ($("#instruction") as HTMLInputElement).value);
  ($("#preview") as HTMLTextAreaElement).value = markdown; renderTree();
}
function renderTree() { if (!report) return; const needle = filter.toLowerCase(); $("#fileTree").innerHTML = report.files.filter((f) => f.path.toLowerCase().includes(needle)).map((f) => `<div class="file-row"><span class="file-status ${f.status}"></span><span class="file-name">${f.path}</span><span class="file-size">${f.size.toLocaleString()} B</span></div>`).join(""); }
["style", "template", "instruction"].forEach((id) => on(`#${id}`, "input", render));
on("#filter", "input", (event) => { filter = (event.target as HTMLInputElement).value; renderTree(); });
on("#preview", "input", (event) => { markdown = (event.target as HTMLTextAreaElement).value; });
on("#workspaceHistory", "change", (event) => { const name = (event.target as HTMLSelectElement).value; const workspace = loadWorkspaces().find((item) => item.name === name); if (workspace) { report = workspace.report; originalZip = undefined; originalInputName = workspace.name; render(); } });
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}
on("#downloadMd", "click", () => download(new Blob([markdown], { type: "text/markdown" }), "project-overview.md"));
on("#downloadOriginal", "click", () => { if (originalZip) download(originalZip, originalZip.name); });
on("#copy", "click", async () => { await navigator.clipboard.writeText(markdown); ($("#copy") as HTMLButtonElement).textContent = "Copied"; setTimeout(() => ($("#copy") as HTMLButtonElement).textContent = "Copy", 1200); });
on("#downloadPackage", "click", async () => { if (!originalZip || !report) return; const zip = new JSZip(); const style = ($("#style") as HTMLSelectElement).value as Style; const template = ($("#template") as HTMLTextAreaElement).value; const instruction = ($("#instruction") as HTMLInputElement).value; zip.file(originalZip.name, originalZip); zip.file("project-overview.md", markdown); zip.file("llms.txt", generateLlms(report)); zip.file("context-pack.json", generateContextPack(report)); zip.file("project.sarif", generateSarif(report)); zip.file("dependency-graph.mmd", generateMermaid(report)); zip.file("project.html", generateHtml(report, style, template, instruction)); zip.file("manifest.json", JSON.stringify({ generatedAt: new Date().toISOString(), source: originalZip.name, files: report.files }, null, 2)); download(await zip.generateAsync({ type: "blob" }), "zygor-to-md-package.zip"); });
