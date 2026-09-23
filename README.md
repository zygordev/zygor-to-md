# Zygor-to-MD

Zygor-to-MD is a privacy-first, local-only project intelligence tool. It turns a ZIP archive or checked-out directory into an evidence-linked Markdown guide, machine-readable manifest, dependency graph, coding-agent context pack, SARIF findings, and optional static HTML documentation. Files are processed locally and are never uploaded or stored by a server.

## Setup

```bash
npm install
npm run dev
```

Run the focused checks with `npm test` and create a production build with `npm run build`.

## GitHub Actions

The repository is also a reusable composite action. It accepts either a ZIP archive or a checked-out directory, and runs entirely on the GitHub-hosted runner:

For a ready-made interactive workflow, copy [`.github/workflows/zygor-example.yml`](.github/workflows/zygor-example.yml) into your repository. Then **Actions → Generate project guide → Run workflow** lets you enter the input path, output name, style, exclusions, and scan limits in GitHub's form.

```yaml
name: Project guide
on: [workflow_dispatch]

jobs:
  guide:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: zygordev/zygor-to-md@main
        with:
          input: .
          output: docs/project-overview.md
          style: field-notes
          instruction: emphasize public APIs and configuration files
      - uses: actions/upload-artifact@v4
        with:
          name: project-overview
          path: docs/project-overview.md
```

Pin the action to a release tag such as `@v1` once releases are published. `input`, `output`, `style`, `template`, `instruction`, optional `summary` JSON output, `manifest`, `llms`, `context-pack`, `sarif`, `html`, `mermaid`, `exclude`, `max-files`, `max-uncompressed-mb`, `changed-only`, `fail-on-warning`, and `fail-on-secret` are supported. The manifest is versioned JSON for downstream indexing, dashboards, or policy checks. Generated project conclusions include links such as `src/server.ts:18` so every claim can be checked against source evidence. Directory inputs are scanned directly without creating an intermediate ZIP. When GitHub provides `GITHUB_STEP_SUMMARY`, a scan summary is written there. For large repositories, exclude generated/vendor content:

```yaml
with:
  input: .
  output: docs/project-overview.md
  exclude: node_modules/**,.git/**,build/**,dist/**,*.map
  max-files: 10000
  max-uncompressed-mb: 500
  llms: docs/llms.txt
  context-pack: artifacts/context-pack.json
  sarif: artifacts/zygor.sarif
  html: artifacts/project.html
  mermaid: docs/dependency-graph.mmd
```

## Usage

Drop a ZIP or browse for one. The scanner enforces a 2,000-file and 100 MB unpacked limit, rejects absolute/traversal paths, never executes files, and reports readable files separately from preserved binary/media/archive files. The project model detects manifests, run commands, entry points, APIs, configuration, infrastructure, databases, tests, imports, generated/vendor content, and likely secrets. Choose a built-in style, edit the template with `{{path}}`, `{{metadata}}`, and `{{content}}`, or add a deterministic local formatting instruction. Download Markdown, the untouched original ZIP, or a package containing Markdown, `manifest.json`, `llms.txt`, `context-pack.json`, SARIF, Mermaid, and HTML.

## Privacy and limitations

The app has no server component, analytics, or external AI API. SHA-256 is calculated with the browser Web Crypto API where available. Readable files up to 2 MB are embedded; larger, binary, encrypted, unknown, or unsupported content is preserved and represented with metadata, previews, and hex snippets where feasible.
