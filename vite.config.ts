import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createInterface, type Interface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
// Development-only bridge: the browser and native app use the same Python engine.
function engineDevBridge(): Plugin {
  return {
    name: "tfc-engine-dev",
    apply: "serve",
    configureServer(server) {
      let worker: ChildProcessWithoutNullStreams | null = null;
      let lines: Interface | null = null;
      let tail: Promise<unknown> = Promise.resolve();
      function calculate(body: string): Promise<string> {
        const result = tail
          .catch(() => {})
          .then(
            () =>
              new Promise<string>((resolve, reject) => {
                if (!worker) {
                  const env = { ...process.env };
                  delete env.TFC_WORKSPACE_ROOT;
                  delete env.TFC_CREATE_WORKSPACE;
                  worker = spawn(
                    path.join(
                      root,
                      process.platform === "win32"
                        ? ".venv/Scripts/python.exe"
                        : ".venv/bin/python",
                    ),
                    [path.join(root, "engine/main.py"), "--serve-calculation"],
                    { env },
                  );
                  lines = createInterface({ input: worker.stdout });
                  worker.stdin.on("error", () => {});
                  worker.stderr.resume();
                }
                const child = worker,
                  reader = lines!;
                const cleanup = () => {
                  clearTimeout(timer);
                  reader.removeListener("line", done);
                  child.removeListener("error", failed);
                  child.removeListener("exit", exited);
                };
                const failed = (e: Error) => {
                  cleanup();
                  child.kill();
                  worker = null;
                  lines = null;
                  reject(e);
                };
                const exited = () =>
                  failed(new Error("计算服务已退出，请重新计算"));
                const done = (line: string) => {
                  cleanup();
                  resolve(line);
                };
                const timer = setTimeout(
                  () => failed(new Error("计算超时，请检查采样范围")),
                  60000,
                );
                reader.once("line", done);
                child.once("error", failed);
                child.once("exit", exited);
                child.stdin.write(body + "\n");
              }),
          );
        tail = result;
        return result;
      }
      server.httpServer?.once("close", () => {
        worker?.kill();
        worker = null;
        lines?.close();
      });
      server.middlewares.use("/__engine", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const origin = req.headers.origin;
        if (
          origin &&
          origin !== `http://127.0.0.1:${server.config.server.port}` &&
          origin !== `http://localhost:${server.config.server.port}`
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 3_000_000) req.destroy();
        });
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          let action: string;
          try {
            action = JSON.parse(body).action;
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "请求格式无效" }));
            return;
          }
          if (action === "calculate") {
            void calculate(body)
              .then((value) => res.end(value))
              .catch((e) => {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(e) }));
              });
            return;
          }
          const child = spawn(
            path.join(
              root,
              process.platform === "win32"
                ? ".venv/Scripts/python.exe"
                : ".venv/bin/python",
            ),
            [path.join(root, "engine/main.py")],
            {
              env: {
                ...process.env,
                TFC_WORKSPACE_ROOT:
                  process.env.TFC_WORKSPACE_ROOT ||
                  path.join(root, ".dev-workspace"),
                TFC_CREATE_WORKSPACE: process.env.TFC_WORKSPACE_ROOT
                  ? "0"
                  : "1",
              },
            },
          );
          let output = "",
            error = "";
          child.stdout.on("data", (chunk) => (output += chunk.toString()));
          child.stderr.on("data", (chunk) => (error += chunk.toString()));
          child.on("error", (e) => {
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          child.on("close", (code) => {
            if (!res.writableEnded) {
              res.statusCode = code === 0 ? 200 : 500;
              res.end(
                code === 0
                  ? output
                  : JSON.stringify({ error: error || "计算引擎退出" }),
              );
            }
          });
          child.stdin.on("error", () => {});
          child.stdin.end(body);
        });
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), tailwindcss(), engineDevBridge()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/.dev-workspace/**",
        "**/Workspace/**",
        "**/Workspaces/**",
        "**/.tfc/**",
        "**/backups/**",
        "**/acceptance/**",
        "**/release/**",
        "**/.local-workspaces/**",
        "**/engine/build/**",
        "**/engine/dist/**",
        "**/src-tauri/target/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "safari15" },
});
