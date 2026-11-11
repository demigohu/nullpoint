// Dashboard activity feed (COPY.md "/dashboard"): every MPC signature and strategist decision as one
// plain sentence, with the technical line kept underneath.
import { ASSETS } from "@nullpoint/core";
import type { Decision, Signed } from "./data";

export type Activity = { ms: number; text: string; tech: string; ok: boolean };

const fmt = (raw: string, decimals: number) => (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 6 : 2 });

function token(id: string, usdcId: string) {
  if (id === usdcId || id === `nep141:${usdcId}`) return { symbol: "USDC", decimals: 6 };
  const a = ASSETS.find((x) => x.tokenId === id || x.tokenId === `nep141:${id}`);
  return a ? { symbol: a.symbol, decimals: a.decimals } : { symbol: id, decimals: 0 };
}

export function describeSigned(s: Signed & { id: number }, usdcToken: string): Activity {
  const signed = !!s.signature && s.signature !== "error";
  const tech = `#${s.id} ${s.kind} · ${signed ? "signed by MPC" : "awaiting signature"}`;
  try {
    const p = JSON.parse(s.payload);
    if (s.kind === "hl_send_asset") return { ms: s.ms, ok: signed, tech, text: `Brought ${p.amount} USDC back from Hyperliquid. Signed by the vault's MPC key.` };
    if (s.kind === "hl_approve_agent") return { ms: s.ms, ok: signed, tech, text: `Approved the keeper's Hyperliquid agent ${p.agentAddress ?? ""}: it can trade, it can't withdraw.` };
    const intent = p.intents?.[0];
    if (intent?.intent === "ft_withdraw") {
      const t = token(intent.token, usdcToken);
      return { ms: s.ms, ok: signed, tech, text: `Paid a withdrawal: ${fmt(intent.amount, t.decimals)} ${t.symbol} to ${intent.receiver_id}.` };
    }
    if (intent?.intent === "transfer") {
      const [id, amount] = Object.entries(intent.tokens as Record<string, string>)[0] ?? ["", "0"];
      const t = token(id, usdcToken);
      return t.symbol === "USDC"
        ? { ms: s.ms, ok: signed, tech, text: `Sent ${fmt(amount, 6)} USDC to 1Click: buying a coin or adding margin on Hyperliquid. Quote checked by the contract.` }
        : { ms: s.ms, ok: signed, tech, text: `Sold ${fmt(amount, t.decimals)} ${t.symbol} through 1Click. Quote checked by the contract.` };
    }
  } catch {}
  return { ms: s.ms, ok: signed, tech, text: `The vault asked NEAR's MPC network to sign a ${s.kind.replaceAll("_", " ")}.` };
}

export function describeDecision(d: Decision & { id: number }): Activity {
  const who = d.source === "llm" ? "The strategist model" : "The rule fallback";
  const what = `${d.action}${d.target ? ` ${d.target}` : ""}`;
  return {
    ms: d.ms,
    ok: d.accepted,
    text: `${who} said ${what}: ${d.note.replace(/\.$/, "")}. ${d.accepted ? "The limits accepted it." : "The limits rejected it."}`,
    tech: d.chat_id ? `decision #${d.id} · chat ${d.chat_id.slice(0, 10)}… · enclave ${d.signing_address.slice(0, 10)}…` : `decision #${d.id} · rule`,
  };
}
