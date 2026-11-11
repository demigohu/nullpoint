// Submits Hyperliquid user-signed actions that the vault contract built and the MPC network signed.
export const HL_API = {
  testnet: "https://api.hyperliquid-testnet.xyz",
  mainnet: "https://api.hyperliquid.xyz",
} as const;

/** MPC response {"big_r":{"affine_point":"02…"},"s":{"scalar":"…"},"recovery_id":n} -> Hyperliquid {r,s,v}. */
export function mpcToRsv(mpcJson: string) {
  const m = JSON.parse(mpcJson);
  return {
    r: `0x${m.big_r.affine_point.slice(2)}`,
    s: `0x${m.s.scalar.padStart(64, "0")}`,
    v: (m.recovery_id + 27) as 27 | 28,
  };
}

/** Posts a vault-signed action (the exact JSON the contract signed) to /exchange. Retries network errors. */
export async function postSignedAction(network: keyof typeof HL_API, actionJson: string, mpcJson: string) {
  const action = JSON.parse(actionJson);
  const body = JSON.stringify({ action, nonce: action.nonce, signature: mpcToRsv(mpcJson) });
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${HL_API[network]}/exchange`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      return await res.json();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export async function hlInfo<T = any>(network: keyof typeof HL_API, body: object): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(`${HL_API[network]}/info`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return await res.json();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
