import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
const root = "dist/mobile";
const html = await fs.readFile(path.join(root, "mobile.html"), "utf8");
assert.match(html, /apple-touch-icon/);
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "manifest.webmanifest"), "utf8"),
);
assert.equal(manifest.start_url, "./mobile.html");
const worker = await fs.readFile(path.join(root, "sw.js"), "utf8");
const handlers = {};
let installed = [],
  deleted = [],
  network = 0,
  requestedOptions;
const keys = ["unrelated-app", "tfc-mobile-ancient", "tfc-mobile-previous"];
const cache = {
  addAll: async (urls) => {
    installed = urls;
  },
  match: async (request, options) => {
    requestedOptions = options;
    return request.url.endsWith("mobile.html") ? "offline-page" : undefined;
  },
};
vm.runInNewContext(worker, {
  URL,
  self: {
    location: { origin: "https://example.test" },
    clients: { claim: async () => {} },
    addEventListener: (event, handler) => {
      handlers[event] = handler;
    },
  },
  caches: {
    open: async () => cache,
    keys: async () => keys,
    delete: async (key) => {
      deleted.push(key);
    },
  },
  fetch: async () => {
    network++;
    throw new Error("network disabled");
  },
});
let work;
handlers.install({
  waitUntil: (p) => {
    work = p;
  },
});
await work;
assert.ok(installed.includes("./mobile.html"));
assert.ok(installed.includes("./apple-touch-icon.png"));
for (const file of installed) await fs.access(path.join(root, file));
handlers.activate({
  waitUntil: (p) => {
    work = p;
  },
});
await work;
assert.deepEqual(deleted, ["tfc-mobile-ancient"]);
handlers.fetch({
  request: { method: "GET", url: "https://example.test/mobile.html" },
  respondWith: (p) => {
    work = p;
  },
});
assert.equal(await work, "offline-page");
assert.equal(network, 0);
assert.equal(requestedOptions.ignoreVary, true);
const assets = await fs.readdir(path.join(root, "assets"));
const js = (
  await Promise.all(
    assets
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFile(path.join(root, "assets", f), "utf8")),
  )
).join("");
const catalogue = JSON.parse(
  await fs.readFile("engine/data/tfcalc-catalogue.json", "utf8"),
);
for (const record of catalogue.materials)
  assert.ok(js.includes(record.name), `Missing material: ${record.name}`);
assert.ok(
  !js.includes("/__engine"),
  "Mobile must not depend on desktop engine bridge",
);
console.log(
  JSON.stringify({
    materials: catalogue.materials.length,
    precache_assets: installed.length,
    offline_fetch: true,
    cache_update: true,
    home_screen_icon: true,
    python_dependency: false,
  }),
);
