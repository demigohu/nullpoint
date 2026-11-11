// Checks the API keys in ../.env without printing them, and answers PRD gate G-H.
//   node --env-file=../.env check-keys.ts
// Moves no funds: quotes, a model list, one tiny chat completion, and an unsigned generate-intent.

const { NEARAI_API_KEY, NEAR_INTENTS_API_KEY } = process.env;
if (!NEARAI_API_KEY || !NEAR_INTENTS_API_KEY) throw new Error("fill NEARAI_API_KEY and NEAR_INTENTS_API_KEY in .env");

const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_HL = "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054";
const NBTC = "nep141:nbtc.bridge.near";
const VAULT = "0x5e33437e5b871f1aa9e252dd00a36c53dfcb9a8d"; // spike MPC address
const ONECLICK = "https://1click.chaindefuser.com/v0";

async function post(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const quoteBody = (dry: boolean, depositType: string, refundTo: string, destinationAsset = NBTC, recipient = VAULT, recipientType = "INTENTS") => ({
  dry, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC_NEAR, destinationAsset,
  amount: "20000000", depositType, refundTo, refundType: depositType, recipient, recipientType,
  deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
});

// 1. NEAR AI Cloud
{
  const auth = { Authorization: `Bearer ${NEARAI_API_KEY}` };
  const models = await fetch("https://cloud-api.near.ai/v1/models", { headers: auth }).then((r) => r.json());
  console.log("NEAR AI models:", models.data?.map((m: { id: string }) => m.id).join(", ") ?? JSON.stringify(models).slice(0, 300));
  const model = models.data?.[0]?.id;
  const chat = await post("https://cloud-api.near.ai/v1/chat/completions", { model, max_tokens: 5, messages: [{ role: "user", content: "Reply OK" }] }, auth);
  console.log(`NEAR AI chat [${chat.status}] model=${model} ->`, chat.json?.choices?.[0]?.message?.content ?? JSON.stringify(chat.json).slice(0, 300));
  if (chat.json?.id) {
    const sig = await fetch(`https://cloud-api.near.ai/v1/signature/${chat.json.id}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, { headers: auth }).then((r) => r.json());
    console.log("NEAR AI signature fields:", Object.keys(sig).join(", "));
  }
}

// 2. 1Click: keyed vs unkeyed fee on USDC NEAR -> USDC Hyperliquid
{
  const body = quoteBody(true, "ORIGIN_CHAIN", "wrap.near", USDC_HL, VAULT, "DESTINATION_CHAIN");
  const anon = await post(`${ONECLICK}/quote`, body, {});
  const keyed = await post(`${ONECLICK}/quote`, body, { Authorization: `Bearer ${NEAR_INTENTS_API_KEY}` });
  console.log(`1Click 20 USDC NEAR->HL: unkeyed [${anon.status}] ${anon.json?.quote?.amountOutFormatted}, keyed [${keyed.status}] ${keyed.json?.quote?.amountOutFormatted ?? JSON.stringify(keyed.json).slice(0, 200)}`);
}

// 3. Solver message bus quote (G-H, primary path)
for (const header of ["X-API-Key", "Authorization"]) {
  const value = header === "Authorization" ? `Bearer ${NEAR_INTENTS_API_KEY}` : NEAR_INTENTS_API_KEY;
  const r = await post("https://solver-relay-v2.chaindefuser.com/rpc", {
    id: 1, jsonrpc: "2.0", method: "quote",
    params: [{ defuse_asset_identifier_in: USDC_NEAR, defuse_asset_identifier_out: NBTC, exact_amount_in: "20000000", min_deadline_ms: 60000 }],
  }, { [header]: value });
  console.log(`message bus quote (${header}) [${r.status}] ->`, JSON.stringify(r.json?.result ?? r.json).slice(0, 400));
}

// 4. 1Click signed-intent path (G-H fallback): what does the unsigned payload look like?
{
  const auth = { Authorization: `Bearer ${NEAR_INTENTS_API_KEY}` };
  const q = await post(`${ONECLICK}/quote`, quoteBody(false, "INTENTS", VAULT), auth);
  const depositAddress = q.json?.quote?.depositAddress;
  console.log(`1Click INTENTS quote [${q.status}] depositAddress=${depositAddress ? "yes" : JSON.stringify(q.json).slice(0, 200)}`);
  if (depositAddress) {
    const g = await post(`${ONECLICK}/generate-intent`, { type: "swap_transfer", standard: "erc191", signerId: VAULT, depositAddress }, { ...auth, "X-API-Key": NEAR_INTENTS_API_KEY });
    console.log(`generate-intent [${g.status}] ->`, JSON.stringify(g.json?.intent ?? g.json).slice(0, 700));
  }
}
