import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "zygor-benchmark-"));
const sample = join(root, "sample");
await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { start: "node src/main.js" } }));
await writeFile(join(root, "README.md"), "# benchmark\n".repeat(100));
await writeFile(join(root, "main.js"), "export const benchmark = true;\n".repeat(100));
await writeFile(join(root, "binary.bin"), Buffer.alloc(128 * 1024, 7));
await (await import("node:fs/promises")).mkdir(sample, { recursive: true });
for (const name of ["package.json", "README.md", "main.js", "binary.bin"]) await (await import("node:fs/promises")).rename(join(root, name), join(sample, name));

function run() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, ["dist/action.mjs"], { cwd: process.cwd(), env: { ...process.env, INPUT_INPUT: sample, INPUT_OUTPUT: join(root, "guide.md") } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ milliseconds: Math.round(performance.now() - started), output: output.trim() }) : reject(new Error(output)));
  });
}

const runs = [];
for (let index = 0; index < 5; index++) runs.push(await run());
console.log(JSON.stringify({ tool: "zygor-to-md", runs, note: "Run competing tools with the same fixture and compare wall time, output size, and detected facts.", fixture: sample }, null, 2));
await rm(root, { recursive: true, force: true });
