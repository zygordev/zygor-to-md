# Zygor-to-MD

Zygor-to-MD is a privacy-first, local-only web app that turns one ZIP archive into one customized Markdown project guide. ZIP contents are processed in the browser and are never uploaded or stored by a server.

## Setup

```bash
npm install
npm run dev
```

Run the focused checks with `npm test` and create a production build with `npm run build`.

## GitHub Actions

The repository is also a reusable composite action. It accepts either a ZIP archive or a checked-out directory, and runs entirely on the GitHub-hosted runner:

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

Pin the action to a release tag such as `@v1` once releases are published. `input`, `output`, `style`, `template`, `instruction`, and optional `summary` JSON output are supported.

## Usage

Drop a ZIP or browse for one. The scanner enforces a 2,000-file and 100 MB unpacked limit, rejects absolute/traversal paths, never executes files, and reports readable files separately from preserved binary/media/archive files. Choose a built-in style, edit the template with `{{path}}`, `{{metadata}}`, and `{{content}}`, or add a deterministic local formatting instruction. Download the Markdown, the untouched original ZIP, or a package containing both plus `manifest.json`.

## Privacy and limitations

The app has no server component, analytics, or external AI API. SHA-256 is calculated with the browser Web Crypto API where available. Readable files up to 2 MB are embedded; larger, binary, encrypted, unknown, or unsupported content is preserved and represented with metadata, previews, and hex snippets where feasible.
