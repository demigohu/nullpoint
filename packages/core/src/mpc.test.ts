import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEvmAddress } from "./mpc.ts";

test("matches the address the MPC contract returned in the spike", () => {
  // derived_public_key view on v1.signer-prod.testnet for nullpoint.testnet / hl-master (10 Nov).
  assert.equal(deriveEvmAddress("testnet", "nullpoint.testnet", "hl-master"), "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d");
});
