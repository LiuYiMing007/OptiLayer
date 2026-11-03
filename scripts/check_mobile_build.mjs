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
  requestedOptions,
  missing = false;
const keys = [
  "unrelated-app",
  "tfc-mobile-%2Fother%2F-current",
  "tfc-mobile-%2F-ancient",
  "tfc-mobile-%2F-previous",
];
const cache = {
  addAll: async (urls) => {
    installed = urls;
  },
  match: async (request, options) => {
    requestedOptions = options;
    const url = typeof request === "string" ? request : request.url;
    if (typeof request === "string")
      return missing && url.endsWith("icon.png") ? undefined : "cached-asset";
    return url.endsWith("mobile.html") ? "offline-page" : undefined;
  },
};
vm.runInNewContext(worker, {
  URL,
  self: {
    location: {
      origin: "https://example.test",
      href: "https://example.test/sw.js",
    },
    registration: { scope: "https://example.test/" },
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
assert.deepEqual(deleted, ["tfc-mobile-%2F-ancient"]);
handlers.fetch({
  request: { method: "GET", url: "https://example.test/mobile.html" },
  respondWith: (p) => {
    work = p;
  },
});
assert.equal(await work, "offline-page");
assert.equal(network, 0);
assert.equal(requestedOptions.ignoreVary, true);
let reported;
const messageEvent = {
  data: { type: "TFC_OFFLINE_CHECK" },
  ports: [
    {
      postMessage: (value) => {
        reported = value;
      },
    },
  ],
  waitUntil: (p) => {
    work = p;
  },
};
handlers.message(messageEvent);
await work;
assert.equal(reported.complete, true);
assert.equal(reported.cached, installed.length);
assert.equal(reported.materials, 1211);
missing = true;
handlers.message(messageEvent);
await work;
assert.equal(reported.complete, false);
assert.ok(reported.cached < reported.expected);
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
