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

export async function scanZip(file: Blob, onProgress?: (done: number, total: number) => void, options: ScanOptions = {}): Promise<ScanReport> {
  const zip = await JSZip.loadAsync(file);
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxBytes = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const excluded = options.exclude ?? [];
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !matchesExclude(entry.name, excluded));
  if (entries.length > maxFiles) throw new Error(`ZIP contains ${entries.length.toLocaleString()} files after exclusions; the limit is ${maxFiles.toLocaleString()}.`);
  let totalBytes = 0;
  const warnings: string[] = [];
  const files: FileReport[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const path = entry.name;
    if (!safeZipPath(path)) {
      files.push({ path, extension: extension(path), mime: "unknown", signature: "not read", size: 0, status: "unsafe", reason: "Path traversal or absolute path rejected." });
      warnings.push(`Rejected unsafe path: ${path}`);
      onProgress?.(index + 1, entries.length);
      continue;
    }
    const bytes = await entry.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) throw new Error(`Uncompressed ZIP content exceeds ${maxBytes / 1024 / 1024} MB.`);
    const ext = extension(path);
    const mime = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
    const sig = signature(bytes);
    const isText = TEXT_EXTENSIONS.has(ext) || (!BINARY_SIGNATURES.has(sig) && looksLikeText(bytes));
    const sha256 = await hash(bytes);
    let text: string | undefined;
    if (isText && bytes.length <= 2 * 1024 * 1024) text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const status = text !== undefined ? "included" : "preserved";
    files.push({
      path, extension: ext || "(none)", mime, signature: sig, size: bytes.byteLength, sha256, status,
      reason: text !== undefined ? "Readable text included in Markdown." : "Binary or large file preserved outside Markdown.",
      text, preview: text ? text.slice(0, 240).replace(/\s+/g, " ") : undefined, hex: text ? undefined : hexPreview(bytes),
    });
    onProgress?.(index + 1, entries.length);
  }
  return { files, warnings, totalBytes };
}
