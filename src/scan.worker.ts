import { folderEntries, scanArchive } from "./sources";
import type { FileReport, ScanReport } from "./types";

interface WorkerRequest {
  files: File[];
  cache: [string, FileReport][];
  options?: { maxFiles?: number; maxUncompressedBytes?: number; exclude?: string[] };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const request = event.data;
    const progress = (done: number, total: number) => self.postMessage({ type: "progress", done, total });
    const cache = new Map(request.cache);
    let report: ScanReport;
    if (request.files.length === 1 && !request.files[0].webkitRelativePath) report = await scanArchive(request.files[0], progress, { ...request.options, cache });
    else report = await (await import("./zip")).scanEntries(folderEntries(request.files), progress, { ...request.options, cache });
    self.postMessage({ type: "complete", report });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not scan input." });
  }
};