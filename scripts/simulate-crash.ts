// What happens to a $1,000 NullPoint position when BTC drops 20% (or rises 20%) over 24 hours.
// Same split the agent uses at 2x: 2/3 spot, 1/3 margin backing an equal short. Funding at 10% APR.
//   node simulate-crash.ts
const DEPOSIT = 1000, LEVERAGE = 2, FUNDING_APR = 10, P0 = 74_000, HOURS = 24;

function run(move: number) {
  const spotUsd = (DEPOSIT * LEVERAGE) / (LEVERAGE + 1);
  const margin = DEPOSIT - spotUsd;
  const qty = spotUsd / P0; // spot BTC held = short size
  let funding = 0;
  const rows: string[] = [];
  for (let h = 0; h <= HOURS; h++) {
    const px = P0 * (1 + (move * h) / HOURS);
    if (h > 0) funding += (qty * px * FUNDING_APR) / 100 / 8760;
    const spot = qty * px;
    const shortPnl = qty * (P0 - px);
    const nav = spot + margin + shortPnl + funding;
    const marginRatio = (margin + shortPnl + funding) / (qty * px); // equity backing the short / its notional
    if (h % 6 === 0) rows.push(`${String(h).padStart(3)}h  BTC $${px.toFixed(0).padStart(6)}   spot $${spot.toFixed(2).padStart(8)}   short PnL ${shortPnl >= 0 ? "+" : ""}${shortPnl.toFixed(2).padStart(7)}   NAV $${nav.toFixed(2)}   short margin ${(marginRatio * 100).toFixed(0)}%`);
  }
  return rows;
}

for (const move of [-0.2, 0.2]) {
  console.log(`\nBTC ${move > 0 ? "+" : ""}${move * 100}% over ${HOURS}h, $${DEPOSIT} deposit, ${LEVERAGE}x short, ${FUNDING_APR}% APR funding`);
  console.log(run(move).join("\n"));
}
// A 2x short is liquidated around +45% (margin ratio falls to Hyperliquid's maintenance level);
// the agent's min_margin rule tops up or shrinks both legs well before that.
console.log("\nNAV stays flat either way; the only drift is funding earned. Spot and short PnL cancel.");
