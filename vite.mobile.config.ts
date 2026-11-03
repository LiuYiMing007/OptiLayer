import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export default defineConfig({
  base: "./",
  publicDir: "mobile-public",
  plugins: [
    react(),
    {
      name: "mobile-offline",
      apply: "build",
      async closeBundle() {
        const root = "dist/mobile";
        const files: string[] = [];
        async function visit(dir: string) {
          for (const e of await readdir(path.join(root, dir), {
            withFileTypes: true,
          })) {
            const p = path.posix.join(dir, e.name);
            if (e.isDirectory()) await visit(p);
            else if (p !== "sw.js") files.push(p);
          }
        }
        await visit("");
        const hash = createHash("sha256");
        for (const f of files.sort())
          hash.update(await readFile(path.join(root, f)));
        const key = `tfc-mobile-${hash.digest("hex").slice(0, 16)}`;
        await writeFile(
          path.join(root, "sw.js"),
          `const CACHE=${JSON.stringify(key)}; const FILES=${JSON.stringify(files.map((f) => "./" + f))};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tfc-mobile-')&&k!==CACHE).slice(0,-1).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith((async()=>{const c=await caches.open(CACHE);const hit=await c.match(e.request,{ignoreVary:true});if(hit)return hit;for(const key of (await caches.keys()).filter(k=>k.startsWith('tfc-mobile-')&&k!==CACHE)){const old=await (await caches.open(key)).match(e.request,{ignoreVary:true});if(old)return old;}return fetch(e.request);})());});`,
        );
      },
    },
  ],
  build: {
    outDir: "dist/mobile",
    emptyOutDir: true,
    target: "safari15",
    rollupOptions: { input: "mobile.html" },
  },
  server: { host: "0.0.0.0", port: 1421, strictPort: true },
});
