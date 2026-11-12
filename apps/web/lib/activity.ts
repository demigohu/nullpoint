// Dashboard activity feed (COPY.md "/dashboard"): every MPC signature and AI decision as one plain
// sentence, a category for filtering, and the fields shown when a row is opened. Tx hashes aren't
// stored on-chain; the detail view looks them up by time (app/api/tx).
import { ASSETS } from "@nullpoint/core";
import type { Decision, Signed } from "./data";

export type Category = "trade" | "collateral" | "withdrawal" | "ai" | "setup";
export type Activity = {
  key: string;
  ms: number;
  category: Category;
  title: string;
  text: string;
  ok: boolean;
  /** Label / value rows for the detail view. */
  fields: [string, string][];
  /** Raw payload or note, shown collapsed in the detail view. */
  raw?: string;
  /** Contract methods whose transaction produced this entry (for the tx hash lookup). */
  methods: string[];
  /** Hyperliquid action: the detail view links the vault's Hyperliquid account. */
  hl?: boolean;
};

const strip = (id: string) => id.replace(/^nep141:/, "");
const fmt = (raw: string, decimals: number) => (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 6 : 2 });

function token(id: string, usdcToken: string) {
  if (strip(id) === strip(usdcToken)) return { symbol: "USDC", decimals: 6 };
  const a = ASSETS.find((x) => strip(x.tokenId) === strip(id));
  return a ? { symbol: a.symbol, decimals: a.decimals } : { symbol: strip(id), decimals: 0 };
}

export function describeSigned(s: Signed & { id: number }, usdcToken: string): Activity {
  const signed = !!s.signature && s.signature !== "error";
  const base = { key: `s${s.id}`, ms: s.ms, ok: signed, raw: s.payload };
  const common: [string, string][] = [
    ["Signature", signed ? "Signed by NEAR's MPC network" : s.signature === "error" ? "MPC signing failed" : "Waiting for NEAR's signers"],
    ["Digest signed", s.digest],
    ["Entry", `#${s.id} · ${s.kind}`],
  ];
  try {
    const p = JSON.parse(s.payload);
    if (s.kind === "hl_send_asset")
      return {
        ...base, category: "collateral", title: "Collateral back from Hyperliquid", hl: true, methods: ["sign_quote"],
        text: `Brought ${p.amount} USDC of collateral back from Hyperliquid into the vault's Intents account.`,
        fields: [["Amount", `${p.amount} USDC`], ["From", "The vault's Hyperliquid account"], ["To (1Click deposit address)", p.destination], ...common],
      };
    if (s.kind === "hl_approve_agent")
      return {
        ...base, category: "setup", title: "Agent key approved on Hyperliquid", hl: true, methods: ["approve_agent"],
        text: "Gave the agent its Hyperliquid key. It can place trades with it, and it can't withdraw.",
        fields: [["Agent key", p.agentAddress ?? "-"], ["Name", p.agentName ?? "-"], ...common],
      };
    const intent = p.intents?.[0];
    const intentFields: [string, string][] = [["Signed for", p.signer_id], ["Valid until", new Date(p.deadline).toLocaleString()], ["Nonce", p.nonce]];
    if (intent?.intent === "ft_withdraw") {
      const t = token(intent.token, usdcToken);
      return {
        ...base, category: "withdrawal", title: "Withdrawal paid out", methods: ["fulfill_withdraw"],
        text: `Paid ${fmt(intent.amount, t.decimals)} ${t.symbol} to ${intent.receiver_id}.`,
        fields: [["Amount", `${fmt(intent.amount, t.decimals)} ${t.symbol}`], ["To", intent.receiver_id], ...intentFields, ...common],
      };
    }
    if (intent?.intent === "transfer") {
      const [id, amount] = Object.entries(intent.tokens as Record<string, string>)[0] ?? ["", "0"];
      const t = token(id, usdcToken);
      const fields: [string, string][] = [["Amount", `${fmt(amount, t.decimals)} ${t.symbol}`], ["To (1Click deposit address)", intent.receiver_id], ...intentFields, ...common];
      return t.symbol === "USDC"
        ? {
            ...base, category: "trade", title: "USDC sent through 1Click", methods: ["sign_quote"], fields,
            text: `Sent ${fmt(amount, 6)} USDC through 1Click, to buy the coin or as collateral on Hyperliquid. The contract checked the quote first.`,
          }
        : {
            ...base, category: "trade", title: `${t.symbol} sold for USDC`, methods: ["sign_quote"], fields,
            text: `Sold ${fmt(amount, t.decimals)} ${t.symbol} for USDC through 1Click. The contract checked the quote first.`,
          };
    }
  } catch {}
  const k = s.kind.replaceAll("_", " ");
  return { ...base, category: "setup", title: k, methods: ["sign_quote", "fulfill_withdraw", "approve_agent"], fields: common, text: `The contract asked NEAR's signers to sign a ${k}.` };
}

const ACTION: Record<string, (t: string | null) => string> = {
  HOLD: () => "stay put",
  ROTATE: (t) => `switch to ${t}`,
  RESUME: (t) => `start hedging ${t}`,
  PARK: () => "wait in USDC",
  SET_LEVERAGE: (t) => `set leverage to ${t}x`,
};

export function describeDecision(d: Decision & { id: number }): Activity {
  const who = d.source === "llm" ? "The AI" : "The backup rule";
  const what = (ACTION[d.action] ?? ((t: string | null) => `${d.action}${t ? ` ${t}` : ""}`))(d.target);
  // Rejected notes are stored as "rejected: <limit> | <model reasoning>".
  const m = d.note.match(/^rejected: (.*?) \| ([\s\S]*)$/);
  const limit = m?.[1] ?? null, reasoning = m?.[2] ?? d.note;
  const unreadable = /unparseable model output/.test(d.note);
  const text = unreadable
    ? `${who}'s answer couldn't be read, so nothing changed.`
    : d.accepted
      ? `${who} chose to ${what}. ${reasoning}`
      : `${who} wanted to ${what}, and the limits blocked it: ${limit}.`;
  return {
    key: `d${d.id}`,
    ms: d.ms,
    category: "ai",
    ok: d.accepted,
    title: d.accepted ? `Decision: ${what}` : `Blocked: ${what}`,
    text,
    methods: ["report_decision"],
    raw: d.note,
    fields: [
      ["Decided by", d.source === "llm" ? "AI model on NEAR AI Cloud, in an enclave" : "Backup rule (AI unavailable)"],
      ["Action", `${d.action}${d.target ? ` ${d.target}` : ""}`],
      ["Allowed by the limits", d.accepted ? "Yes" : `No: ${limit ?? "see the note"}`],
      ...(d.chat_id ? ([["Chat id", d.chat_id], ["Signed by enclave", d.signing_address], ["Answer hash", d.hash]] as [string, string][]) : []),
      ["Entry", `decision #${d.id}`],
    ],
  };
}
