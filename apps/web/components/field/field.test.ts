// node --test components/field/field.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { noise3, quantile } from "./field.ts";

test("the long share drawn equals the vault's long share", () => {
  const values = new Float32Array(60 * 40);
  for (let k = 0; k < values.length; k++) values[k] = noise3((k % 60) * 0.11, Math.floor(k / 60) * 0.11, 1.7);
  for (const share of [0, 0.25, 0.5, 0.504, 0.78, 1]) {
    const thr = quantile(values, 1 - share);
    const long = values.filter((v) => v > thr).length / values.length;
    assert.ok(Math.abs(long - share) <= 1 / values.length + 1e-9 || (share === 1 && long > 0.999), `share ${share} drew ${long}`);
  }
});
