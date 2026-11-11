import { base58 } from "@scure/base";

/** MPC response -> NEAR Intents erc191 signature "secp256k1:<base58 r||s||v>" with v ∈ {0,1}. */
export function mpcToIntentsSignature(mpcJson: string): string {
  const m = JSON.parse(mpcJson);
  const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
  const r = hex(m.big_r.affine_point).slice(1); // drop the 02/03 compression prefix
  const s = hex(m.s.scalar.padStart(64, "0"));
  return `secp256k1:${base58.encode(new Uint8Array([...r, ...s, m.recovery_id]))}`;
}
