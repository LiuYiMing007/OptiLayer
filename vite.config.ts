import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.dirname(fileURLToPath(import.meta.url));
// Development-only bridge: the browser and native app use the same Python engine.
function engineDevBridge(): Plugin {
  return {
    name: "tfc-engine-dev",
    apply: "serve",
    configureServer(server) {
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
