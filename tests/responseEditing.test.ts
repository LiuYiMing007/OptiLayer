import test from "node:test";
import assert from "node:assert/strict";
import { parseResponse } from "../src/responseEditing.ts";
test("tabular response accepts pasted spreadsheet, CSV and percent units", () => {
  assert.deepEqual(parseResponse(" Lamp ", "400\t50\n700,100", false), {
    name: "Lamp",
    samples: [
      [400, 50],
      [700, 100],
    ],
  });
});
test("reserved names, duplicate wavelengths and impossible detector efficiency reject", () => {
  for (const [name, data] of [
    ["WHITE", "400 100\n700 100"],
    ["Sensor", "400 50\n400 70"],
    ["Sensor", "400 101\n700 70"],
    ["Sensor", "400 NaN\n700 70"],
  ])
    assert.throws(() => parseResponse(name, data, true));
  assert.doesNotThrow(() => parseResponse("Lamp", "400 150\n700 200", false));
});
