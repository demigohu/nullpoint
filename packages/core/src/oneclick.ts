// 1Click quote helpers. The vault contract verifies 1Click's ed25519 signature on-chain, so it needs
// the exact JSON string 1Click hashed. The SDK only exports the hash, so the message builder below
// mirrors buildSignedQuoteRequest/buildSignedQuote from @defuse-protocol/one-click-sdk-typescript 0.1.26.
import stringify from "json-stable-stringify";

export const ONECLICK_URL = "https://1click.chaindefuser.com/v0";
export const ONECLICK_MANAGER_PUBKEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

export type QuoteResponse = {
  quoteRequest: Record<string, any>;
  quote: Record<string, any>;
  timestamp: string;
  signature: string;
};

const pick = (v: unknown) => (v ? v : undefined);

/** The exact string 1Click signs: base58(sha256(signedMessage(r))) is the signed bytes. */
export function signedMessage(r: QuoteResponse): string {
  const q = r.quoteRequest;
  const request = {
    dry: q.dry, swapType: q.swapType, slippageTolerance: q.slippageTolerance, originAsset: q.originAsset,
    depositType: q.depositType, destinationAsset: q.destinationAsset, amount: q.amount, refundTo: q.refundTo,
    refundType: q.refundType, recipient: q.recipient, recipientType: q.recipientType, deadline: q.deadline,
    quoteWaitingTimeMs: pick(q.quoteWaitingTimeMs), referral: pick(q.referral),
    virtualChainRecipient: pick(q.virtualChainRecipient), virtualChainRefundRecipient: pick(q.virtualChainRefundRecipient),
    customRecipientMsg: pick(q.customRecipientMsg),
  };
  const p = r.quote;
  const amounts = {
    amountIn: p.amountIn, amountInFormatted: p.amountInFormatted, amountInUsd: p.amountInUsd, minAmountIn: p.minAmountIn,
    amountOut: p.amountOut, amountOutFormatted: p.amountOutFormatted, amountOutUsd: p.amountOutUsd, minAmountOut: p.minAmountOut,
  };
  const quote = q.dry
    ? amounts
    : {
        ...amounts, depositAddress: pick(p.depositAddress), depositMemo: pick(p.depositMemo), deadline: pick(p.deadline),
        timeWhenInactive: pick(p.timeWhenInactive), timeEstimate: pick(p.timeEstimate), refundFee: pick(p.refundFee),
        withdrawFee: pick(p.withdrawFee),
      };
  return stringify({ ...request, ...quote, timestamp: r.timestamp })!;
}

export async function getQuote(body: Record<string, unknown>, apiKey?: string, url = ONECLICK_URL): Promise<QuoteResponse> {
  const res = await fetch(`${url}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.quote) throw new Error(`1Click quote failed [${res.status}]: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
