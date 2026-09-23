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
  metadata?: Record<string, string | number | boolean>;
  cache?: "hit" | "miss";
}

export interface Evidence {
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
}

export interface ProjectFact {
  label: string;
  value: string;
  evidence: Evidence[];
  confidence?: "low" | "medium" | "high";
}

export interface DependencyEdge {
  from: string;
  to: string;
  evidence: Evidence;
}

export interface ProjectModel {
  manifests: ProjectFact[];
  dependencies: ProjectFact[];
  runCommands: ProjectFact[];
  entryPoints: ProjectFact[];
  publicApis: ProjectFact[];
  configuration: ProjectFact[];
  infrastructure: ProjectFact[];
  databases: ProjectFact[];
  tests: ProjectFact[];
  generated: ProjectFact[];
  vendored: ProjectFact[];
  imports: DependencyEdge[];
  risks: ProjectFact[];
  recommendations: ProjectFact[];
}

export interface ScanReport {
  files: FileReport[];
  warnings: string[];
  totalBytes: number;
  duplicateGroups: string[][];
  cache?: { hits: number; misses: number };
}
