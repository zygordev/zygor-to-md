import type { DependencyEdge, Evidence, FileReport, ProjectFact, ProjectModel, ScanReport } from "./types";

const textFiles = (report: ScanReport) => report.files.filter((file) => file.text !== undefined);

function evidence(file: FileReport, line: number, excerpt: string): Evidence {
  return { path: file.path, startLine: line, endLine: line, excerpt: excerpt.trim().slice(0, 240) };
}

function lineContaining(file: FileReport, value: string): number {
  const line = (file.text ?? "").split(/\r?\n/).findIndex((candidate) => candidate.includes(value));
  return line < 0 ? 1 : line + 1;
}

function facts(report: ScanReport, pattern: RegExp, label: (file: FileReport, line: string) => string, value: (file: FileReport, line: string) => string): ProjectFact[] {
  const result: ProjectFact[] = [];
  for (const file of textFiles(report)) {
    for (const [index, line] of (file.text ?? "").split(/\r?\n/).entries()) {
      if (pattern.test(line)) result.push({ label: label(file, line), value: value(file, line), evidence: [evidence(file, index + 1, line)] });
      pattern.lastIndex = 0;
    }
  }
  return result;
}

function manifestFacts(report: ScanReport): ProjectFact[] {
  return report.files.filter((file) => ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", "Gemfile", "requirements.txt"].some((name) => file.path.toLowerCase().endsWith(name.toLowerCase()))).map((file) => ({
    label: "Package manifest",
    value: file.path,
    evidence: [evidence(file, 1, file.path)],
  }));
}

function packageFacts(report: ScanReport): { runCommands: ProjectFact[]; dependencies: ProjectFact[] } {
  const result: ProjectFact[] = [];
  const dependencies: ProjectFact[] = [];
  for (const file of textFiles(report).filter((candidate) => candidate.path.endsWith("package.json"))) {
    try {
      const parsed = JSON.parse(file.text ?? "") as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      for (const [name, command] of Object.entries(parsed.scripts ?? {})) result.push({ label: `npm ${name}`, value: command, evidence: [evidence(file, lineContaining(file, `"${name}"`), `"${name}": "${command}"`)] });
      for (const section of [parsed.dependencies ?? {}, parsed.devDependencies ?? {}]) for (const [name, version] of Object.entries(section)) dependencies.push({ label: "Dependency", value: `${name}@${version}`, evidence: [evidence(file, lineContaining(file, `"${name}"`), name)] });
    } catch {
      // Invalid manifests remain visible as files; analyzers must never stop a scan.
    }
  }
  return { runCommands: result, dependencies };
}

function importEdges(report: ScanReport): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const pattern = /(?:import(?:\s+[^"']+?\s+from\s*|\s*)|require\s*\(\s*|from\s+)["']([^"']+)["']/g;
  for (const file of textFiles(report)) {
    for (const [index, line] of (file.text ?? "").split(/\r?\n/).entries()) {
      for (const match of line.matchAll(pattern)) edges.push({ from: file.path, to: match[1], evidence: evidence(file, index + 1, line) });
    }
  }
  return edges;
}

function pathFacts(report: ScanReport, patterns: RegExp[], label: string, value: (file: FileReport) => string = (file) => file.path): ProjectFact[] {
  return report.files.filter((file) => patterns.some((pattern) => pattern.test(file.path))).map((file) => ({ label, value: value(file), evidence: [evidence(file, 1, file.path)] }));
}

export function analyzeProject(report: ScanReport): ProjectModel {
  const packageData = packageFacts(report);
  const model: ProjectModel = {
    manifests: manifestFacts(report),
    dependencies: packageData.dependencies,
    runCommands: packageData.runCommands,
    entryPoints: facts(report, /(?:main|entry|bin|if __name__|func main\s*\(|public static void main)/i, (file) => "Likely entry point", (file, line) => `${file.path}: ${line.trim()}`),
    publicApis: facts(report, /\b(?:export\s+(?:default\s+)?(?:function|class|const|interface|type)|app\.(?:get|post|put|delete)|router\.(?:get|post|put|delete)|@(?:Get|Post|Put|Delete)Mapping)\b/i, () => "Public API", (file, line) => line.trim()),
    configuration: facts(report, /(?:process\.env\.[A-Z][A-Z0-9_]*|os\.environ\[|getenv\(|\b[A-Z][A-Z0-9_]{2,}\s*=)/, () => "Configuration reference", (file, line) => line.trim()),
    infrastructure: pathFacts(report, [/dockerfile/i, /docker-compose/i, /\.github\/workflows\//i, /\.gitlab-ci/i, /terraform\//i, /k8s|kubernetes/i, /deploy/i], "Infrastructure file"),
    databases: pathFacts(report, [/schema/i, /migration/i, /\.sql$/i, /\.sqlite(?:3)?$/i, /prisma/i, /drizzle/i], "Database artifact"),
    tests: [...facts(report, /(?:describe\s*\(|it\s*\(|test\s*\(|pytest|unittest|vitest|jest|mocha)/i, () => "Test signal", (file, line) => line.trim()), ...pathFacts(report, [/test[s]?\//i, /\.test\./i, /\.spec\./i], "Test file")],
    generated: pathFacts(report, [/\/dist\//i, /\/build\//i, /\/coverage\//i, /\.min\.(?:js|css)$/i, /\.map$/i], "Likely generated file"),
    vendored: pathFacts(report, [/node_modules\//i, /vendor\//i, /third_party\//i, /bower_components\//i], "Vendored dependency"),
    imports: importEdges(report),
    risks: [
      ...facts(report, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']+/i, () => "Potential secret", (file, line) => line.replace(/([:=]\s*["']?)[^\s"']+/g, "$1[REDACTED]")),
      ...pathFacts(report, [/\.env(?:\.|$)/i, /id_rsa/i, /\.pem$/i], "Sensitive-looking file"),
      ...pathFacts(report, [/\.zip$/i, /\.tar(?:\.gz)?$/i, /\.jar$/i, /\.apk$/i], "Nested or opaque archive"),
    ],
    recommendations: [],
  };
  model.recommendations = [
    ...(model.manifests.length ? [] : [{ label: "No package manifest detected", value: "Add or document the project's dependency and run configuration.", evidence: [] }]),
    ...(model.runCommands.length ? [] : [{ label: "No run command detected", value: "Document the canonical development and production commands.", evidence: [] }]),
    ...(model.tests.length ? [] : [{ label: "No test signal detected", value: "Add a focused test command or document the existing test workflow.", evidence: [] }]),
  ];
  return model;
}