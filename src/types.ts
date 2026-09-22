export type FileStatus = "included" | "preserved" | "unsupported" | "encrypted" | "unsafe";

export interface FileReport {
  path: string;
  extension: string;
  mime: string;
  signature: string;
  size: number;
  sha256?: string;
  status: FileStatus;
  reason: string;
  text?: string;
  preview?: string;
  hex?: string;
}

export interface ScanReport {
  files: FileReport[];
  warnings: string[];
  totalBytes: number;
}
