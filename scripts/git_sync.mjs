import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} ${args.join(" ")} failed: ${result.stderr || result.status}`);
  return result.stdout?.trim() || "";
};
const git = (...args) => run("git", args, true);
const npm = (script) => run(process.execPath, [process.env.npm_execpath, "run", script]);
try {
  const mode = process.argv[2];
  if (!["sync", "release"].includes(mode)) throw new Error("Use npm run sync -- <message> or npm run publish:version");
  git("remote", "get-url", "origin");
  if (!git("branch", "--show-current")) throw new Error("Detached HEAD: choose a branch before publishing");
  git("diff", "--check");
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const tag = `v${version}`;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a numeric x.y.z version");
  const notes = path.join(root, "docs", "更新报告", `${version}更新报告.md`);
  if (mode === "release") {
    if (!fs.existsSync(notes)) throw new Error("Write the version update report first");
    const existing = spawnSync("git", ["rev-parse", "--verify", `refs/tags/${tag}`], { cwd: root, stdio: "ignore" });
    if (existing.status === 0) throw new Error(`${tag} already exists; never overwrite a released tag`);
    const tauri = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
    const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    if (tauri.version !== version || cargo !== version || lock.version !== version || lock.packages[""].version !== version) throw new Error("Product versions disagree");
  }
  for (const script of ["test", "validate:optics", "build"]) npm(script);
  run("git", ["add", "--all"]);
  const files = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "-z").split("\0").filter(Boolean);
  for (const name of files) {
    if (/(^|\/)(\.env(?:\..*)?|Workspace|Workspaces|workspaces|\.tfc|backups|acceptance)(\/|$)|\.(sqlite3?|db|pem|key|p12|pfx)$/.test(name)) throw new Error(`Private file must be removed from the staging area: ${name}`);
    const content = run("git", ["show", `:${name}`], true);
    if (/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) throw new Error(`Possible credential in ${name}`);
  }
  if (git("status", "--porcelain")) run("git", ["commit", "-m", process.argv.slice(3).join(" ") || (mode === "release" ? `release: ${tag}` : "chore: update project")]);
  if (mode === "release") {
    run("git", ["tag", "-a", tag, "-F", notes]);
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", `refs/tags/${tag}`]);
  } else run("git", ["push", "origin", "HEAD"]);
  console.log(mode === "release" ? `${tag} pushed; check GitHub Actions and Releases for build results.` : "Changes pushed to GitHub.");
} catch (error) { console.error(error.message); process.exit(1); }
