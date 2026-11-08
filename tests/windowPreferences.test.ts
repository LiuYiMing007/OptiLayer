import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWindowPreferences } from "../src/windowPreferences.ts";
import { parseDistribution } from "../src/distribution.ts";
test("opening-window choices include spectrum, deduplicate and reject legacy/unknown tools", () => {
  assert.deepEqual(
    normalizeWindowPreferences({
      openWindows: [
        "spectrum",
        "spectrum",
        "settings",
        "environment",
        "layers",
        "../../private",
      ],
      rememberGeometry: true,
    }),
    { openWindows: ["spectrum", "layers"], rememberGeometry: true },
  );
  assert.deepEqual(
    normalizeWindowPreferences({ openWindows: [] }).openWindows,
    [],
  );
  const p = normalizeWindowPreferences(null);
  p.openWindows.push("project");
  assert.deepEqual(normalizeWindowPreferences(null).openWindows, [
    "spectrum",
    "layers",
  ]);
});
test("distribution editor accepts ordered intensity data without treating it as a light spectrum", () => {
  assert.deepEqual(parseDistribution("cone", "30 50\n0 100").samples, [
    [0, 100],
    [30, 50],
  ]);
  for (const value of ["0 100\n0 50", "90 101", "91 50", "0 0\n10 0", "0 NaN"])
    assert.throws(() => parseDistribution("CONE", value));
  assert.throws(() => parseDistribution("EQUAL", "0 100"));
});
