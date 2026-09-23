import JSZip from "jszip";
import { scanEntries, type ScanEntry, type ScanOptions } from "./zip";
import type { ScanReport } from "./types";

function text(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length)).replace(/\0.*$/, "");
}

function octal(bytes: Uint8Array, start: number, length: number): number {
  const value = text(bytes, start, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

export function tarEntries(bytes: Uint8Array): ScanEntry[] {
  const entries: ScanEntry[] = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const name = text(bytes, offset, 100);
    if (!name) break;
    const size = octal(bytes, offset + 124, 12);
    const type = bytes[offset + 156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error(`TAR entry exceeds archive bounds: ${name}`);
    if (type === 0 || type === 48) entries.push({ name, read: async () => bytes.slice(dataStart, dataEnd) });
    else if (type === 53) entries.push({ name, dir: true, read: async () => new Uint8Array() });
    else entries.push({ name, read: async () => new Uint8Array(), dir: false, unsafeReason: "Symbolic links and special TAR entries are not read." });
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("TAR.GZ requires a runtime with DecompressionStream support.");
  const stream = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function scanArchive(file: Blob, onProgress?: (done: number, total: number) => void, options: ScanOptions = {}, sourceName = (file as File).name ?? "") : Promise<ScanReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = sourceName.toLowerCase();
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return scanEntries(tarEntries(await gunzip(bytes)), onProgress, options);
  if (name.endsWith(".tar")) return scanEntries(tarEntries(bytes), onProgress, options);
  const zip = await JSZip.loadAsync(bytes);
  return scanEntries(Object.values(zip.files).map((entry) => ({ name: entry.name, dir: entry.dir, read: () => entry.async("uint8array") })), onProgress, options);
}

export function folderEntries(files: FileList | File[]): ScanEntry[] {
  return Array.from(files).map((file) => ({ name: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, read: async () => new Uint8Array(await file.arrayBuffer()) }));
}