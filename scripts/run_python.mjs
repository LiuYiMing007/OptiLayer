import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executable = path.join(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error(
    "Project Python environment is unavailable. Create .venv and install engine/requirements-dev.txt.",
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
