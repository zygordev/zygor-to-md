import type { FileReport, ScanReport } from "./types";

const databaseName = "zygor-to-md";
const storeName = "file-reports";
const workspaceKey = "zygor-to-md-workspaces";

export interface WorkspaceSnapshot { name: string; report: ScanReport; savedAt: string; }

function keyFor(file: FileReport): string | undefined {
  return file.sha256 ? `${file.path}:${file.size}:${file.sha256}` : undefined;
}

export async function loadScanCache(): Promise<Map<string, FileReport>> {
  if (typeof indexedDB === "undefined") return new Map();
  return new Promise((resolve) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => resolve(new Map());
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, "readonly");
      const getAll = transaction.objectStore(storeName).getAll();
      getAll.onsuccess = () => resolve(new Map((getAll.result as FileReport[]).flatMap((file) => { const key = keyFor(file); return key ? [[key, file] as [string, FileReport]] : []; })));
      getAll.onerror = () => resolve(new Map());
    };
  });
}

export async function saveScanCache(files: FileReport[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      for (const file of files) { const key = keyFor(file); if (key) store.put(file, key); }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    };
  });
}

export function loadWorkspaces(): WorkspaceSnapshot[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(workspaceKey) ?? "[]") as WorkspaceSnapshot[]; } catch { return []; }
}

export function saveWorkspace(name: string, report: ScanReport): void {
  if (typeof localStorage === "undefined") return;
  try {
    const workspaces = loadWorkspaces().filter((workspace) => workspace.name !== name);
    workspaces.unshift({ name, report, savedAt: new Date().toISOString() });
    localStorage.setItem(workspaceKey, JSON.stringify(workspaces.slice(0, 5)));
  } catch {
    // A full browser quota must not block scanning or downloading.
  }
}