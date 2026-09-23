import JSZip from "jszip";
import type { FileReport, ScanReport } from "./types";

export const MAX_FILES = 2_000;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "yaml", "yml", "xml", "csv", "js", "ts", "tsx", "jsx", "css", "scss", "html", "htm", "py", "go", "rs", "java", "c", "cpp", "h", "hpp", "sh", "ps1", "sql", "toml", "ini", "env", "lua", "php", "rb"]);
const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip", wasm: "application/wasm",
  json: "application/json", html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
};
const BINARY_SIGNATURES = new Set(["ZIP/PK", "PNG", "JPEG", "PDF", "GZIP"]);
export interface ScanOptions {
  maxFiles?: number;
  maxUncompressedBytes?: number;
  exclude?: string[];
  cache?: Map<string, FileReport>;
}

export interface ScanEntry {
  name: string;
  dir?: boolean;
  unsafeReason?: string;
  read: () => Promise<Uint8Array>;
}

export function safeZipPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !/^[a-zA-Z]:/.test(normalized) &&
    !normalized.split("/").some((part) => part === ".." || part === "");
}

function extension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function signature(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "ZIP/PK";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "PDF";
  if (bytes.length >= 4 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "GZIP";
  return "unknown";
}

async function hash(bytes: Uint8Array): Promise<string | undefined> {
  if (!crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexPreview(bytes: Uint8Array): string {
  return [...bytes.slice(0, 48)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function metadata(bytes: Uint8Array, sig: string): Record<string, string | number | boolean> | undefined {
  if (sig === "PNG" && bytes.length >= 24) return { width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23], colorType: bytes[25] };
  if (sig === "JPEG") return { format: "JPEG", hasExif: new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 256))).includes("Exif") };
  if (sig === "PDF") return { pages: (new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 2 * 1024 * 1024))).match(/\/Type\s*\/Page\b/g) ?? []).length };
  if (sig === "ZIP/PK") return { archive: true };
  return undefined;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  const sample = bytes.slice(0, 512);
  const printable = sample.filter((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length;
  return printable / sample.length >= 0.85;
}

function matchesExclude(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
    return new RegExp(`^${escaped}$`).test(path);
  });
}

export async function scanEntries(entries: ScanEntry[], onProgress?: (done: number, total: number) => void, options: ScanOptions = {}): Promise<ScanReport> {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxBytes = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const excluded = options.exclude ?? [];
  const selected = entries.filter((entry) => !entry.dir && !matchesExclude(entry.name, excluded));
  if (selected.length > maxFiles) throw new Error(`Input contains ${selected.length.toLocaleString()} files after exclusions; the limit is ${maxFiles.toLocaleString()}.`);
  let totalBytes = 0;
  const warnings: string[] = [];
  const files: FileReport[] = [];
  const normalizedPaths = new Map<string, string>();
  let cacheHits = 0;
  let cacheMisses = 0;
  for (let index = 0; index < selected.length; index++) {
    const entry = selected[index];
    const path = entry.name;
    const normalizedPath = path.normalize("NFKC").toLowerCase();
    const collision = normalizedPaths.get(normalizedPath);
    if (collision && collision !== path) warnings.push(`Path normalization collision: ${collision} and ${path}`);
    normalizedPaths.set(normalizedPath, path);
    if (entry.unsafeReason) {
      files.push({ path, extension: extension(path), mime: "unknown", signature: "not read", size: 0, status: "unsafe", reason: entry.unsafeReason });
      warnings.push(`Rejected unsafe entry: ${path}`);
      onProgress?.(index + 1, selected.length);
      continue;
    }
    if (!safeZipPath(path)) {
      files.push({ path, extension: extension(path), mime: "unknown", signature: "not read", size: 0, status: "unsafe", reason: "Path traversal or absolute path rejected." });
      warnings.push(`Rejected unsafe path: ${path}`);
      onProgress?.(index + 1, selected.length);
      continue;
    }
    const bytes = await entry.read();
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) throw new Error(`Uncompressed ZIP content exceeds ${maxBytes / 1024 / 1024} MB.`);
    const ext = extension(path);
    const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    const sig = signature(bytes);
    const isText = TEXT_EXTENSIONS.has(ext) || (!BINARY_SIGNATURES.has(sig) && looksLikeText(bytes));
    const sha256 = await hash(bytes);
    const cacheKey = `${path}:${bytes.byteLength}:${sha256 ?? "no-hash"}`;
    const cached = options.cache?.get(cacheKey);
    if (cached) {
      files.push({ ...cached, cache: "hit" });
      cacheHits++;
      onProgress?.(index + 1, selected.length);
      continue;
    }
    cacheMisses++;
    let text: string | undefined;
    if (isText && bytes.length <= 2 * 1024 * 1024) text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const status = text !== undefined ? "included" : "preserved";
    files.push({
      path, extension: ext || "(none)", mime, signature: sig, size: bytes.byteLength, sha256, status, metadata: metadata(bytes, sig), cache: "miss",
      reason: text !== undefined ? "Readable text included in Markdown." : "Binary or large file preserved outside Markdown.",
      text, preview: text ? text.slice(0, 240).replace(/\s+/g, " ") : undefined, hex: text ? undefined : hexPreview(bytes),
    });
    if (sha256) options.cache?.set(cacheKey, files[files.length - 1]);
    onProgress?.(index + 1, selected.length);
  }
  const byHash = new Map<string, string[]>();
  for (const file of files) {
    if (file.sha256) byHash.set(file.sha256, [...(byHash.get(file.sha256) ?? []), file.path]);
  }
  const duplicateGroups = [...byHash.values()].filter((paths) => paths.length > 1);
  if (duplicateGroups.length) warnings.push(`Found ${duplicateGroups.length} duplicate content group${duplicateGroups.length === 1 ? "" : "s"}.`);
  return { files, warnings, totalBytes, duplicateGroups, cache: { hits: cacheHits, misses: cacheMisses } };
}

export async function scanZip(file: Blob, onProgress?: (done: number, total: number) => void, options: ScanOptions = {}): Promise<ScanReport> {
  const zip = await JSZip.loadAsync(file);
  return scanEntries(Object.values(zip.files).map((entry) => ({ name: entry.name, dir: entry.dir, read: () => entry.async("uint8array") })), onProgress, options);
}
