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
const BINARY_SIGNATURES = new Set(["ZIP/PK", "PNG", "JPEG", "PDF", "GZIP", "WASM", "SQLite", "WAV", "MP3", "MP4", "WEBM", "TTF", "OTF"]);
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
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) return "WASM";
  if (bytes.length >= 16 && new TextDecoder().decode(bytes.slice(0, 16)) === "SQLite format 3\0") return "SQLite";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return "WAV";
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "MP3";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "MP4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "WEBM";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return "TTF";
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) return "OTF";
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

function metadata(bytes: Uint8Array, sig: string, ext = ""): Record<string, string | number | boolean> | undefined {
  if (sig === "PNG" && bytes.length >= 24) return { width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23], colorType: bytes[25] };
  if (sig === "JPEG") {
    let width = 0;
    let height = 0;
    for (let index = 2; index + 9 < bytes.length; index++) if (bytes[index] === 0xff && [0xc0, 0xc1, 0xc2, 0xc3].includes(bytes[index + 1])) { height = (bytes[index + 5] << 8) | bytes[index + 6]; width = (bytes[index + 7] << 8) | bytes[index + 8]; break; }
    return { format: "JPEG", width, height, hasExif: new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 256))).includes("Exif") };
  }
  if (sig === "PDF") return { pages: (new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 2 * 1024 * 1024))).match(/\/Type\s*\/Page\b/g) ?? []).length };
  if (sig === "ZIP/PK") return { archive: true, kind: ["jar", "apk", "docx", "xlsx", "pptx", "odt", "epub"].includes(ext) ? ext.toUpperCase() : "ZIP" };
  if (sig === "WASM") return { format: "WebAssembly", version: bytes.length >= 8 ? bytes[4] : 0 };
  if (sig === "SQLite") return { format: "SQLite", pageSize: bytes.length >= 18 ? (bytes[16] << 8) | bytes[17] : 0, encrypted: bytes.length >= 16 && bytes[15] !== 0 };
  if (sig === "WAV" && bytes.length >= 44) return { format: "WAV", channels: bytes[22] | (bytes[23] << 8), sampleRate: bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24) };
  if (sig === "MP4") return { format: "MP4", container: new TextDecoder().decode(bytes.slice(8, 12)) };
  if (sig === "WEBM") return { format: "WebM" };
  if (sig === "MP3") return { format: "MP3", id3: true };
  if (sig === "TTF" || sig === "OTF") return { format: sig === "TTF" ? "TrueType" : "OpenType" };
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
      path, extension: ext || "(none)", mime, signature: sig, size: bytes.byteLength, sha256, status, metadata: metadata(bytes, sig, ext), cache: "miss",
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
