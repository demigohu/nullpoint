# NullPoint — PRD

Status: v0.3 · 2026-11-10 · deadline submission 2026-11-14 23:59 UTC

## 0. Keputusan yang sudah dikunci

| Topik | Keputusan |
|---|---|
| Produk | Satu vault USDC delta-neutral. User hanya deposit USDC dan **tidak memilih aset**. Protokol yang menentukan |
| Desain | **Intents-native.** Kaki spot dipegang **akun NEAR Intents milik vault** dan dibeli lewat NEAR Intents. Hyperliquid hanya untuk short perp. Swap spot, rotasi, dan transfer margin semuanya lewat Intents |
| Satu kunci | Alamat EVM turunan MPC milik kontrak vault adalah **master Hyperliquid sekaligus akun `intents.near`** (tanda tangan `erc191`) |
| Swap & margin | **Verifikasi quote lalu tandatangani**: keeper membawa quote 1Click yang ditandatangani 1Click (ed25519). Kontrak memverifikasi tanda tangan itu on-chain, memeriksa `recipient`/`refundTo` = alamat vault, aset, jumlah, dan harga terhadap oracle, lalu meminta MPC menandatangani intent `transfer` ke `depositAddress` yang sudah terbukti milik 1Click. Keeper tidak bisa membelokkan dana (§6.2) |
| Model strategist | `deepseek-ai/DeepSeek-V4.1-Flash-1017` (private, TEE attestation ✓). Fallback `Qwen/Qwen3.8-27B`. Model Anthropic/OpenAI/Google di NEAR AI Cloud "anonymised" (tanpa attestation), jadi tidak dipakai |
| Aset | Allowlist: **BTC** (`nbtc.bridge.near`), **ETH** (`eth.bridge.near`), **NEAR** (`wrap.near`). Default awal: **BTC**. SOL dan HYPE tidak masuk karena tidak tersedia sebagai token di NEAR lewat 1Click |
| Rotasi | Rotasi otomatis masuk scope (§6.4) |
| Kecerdasan | **LLM strategist** (NEAR AI Cloud, TEE) yang memutuskan HOLD/ROTATE/PARK/leverage, dan keputusannya **dieksekusi** bila lolos guardrail pasti. Aturan pasti = pagar + fallback (§6.5) |
| NAV | **Dihitung kontrak sendiri**: saldo yang dicatat kontrak × **harga dari quote 1Click bertanda tangan** (oracle, §6.1). Keeper hanya melaporkan detail posisi short dan funding, dibatasi invariant (§6.1) |
| Frontend | 4 halaman: `/` landing, `/app` vault, `/dashboard`, `/proof` (§6.6) |
| Urutan kerja | **Semua jalan di testnet dulu**, baru migrasi ke mainnet. Mainnet memakai ulang kode yang sama |
| Submission | Disubmit dengan **deployment mainnet live** ($60 dana owner) + testnet untuk reproduksi juri |
| Track | `defi` (utama), `security`, `agents` |
| Fallback | Adapter spot di Hyperliquid (desain v0.2) disimpan bila jalur Intents bermasalah saat migrasi mainnet |

## 1. Ringkasan

NullPoint adalah vault delta-neutral di NEAR. User deposit USDC. Kontrak vault membeli aset spot (BTC, ETH, atau NEAR) lewat NEAR Intents dan memegangnya sendiri. Di saat yang sama, kontrak mengirim margin lewat Intents ke Hyperliquid dan membuka short perp dengan ukuran sama. Nilai vault tidak ikut naik-turun harga, dan yield datang dari funding rate yang dibayar trader long ke trader short. Keeper otomatis merotasi hedge ke aset dengan funding terbaik.

Pembeda keamanan: akun Hyperliquid vault dikontrol **kontrak NEAR lewat Chain Signatures**. Keeper hanya memegang Hyperliquid *agent wallet* yang bisa trading tapi tidak bisa menarik dana. Ini sudah dibuktikan di testnet (§8).

## 2. Masalah

- Yield stabil di NEAR tipis: stablecoin di NEAR sekitar $85.8M, dan APY tinggi di pool datang dari emisi, bukan yield organik.
- Strategi delta-neutral butuh akun di venue perps. Di vault biasa, siapa pun yang memegang key bot bisa menguras dana. Kasus dompet agen yang dikuras lewat prompt injection (Grok/Bankr, Mei 2026) menunjukkan key di tangan bot adalah titik gagal utama.
- Funding rate berpindah-pindah antar aset. Vault yang terpaku pada satu aset melewatkan yield.
- Volume Intents besar, tapi belum ada produk yield yang memakai Intents sebagai mesin eksekusinya.

## 3. Tujuan dan non-tujuan

### Tujuan (harus ada saat submit)

| ID | Tujuan | Bukti untuk juri |
|---|---|---|
| G1 | Kontrak vault: deposit, mint share, request/fulfill withdraw, NAV, pause, cap TVL | Test `near-workspaces` lulus. Tx hash testnet + mainnet |
| G2 | Master Hyperliquid = alamat EVM turunan Chain Signatures milik **kontrak vault** | Alamat turunan + tx `approveAgent` yang ditandatangani MPC dari kontrak |
| G3 | Kaki spot dipegang akun Intents milik vault, dibeli lewat quote 1Click yang diverifikasi kontrak lalu ditandatangani MPC (§6.2) | `mt_balance_of` di `intents.near` + intent hash swap + test kontrak: quote palsu ditolak |
| G4 | Kaki short di Hyperliquid, leverage ≤2x, ukuran = kaki spot | Posisi terlihat di explorer Hyperliquid ("proof-of-hedge") |
| G5 | Rotasi otomatis antar BTC/ETH/NEAR (§6.3) | Unit test keputusan rotasi + minimal satu rotasi tercatat di testnet |
| G6 | Agent wallet **tidak bisa** withdraw/transfer | `npm run attack` → ditolak Hyperliquid |
| G7 | Aturan risiko: funding negatif → parkir USDC. Margin tipis → top-up margin atau kecilkan posisi | Unit test di `packages/core` |
| G8 | Simulasi harga turun 20%: NAV tetap datar | `npm run simulate:crash` |
| G9 | Frontend 4 halaman (§6.6) | URL hosted (membaca mainnet) + `npm run dev` |
| G10 | `npm run demo` dry-run tanpa dana dan tanpa API key berbayar | Dijalankan di clone bersih |
| G11 | **Mainnet live proof:** deposit → swap spot lewat Intents → margin ke Hyperliquid lewat Intents → short → funding → withdraw parsial | Daftar tx hash mainnet di README |
| G12 | LLM strategist memutuskan, guardrail memvalidasi, keputusan tercatat on-chain dengan hash + attestation | `get_decisions` + halaman `/proof` |
| G13 | Demo prompt injection ke strategist ditolak guardrail | `npm run attack:llm` |
| G14 | NAV dihitung on-chain dari harga quote 1Click terverifikasi + saldo yang dicatat kontrak | Test kontrak: laporan keeper yang melanggar invariant ditolak |

### Stretch

- S1: Deposit dari chain apa pun ke vault lewat 1Click (user bawa SOL/ETH/USDC dari chain lain).
- S2: Deposit lewat Confidential Intents (privasi depositor).
- S3: Strategist membaca sumber teks tambahan (berita, sentimen) selain data pasar.

### Roadmap (bukan untuk hackathon)

- **Staked NEAR delta-neutral**: kaki spot NEAR di-stake, sehingga yield = staking + funding.
- Multi-vault (vault per aset) dari kode yang sama, hanya beda parameter.
- Aset tambahan begitu tersedia sebagai token di NEAR lewat Intents.

### Non-tujuan

- User memilih aset atau strategi sendiri.
- Token atau governance.
- Verifikasi NAV trustless on-chain (lihat R3).
- Klaim bahwa posisi tersembunyi. Short vault **sengaja publik** di Hyperliquid sebagai proof-of-hedge.

## 4. Pengguna dan alur

**Depositor**
1. Deposit USDC → dapat share. Testnet: mock USDC. Mainnet: USDC di NEAR (S1: aset apa pun dari chain mana pun).
2. Melihat NAV, yield, aset aktif, dan link ke posisi vault di Hyperliquid.
3. Request withdraw → keeper unwind porsinya → share dibakar dan USDC dibayar.

**Owner**
- Deploy vault, set parameter dan allowlist, `approve_agent` / `revoke_agent`, `pause`.

**Keeper (`apps/keeper`)**
- Tiap siklus: baca pasar → hedge → rotasi bila perlu → aturan risiko → laporkan NAV → proses antrean withdraw.

**Juri**
- `npm run demo` (dry-run), `npm test`, membuka link explorer testnet dan mainnet, halaman `/proof`.

## 5. Arsitektur

```
 Depositor ──USDC──▶ ┌─────────────────────────────────────────────┐
                     │ contracts/vault (NEAR)                       │
                     │ - share accounting, NAV, cap, pause          │
                     │ - verifikasi quote 1Click (ed25519) = harga │
                     │ - menyusun payload EIP-712 admin Hyperliquid │
                     └───────┬─────────────────────────────────────┘
                             │ sign(digest, path) ke MPC
                             ▼
                  MPC (v1.signer-prod.testnet / v1.signer)
                  → satu alamat EVM milik vault: 0x…
                     │                                  │
          erc191 intent                         EIP-712 user-signed
                     ▼                                  ▼
  ┌──────────────────────────────┐    ┌──────────────────────────────────┐
  │ intents.near — akun 0x…      │    │ Hyperliquid — master 0x…          │
  │ - MEMEGANG spot: nBTC/ETH/   │◀──▶│ - SHORT perp saja (order: agent)  │
  │   wNEAR + USDC idle          │    │ - approveAgent, usdClassTransfer, │
  │ - swap lewat 1Click          │    │   sendAsset: hanya lewat MPC      │
  └──────────────────────────────┘    └──────────────────────────────────┘
       margin USDC ⇄ lewat 1Click (`hypercore`), ~30 dtk
                                         ▲
      apps/keeper ───────────────────────┘  order, quote 1Click, submit intent, report_prices + report_position
```

### Prinsip keamanan inti

Hyperliquid punya dua skema tanda tangan:
- **L1 action** (chainId 1337, phantom agent): order, cancel, `updateLeverage`, dan juga `vaultTransfer`/`subAccountTransfer`. Agent wallet boleh menandatangani ini.
- **User-signed action** (`HyperliquidSignTransaction`): `approveAgent`, `withdraw3`, `usdSend`, `spotSend`, `usdClassTransfer`. Hanya master yang bisa. Kalau agent menandatanganinya, Hyperliquid mengatribusikannya ke akun agent sendiri.

Kontrak **menyusun sendiri** payload dari parameter terstruktur, lalu meminta MPC menandatangani digest-nya. Keeper tidak pernah bisa menyodorkan digest bebas.

### Alur dana (mainnet)

| Langkah | Dari → ke | Mekanisme | Siapa yang memicu |
|---|---|---|---|
| Masuk ke Intents | USDC deposit user (kontrak) → akun Intents vault | `ft_transfer_call` ke `intents.near` dengan `receiver_id` = alamat vault. Tujuan dikunci kontrak | Kontrak, saat deposit |
| Beli spot | USDC → BTC/ETH/wNEAR, di dalam akun Intents vault | Quote 1Click `depositType: INTENTS`, `recipient` = vault. Kontrak verifikasi quote → MPC menandatangani intent `transfer` ke `depositAddress` | Keeper memanggil `sign_quote`, lalu `POST /v0/submit-intent` |
| Rotasi spot | Aset A → aset B, di dalam akun Intents vault | Sama dengan beli spot | Sama |
| Kirim margin | USDC akun Intents vault → USDC master (Hyperliquid) | Sama dengan beli spot, tapi `destinationAsset` = USDC `hypercore` dan `recipient` = alamat master (alamat yang sama dengan vault). **Masuk langsung ke saldo perp** | Keeper memanggil `sign_quote` |
| Buka short | — | Order L1 oleh agent | Keeper |
| Tarik margin | USDC master (Hyperliquid) → akun Intents vault | Quote 1Click `originAsset` = USDC `hypercore`, `recipient` = vault. Kontrak verifikasi quote → menyusun `sendAsset` (bisa dari perp) ke `depositAddress` yang terbukti → MPC. **Jangan `usdSend`** (potongan ekstra 1 USDC → `INCOMPLETE_DEPOSIT`). Fee tetap 0.2 USDC, minimal 0.5 USDC | Keeper memanggil `hl_send_to_intents` |
| Keluar ke user | Akun Intents vault → user | Intent `ft_withdraw` disusun kontrak, `receiver_id` = akun NEAR user yang withdraw | Kontrak, saat `fulfill_withdraw` |

Jalur langsung NEAR ⇄ Hyperliquid (`hypercore` di 1Click) berarti tidak ada langkah Arbitrum dan tidak perlu ETH untuk gas.

Quote dry-run 1Click untuk $25 (10 Nov, **tanpa API key**, jadi kena +0.25%). Dengan partner key: fee 0.20%, atau **0.01%** untuk stablecoin dan aset sama lintas chain (USDC NEAR ⇄ USDC Hyperliquid). Header: `Authorization: Bearer <key>`.

| Rute | Hasil | Waktu |
|---|---|---|
| USDC (NEAR) → nBTC (NEAR) | $24.92 (~0.3%) | ~20 dtk |
| USDC (NEAR) → USDC (Hyperliquid) | $24.68 (~1.3%) | ~30 dtk |
| USDC (Hyperliquid) → USDC (NEAR) | $24.80 (~0.8%) | ~35 dtk |

### Testnet vs mainnet

Intents dan 1Click tidak punya testnet (HACKATHON.md Q-007). Spot Hyperliquid testnet rusak (Gate G-C).

| Bagian | Testnet | Mainnet |
|---|---|---|
| Token deposit | Mock USDC (NEP-141) | USDC (NEP-141) |
| Token spot | Mock nBTC/ETH/wNEAR (NEP-141) | `nbtc.bridge.near`, `eth.bridge.near`, `wrap.near` |
| Verifier + swap | `contracts/mock-verifier`: meniru antarmuka `intents.near` (`ft_transfer_call` deposit, `mt_balance_of`, `is_nonce_used`, `execute_intents` dengan payload `erc191` yang **diverifikasi sungguhan**: recover secp256k1, cek nonce/deadline, eksekusi `transfer`/`ft_withdraw`). `apps/keeper/src/mock1click.ts`: quote dengan format persis 1Click, ditandatangani **key ed25519 mock** (kontrak testnet dikonfigurasi dengan public key mock), lalu solver mock mengisi swap pada mark price Hyperliquid dikurangi fee 0.3% | `intents.near` + 1Click (`submit-intent`), key manajer 1Click asli |
| Margin NEAR ⇄ Hyperliquid | Solver mock punya wallet sungguhan di Hyperliquid testnet: mengirim USDC ke master (`usdSend` perp→perp) saat margin keluar, menerima `sendAsset` dari master saat margin ditarik. Jalur kontrak dan MPC identik dengan mainnet | 1Click (`hypercore`) |
| Kaki perp | Nyata di Hyperliquid testnet | Nyata |
| MPC | `v1.signer-prod.testnet` | `v1.signer` |

Satu basis kode. Perbedaannya hanya jaringan, alamat verifier (`mock-verifier` | `intents.near`), sumber quote (mock | 1Click), public key manajer 1Click di kontrak, dan token USDC Hyperliquid (`USDC:0xeb62…` testnet | `USDC:0x6d1e…` mainnet). Kontrak vault yang sama persis, termasuk logika "verifikasi quote lalu tandatangani", jalan di kedua jaringan.

### Komponen dan folder

| Folder | Isi |
|---|---|
| `contracts/vault` | Rust (near-sdk). Owner: `set_keeper`, `set_params`, `set_paused`, `set_margin_net`, `approve_agent`. Keeper: `report_prices`, `report_position`, `report_decision`, `sign_quote`, `fulfill_withdraw`. Siapa saja: `ft_on_transfer` (deposit), `sweep`, `request_withdraw`, `execute_withdraw`. Inisialisasi: `new`, `reinit` (`#[private]`, state baru di akun yang sama). View: `get_state`, `get_shares`, `get_signed`, `get_withdrawals`, `get_decisions`, `get_nav_history`. 19 unit test (quote 1Click mainnet asli, signature MPC asli). |
| `contracts/mock-ft` | NEP-141 testnet (mUSDC) dengan `mint` terbuka. |
| `contracts/mock-verifier` | Pengganti `intents.near` di testnet (verifikasi tanda tangan `erc191` sungguhan, `is_nonce_used`, `reinit`). |
| `packages/core` | TS bersama: derivasi alamat MPC, pembentuk pesan quote 1Click (identik dengan `quoteHash` SDK), helper Hyperliquid/Intents/RPC (fallback multi-endpoint), aset, strategi + guardrail (`strategy.ts`), strategist LLM (`@nullpoint/core/strategist`, node-only). Unit test. |
| `apps/keeper` | Loop keeper: `chain.ts` (tanda tangan `near-kit`), `journal.ts` (lock + jurnal), `mock1click.ts` (testnet). |
| `apps/web` | Frontend Next.js (§6.6). |
| `scripts/` | `demo.ts` (dry-run tanpa key), `attack.ts`, `attack-llm.ts`, `simulate-crash.ts`, `simulate-strategy.ts`, `e2e-testnet.ts`, `deploy-testnet.sh`, `reset-testnet.ts`, `add-keeper-keys.ts`, `approve-agent.ts`, `fixtures-oneclick.ts`, spike gate (`spike-*.ts`). |
| root | `ecosystem.config.cjs` (pm2), `.env.example`. |

## 6. Spesifikasi fungsional

### 6.1 Vault contract

- Share: `shares = deposit * total_shares / nav` (share pertama 1:1). Pembulatan selalu menguntungkan vault.
- **NAV dihitung kontrak sendiri:**

  | Komponen | Sumber |
  |---|---|
  | USDC idle | Saldo akun Intents vault (`mt_batch_balance_of`, cross-contract) + USDC di kontrak yang belum masuk Intents |
  | Kaki spot | Saldo token di akun Intents vault (`mt_batch_balance_of`, dibaca on-chain) × harga terverifikasi (lihat di bawah) |
  | Akun Hyperliquid | Nilai akun **dilaporkan keeper**, lalu dicek terhadap laporan terakhir yang diterima: `nilai lalu + margin yang dipindah sejak itu + efek perubahan harga oracle pada short lama`. Toleransi `max_report_drift_bps` (default 1%) dari nilai akun + dust. Laporan pertama memakai `margin_net + PnL short terbuka` |
  | Hedge | Ditolak bila `|nilai short − nilai spot| / nilai spot > hedge_band` per aset |

  Koreksi 11 Nov: versi awal membandingkan nilai akun dengan `margin_net + PnL terbuka` sepanjang waktu. Funding yang diterima dan PnL dari posisi yang sudah ditutup menumpuk di luar rumus itu, sehingga vault pause sendiri begitu posisi mengecil (terjadi saat uji PARK). Cek per laporan menyelesaikannya, dan pergeseran besar mendadak tetap memicu pause.

- **Oracle harga = quote 1Click bertanda tangan.** Keeper memanggil `report_prices([{message, signature}])` dengan quote `dry` aset → USDC (mis. 0.001 BTC → USDC). Kontrak memverifikasi ed25519, memastikan `destinationAsset` = USDC dan `originAsset` ∈ allowlist, menolak `timestamp` lebih tua dari `max_price_age_s` (default 120), lalu menyimpan harga = `amountOut / amountIn`. Harga sudah dipotong fee, jadi penilaian konservatif. Testnet: `mock-1click` menandatangani quote dari mark price Hyperliquid.
- `report_position(positions, account_value)` hanya oleh keeper. Kontrak membaca saldo spot sendiri dari verifier. Pelanggaran invariant → `paused` (owner harus investigasi).
- Deposit dan withdraw diberi harga dari NAV hasil hitung kontrak, bukan angka dari keeper.
- Riwayat NAV: ring buffer ~500 entri `(ts, nav, share_price, active_asset)` untuk grafik dashboard.
- Withdraw: `request_withdraw(shares)` → keeper `fulfill_withdraw` (harga dari NAV, MPC menandatangani `ft_withdraw` ke user) → `execute_withdraw`. Keeper menjalankan semuanya otomatis (1–3 menit). `execute_withdraw` tidak punya cek pemanggil, jadi user bisa menyelesaikannya sendiri kalau keeper mati.
- `report_decision` hanya oleh keeper: aksi, target, diterima/ditolak, catatan, chat id NEAR AI + alamat penanda tangan TEE.
- `reinit(generation, …)` (`#[private]`): state baru di akun yang sama dengan prefix storage generasi baru. Dipakai untuk reset testnet, karena NEAR tidak mengizinkan menghapus akun dengan state besar.
- `paused`: deposit/withdraw/swap ditolak. Owner bisa `revoke_agent`.
- Cap TVL `max_tvl` (mainnet: $100).

### 6.2 Swap dan margin: verifikasi quote lalu tandatangani

Setiap quote 1Click ditandatangani manajer 1Click dengan **ed25519** (key `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`, dari SDK resmi `@defuse-protocol/one-click-sdk-typescript`). Yang ditandatangani: `base58(sha256(stable_json({...quoteRequest, ...quote, timestamp})))`, dan isinya mencakup `recipient`, `refundTo`, `depositAddress`, `amountIn`, `minAmountOut`, `deadline`. Jadi kontrak bisa **membuktikan** bahwa `depositAddress` memang milik 1Click dan terikat ke quote yang hasilnya dikirim ke vault.

Alur (sama untuk swap spot, rotasi, dan kirim margin ke Hyperliquid):

1. Keeper meminta quote 1Click non-dry dengan `depositType: INTENTS`, `refundTo` = alamat vault (`refundType: INTENTS`), `recipient` = alamat vault. Untuk spot: `recipientType: INTENTS`. Untuk margin: `destinationAsset` = USDC `hypercore`, `recipientType: DESTINATION_CHAIN` (alamat master = alamat vault).
2. Keeper memanggil `sign_quote(signed_message, signature)`. `signed_message` = string JSON stabil persis seperti yang di-hash 1Click.
3. Kontrak memvalidasi:
   - `sha256` → base58 → `env::ed25519_verify` terhadap public key manajer 1Click yang disimpan kontrak (bisa diganti owner lewat `set_oneclick_pubkey` bila 1Click merotasi key).
   - Parse JSON: `recipient` dan `refundTo` = alamat vault. `depositType`/`refundType` = `INTENTS`. `originAsset`, `destinationAsset` ∈ allowlist ∪ {USDC, USDC `hypercore`} dan berbeda.
   - `amountIn ≤ max_swap_amount`. `minAmountOut` wajar terhadap harga oracle tersimpan: `nilai_out ≥ nilai_in × (1 − max_slippage_bps)`. Untuk USDC ⇄ USDC: `minAmountOut ≥ amountIn − fee maks`.
   - `timestamp` segar (< 2 menit) dan `deadline` di masa depan. Hash quote belum pernah dipakai (anti-replay).
4. Kontrak **menyusun sendiri** intent `erc191`: `signer_id` = alamat vault, satu `transfer` sebesar `amountIn` `originAsset` ke `depositAddress` dari quote yang sudah terverifikasi, deadline ≤ deadline quote, nonce versioned (salt dari verifier, 15 byte dari `env::random_seed`). Lalu memanggil MPC `sign` dan di callback menyimpan `(payload, signature)`.
5. Keeper mengirimnya ke 1Click `POST /v0/submit-intent`, lalu memantau `GET /v0/status` sampai `SUCCESS` / `REFUNDED` / `FAILED`. Refund kembali ke akun Intents vault.

Tarik margin dari Hyperliquid memakai cara yang sama: quote dengan `originAsset` = USDC `hypercore` dan `recipient` = vault diverifikasi, lalu kontrak menyusun `sendAsset` ke `depositAddress` dan meminta MPC menandatangani EIP-712-nya.

Yang tidak bisa dilakukan keeper jahat: mengirim dana ke alamat selain `depositAddress` milik 1Click, mengubah penerima hasil swap, atau memakai ulang quote lama. Yang masih bisa: memilih quote terburuk yang masih lolos batas harga oracle (kerugian ≤ `max_slippage_bps` per swap), atau tidak mengirim intent sama sekali (tidak ada kerugian). Sisa kepercayaan ada pada 1Click sebagai venue: 1Click harus mengeksekusi quote yang ia tandatangani.

Format yang sudah diverifikasi:
- Intent `erc191` dari MPC diterima `intents.near` (Gate G-G): nonce `5628f6c6 ‖ 00 ‖ salt(4) ‖ deadline ns i64 LE(8) ‖ random(15)`, signature `secp256k1:` + base58(r‖s‖v) dengan v ∈ {0,1}.
- Tanda tangan quote 1Click asli lolos verifikasi, dan quote dengan `depositAddress` yang dipalsukan gagal (Gate G-I).
- `generate-intent` 1Click untuk akun vault menghasilkan satu intent `transfer` ke `depositAddress` (Gate G-H). Kontrak menyusun bentuk yang sama sendiri, tanpa memanggil `generate-intent`.

### 6.3 Keeper: siklus

Stateless terhadap chain: setiap siklus (default 60 detik) membaca vault, verifier, dan Hyperliquid, lalu bergerak satu langkah menuju kondisi yang diinginkan.

1. Lanjutkan perpindahan dana yang tertinggal dari siklus sebelumnya (jurnal, §6.8). Lalu sweep deposit.
2. `report_prices`: quote dry per aset → harga terverifikasi.
3. Strategist (§6.5) tiap `STRATEGIST_INTERVAL_MIN` (default 30). Keputusan diterima → kondisi yang diinginkan berubah (aset target, atau USDC kalau PARK).
4. Alokasi, satu langkah per siklus, dengan prioritas:
   1. Selesaikan withdraw yang sudah ditandatangani. Bayar antrean FIFO selama USDC menganggur cukup (maks 5 per siklus).
   2. Margin darurat: nilai akun < 3× maintenance margin → kirim margin dari USDC menganggur, atau jual ¼ spot untuk mengecilkan posisi.
   3. Likuiditas withdraw: kekurangan untuk withdraw berikutnya diambil dari margin (kalau cukup) atau dengan menjual spot minimal $12. Tidak terikat ambang penyeimbangan, supaya antrean tidak macet.
   4. Pindahkan aset non-target (rotasi/PARK), minimal $10.50 supaya short-nya bisa ditutup.
   5. Margin = ekuitas/(L+1), spot = sisanya. Toleransi margin $5, spot minimal $12 (order minimum Hyperliquid $10).
   6. Tarik margin berlebih.
5. **Hedge lebih dulu:** setiap swap spot menyesuaikan short sebelum spot berubah (kurangi short aset asal, tambah short aset tujuan sesuai quote). Kalau Hyperliquid menolak order, swap dibatalkan.
6. Hedge: short tiap aset disamakan dengan spot (pembulatan dan sisa).
7. `report_position`, **hanya kalau hedge seimbang**. Kalau tidak (misalnya Hyperliquid menolak order saat macet), laporan ditunda: NAV basi menahan deposit sampai hedge pulih, alih-alih memicu pause.

Leverage ≤ 2x (`updateLeverage` sebelum setiap order). Semua langkah alokasi dibungkus supaya kegagalan tidak membatalkan laporan.

### 6.4 Keeper: rotasi otomatis

Rotasi = swap spot A → B lewat Intents (~0.3%) + tutup short A dan buka short B di Hyperliquid (~2 × 0.045%). Total biaya sekitar **0.4% dari notional**. Aturannya konservatif:

- Sinyal: funding rata-rata `funding_window_hours` (default 8 jam) per aset, bukan angka sesaat.
- Rotasi ke B hanya bila semua syarat terpenuhi:
  1. `avg_funding(B) - avg_funding(A) ≥ rotation_threshold_apr` (default 5% APR).
  2. **Payback**: biaya rotasi (dari quote 1Click + estimasi slippage Hyperliquid) tertutup oleh selisih funding dalam ≤ `max_payback_hours` (default **168 jam**; koreksi 11 Nov: dengan biaya 0.4%, batas 72 jam butuh selisih ≥ 49% APR sehingga rotasi praktis tidak pernah terjadi. 168 jam berarti selisih ≥ ~21% APR. Rotasi memang langka).
  3. Aset aktif sudah dipegang ≥ `min_hold_hours` (default 6 jam, sama dengan guardrail LLM).
  4. Perp B cukup likuid untuk ukuran posisi.
- Eksekusi: hedge lebih dulu (tutup sebagian short A, buka short B), lalu swap spot A → B lewat vault, maks `max_swap_usdc` per swap. Sisa yang terlalu kecil untuk ditutup di Hyperliquid tidak pernah ditinggalkan.
- Setiap keputusan dicatat lewat `report_decision`, misalnya "NEAR 520% vs BTC 306% APR, payback 16h".
- Mode demo: `DEMO_FUNDING='{"NEAR":520}' DEMO_MIN_HOLD_HOURS=0` untuk memicu rotasi atau PARK di testnet (funding testnet tidak realistis).

### 6.5 LLM strategist

**Prinsip: LLM memutuskan, guardrail membatasi, kontrak menjadi batas terakhir.**

- **Kapan:** tiap `strategist_interval_min` (default 30 menit, mode demo 2 menit), atau saat ada pemicu (funding salah satu aset bergeser > 5% APR, margin ratio turun).
- **Model:** LLM di NEAR AI Cloud (API kompatibel OpenAI, inferensi di TEE). Model persisnya dipilih saat build dari daftar model yang tersedia.
- **Input (snapshot JSON):** funding sesaat + riwayat 24 jam per aset allowlist, open interest, mark/oracle price, volatilitas, posisi saat ini, umur aset aktif, estimasi biaya rotasi (dari quote 1Click), batas guardrail, dan "catatan pasar" (teks dari luar, tidak dipercaya).
- **Output (JSON terstruktur, divalidasi skema):** `{ action: HOLD | ROTATE | PARK | RESUME | SET_LEVERAGE, target?, leverage?, confidence, reasoning }`. Tidak ada aksi lain. Tidak ada field alamat atau jumlah transfer.
- **Guardrail pasti (`packages/core`):**
  - `target` ∈ allowlist. `leverage` ∈ [1, 2].
  - Maks `max_rotations_per_day` (default 2). Aset aktif dipegang ≥ `llm_min_hold_hours` (default 6).
  - Biaya rotasi balik modal ≤ `llm_max_payback_hours` (default 168) memakai funding rata-rata yang **teramati** (bukan prediksi LLM).
  - `confidence ≥ min_confidence`.
  - Ditolak → keputusan dicatat dengan alasan penolakan. Keeper tidak bertindak.
- **Fallback:** NEAR AI Cloud gagal/timeout/output tidak valid → aturan pasti §6.4.
- **Verifiable:** setiap keputusan disimpan lengkap (input, output, model, signature respons + attestation NEAR AI Cloud) dan hash-nya dicatat on-chain lewat `report_decision(hash, action, accepted)`. `/proof` menampilkan isi lengkap dan link verifikasi attestation.
- **Pengukuran:** `npm run simulate:strategy` memutar jendela funding historis dan membandingkan LLM vs aturan pasti vs hold BTC, setelah biaya. Jumlah panggilan dibatasi (±50 jendela) supaya muat di kredit $10.
- **Demo serangan:** `npm run attack:llm` menyisipkan prompt injection di "catatan pasar" (minta rotasi ke SOL, leverage 20x, kirim margin ke alamat luar). Output LLM apa pun → ditolak guardrail atau tidak bisa diekspresikan oleh skema.

### 6.6 Frontend (`apps/web`)

Toggle testnet/mainnet di semua halaman. Versi hosted default ke mainnet. Wallet NEAR lewat `@hot-labs/near-connect`.

**`/` Landing**: untuk juri manusia dan viewer post X.
- Hero: satu kalimat masalah + satu kalimat solusi, tanpa jargon.
- Statistik live dari mainnet: TVL, APR terealisasi, aset aktif.
- "Cara kerja" 3 langkah: deposit → kontrak beli spot lewat Intents + short di Hyperliquid → funding masuk.
- Bagian keamanan: "agent bisa trading, tidak bisa withdraw", dengan link ke `/proof`.
- Risiko yang jujur (funding negatif, risiko venue, R1, R7).
- CTA ke `/app`.

**`/app` Vault**: untuk user.
- Connect wallet. Deposit/withdraw USDC.
- Posisi user: share, nilai sekarang, yield terkumpul.
- Status antrean withdraw.
- S1: "deposit dari chain apa pun" lewat 1Click (quote → alamat deposit → status REFUNDED/FAILED/SUCCESS).

**`/dashboard`**: untuk user dan juri DeFi.
- Grafik NAV dan share price (dari `get_nav_history`).
- Komposisi vault: spot yang dipegang kontrak (link ke saldo NEAR) vs short di Hyperliquid (link ke explorer).
- **Funding Radar**: funding sesaat dan rata-rata 8 jam untuk BTC/ETH/NEAR, menandai aset aktif dan kandidat rotasi beserta perhitungan payback. SOL/HYPE ditampilkan abu-abu dengan keterangan "belum tersedia sebagai token di NEAR".
- Aset aktif + alasan, riwayat rotasi, swap Intents terakhir (`get_signed_intents` + intent hash).
- **Strategist feed:** keputusan LLM terbaru (aksi, confidence, reasoning), status guardrail (lolos/ditolak + alasan), dan perbandingan dengan keputusan aturan pasti.
- Hedge ratio, leverage, jarak ke likuidasi, status keeper, log siklus terakhir.

**`/proof` Transparansi**: untuk juri AI dan juri skeptis.
- Alamat: kontrak vault, master Hyperliquid (turunan MPC), agent. Masing-masing dengan link explorer.
- Klaim → bukti → cara mengecek sendiri. Contoh: "Master dikontrol kontrak" → hitung ulang derivasi atau panggil view `derived_public_key` di MPC. "Agent tidak bisa withdraw" → log percobaan yang ditolak. "Spot dipegang vault" → `mt_balance_of` akun vault di `intents.near`. "Swap tidak bisa dibelokkan" → payload intent yang ditandatangani hanya berisi satu `token_diff`.
- Daftar tx penting: `approveAgent`, swap Intents, transfer margin, rotasi.
- Keputusan strategist: hash on-chain ↔ isi lengkap ↔ attestation NEAR AI Cloud.
- NAV: komponen per komponen, dengan sumber (saldo kontrak, harga quote 1Click terverifikasi, laporan keeper yang dibatasi).

### 6.7 Demo dan simulasi

- `npm run demo`: **tanpa key, tanpa dana**. State vault testnet live, alamat MPC dihitung ulang, quote 1Click mainnet asli diverifikasi (dan versi palsunya ditolak), crash ±20%, guardrail vs strategist yang dibobol.
- `npm run attack`: agent key mencoba `withdraw3`/`usdSend`/`agentSendAsset` ke penyerang, dan keeper mencoba menandatangani quote yang penerimanya diganti. Semua ditolak.
- `npm run attack:llm`: prompt injection ke model asli + output model yang dibobol total → guardrail.
- `npm run simulate:crash`, `npm run simulate:strategy` (hold vs aturan vs LLM, data funding Hyperliquid mainnet).
- `scripts/e2e-testnet.ts`, `scripts/reset-testnet.ts`.

### 6.8 Keeper: keandalan dan skala

- **Penandatanganan tanpa CLI:** `near-kit` dengan private key dari `.env`. Transaksi ditandatangani sekali (hash diketahui), dikirim ulang dengan byte yang sama, dan statusnya dipolling sampai final. Aman diulang di endpoint mana pun tanpa risiko eksekusi ganda. RPC publik sering timeout (500) saat menunggu transaksi yang memanggil MPC.
- **Key terbatas:** function-call key yang hanya boleh memanggil vault (`scripts/add-keeper-keys.ts`). Full access key owner tidak pernah ada di host keeper.
- **RPC:** fallback ke beberapa endpoint, `NEAR_RPC_URLS` (berbayar) dicoba lebih dulu.
- **Lock:** satu keeper per host (`.state/keeper.lock`). Satu keeper per key adalah aturan operasional.
- **Jurnal:** setiap perpindahan dana dicatat (quote → signed → executed → filled). Setelah crash, siklus berikutnya melanjutkan: intent dicek dengan `is_nonce_used` lalu dieksekusi kalau belum dan masih berlaku, `sendAsset` dikirim ulang (Hyperliquid menolak nonce ganda), solver mock tidak mengisi dua kali. Diuji dengan crash paksa setelah MPC menandatangani transfer margin.
- **Skala withdraw:** sampai 5 per siklus, FIFO, likuiditas dikumpulkan khusus untuk antrean.
- **Selisih hedge kecil:** order IOC bisa terisi sebagian (terlihat di testnet: short 0,00022 BTC terisi 0,0002), meninggalkan selisih di luar band tapi di bawah minimum order $10. Akibatnya keeper berhenti report dan NAV basi menahan deposit. Langkah hedge kini menutup selisih seperti itu dengan dua order: short sebesar selisih + satu order minimum, lalu buy back order minimum itu. Kaki short selalu jalan duluan.
- **Leverage venue ≠ leverage vault:** leverage ekonomi (2x) ditentukan pembagian dana (margin = equity / (L+1)). Setelan leverage Hyperliquid hanya menentukan initial margin per order. Kalau disetel sama dengan L, margin terpakai 100% dan order apa pun ditolak ("Insufficient margin"). Keeper menyetel min(5x, maks aset). Risiko likuidasi tidak berubah karena mode cross diukur dari maintenance margin terhadap nilai akun, dan tetap dijaga aturan darurat margin (< 3× maintenance).
- **Deploy:** `ecosystem.config.cjs` (pm2, autorestart). Monitoring yang disarankan: endpoint health yang gagal bila NAV > 5 menit, dipantau uptime checker.

## 7. Risiko dan model ancaman

| ID | Risiko | Mitigasi | Klaim yang jujur |
|---|---|---|---|
| R1 | Agent key bocor | Agent tidak bisa withdraw/send. Owner `revoke_agent` via kontrak | Agent **masih bisa merugikan** kaki short lewat trading buruk atau `vaultTransfer`. Kaki spot aman karena dipegang kontrak |
| R2 | Funding negatif lama | Rotasi ke aset lain. Bila semua negatif → `PARKED` | Yield bisa nol |
| R3 | Keeper memalsukan NAV | Spot dan USDC dibaca kontrak dari verifier, harga dari quote 1Click terverifikasi. Nilai akun Hyperliquid dicek per laporan terhadap laporan sebelumnya + margin yang dipindah + efek harga. Pelanggaran → pause | Tidak trustless: keeper jahat bisa menggeser nilai akun sampai `max_report_drift_bps` (1%) per laporan. Pergeseran beruntun terlihat di riwayat NAV, dan owner bisa pause |
| R10 | LLM strategist kena prompt injection atau berhalusinasi | Skema output tertutup, guardrail pasti, batas kontrak, fallback aturan pasti | LLM bisa membuat keputusan buruk **di dalam** pagar (mis. rotasi yang tidak menguntungkan), dibatasi maks 2 rotasi/hari |
| R12 | Hyperliquid menolak order (kemacetan, terlihat di testnet: "only post-only orders") | Hedge lebih dulu: swap tidak jalan tanpa short yang sesuai. Laporan ditunda selama hedge tidak seimbang | Deposit tertunda selama venue macet. Order post-only sebagai fallback belum dibuat |
| R13 | Host keeper crash di tengah perpindahan dana | Jurnal + `is_nonce_used`, dilanjutkan di siklus berikutnya | Intent margin yang kedaluwarsa sebelum keeper hidup lagi membuat catatan margin salah → pause, owner koreksi `set_margin_net` |
| R11 | Harga oracle basi atau melenceng | Harga hanya dari quote 1Click bertanda tangan, umur ≤ `max_price_age_s`. Harga quote sudah dipotong fee, jadi NAV konservatif | Bergantung pada 1Click (sudah dipercaya untuk eksekusi). Pyth tidak dipakai: Hermes kini butuh API key, harga Pyth di NEAR basi berbulan-bulan, dan `priceoracle.near` kosong (dicek 11 Nov) |
| R4 | Likuidasi short saat harga naik tajam | Leverage ≤2x + top-up margin lewat Intents | Top-up butuh ~30 detik. Gap harga ekstrem tetap bisa melikuidasi |
| R5 | Biaya rotasi > manfaat | Syarat payback + cooldown | Rotasi bisa rugi kalau funding berbalik tepat setelahnya |
| R6 | MPC lambat/gagal | Aksi admin jarang. Trading tidak bergantung MPC | — |
| R7 | Keeper membelokkan dana lewat swap/transfer margin | Kontrak memverifikasi tanda tangan quote 1Click (ed25519) dan memeriksa `recipient`/`refundTo` = vault sebelum MPC menandatangani (§6.2) | Keeper jahat hanya bisa memilih quote terburuk yang lolos batas harga oracle (≤ `max_slippage_bps` per swap). Vault mempercayai 1Click untuk mengeksekusi quote yang ia tandatangani |
| R8 | Jeda tanpa hedge saat swap (~20–35 detik) | Urutan eksekusi §6.3 / §6.4 | Ada eksposur harga singkat di setiap pembukaan hedge |
| R9 | Risiko venue (Hyperliquid) dan bridge token (nBTC, ETH bridged) | Disebut terang-terangan | Vault mewarisi risiko Hyperliquid dan bridge |

## 8. Gate teknis dan hasil spike

| Gate | Hasil |
|---|---|
| G-A: MPC menandatangani EIP-712 yang diterima Hyperliquid | ✅ Lolos. Args `sign({request:{payload_v2:{Ecdsa:<hex32>},path,domain_id:0}})`, 300 Tgas, 1 yocto |
| G-B: Mendanai alamat turunan di testnet | ✅ Faucet ke `0x29e0…5c86` (sudah deposit mainnet), lalu `usdSend` ke alamat turunan |
| G-C: Spot Hyperliquid testnet | ❌ Rusak. Tidak relevan lagi: kaki spot kini di akun Intents vault (testnet: mock-verifier) |
| G-D: Siapa yang boleh memindahkan margin | ✅ `usdClassTransfer` user-signed (master saja). `vaultTransfer`/`subAccountTransfer` L1 (agent bisa → R1) |
| G-E: Rute 1Click untuk desain Intents-native | ✅ Quote dry-run sukses: USDC→nBTC di NEAR, USDC NEAR ⇄ USDC Hyperliquid (`hypercore`). Lihat tabel §5 |
| G-F: Transfer margin akun Intents vault ⇄ Hyperliquid lewat 1Click | Belum diuji dengan dana. Dicek di awal migrasi mainnet dengan nominal $1 |
| G-G: `intents.near` menerima intent `erc191` yang ditandatangani MPC | ✅ **Lolos (10 Nov)** via `simulate_intents` di mainnet (gratis, tanpa dana). Lihat tabel di bawah |
| G-H: Jalur eksekusi swap untuk akun vault | ❌ Message bus solver: **tidak ada likuiditas untuk aset kita**. Uji 11 Nov: key tidak dicek (tanpa key / key palsu / key asli identik). USDC→USDT dapat 1 quote, tapi USDC⇄nBTC dan USDC⇄wNEAR selalu `null`. Dokumentasi juga menyarankan 1Click untuk integrasi swap. ✅ 1Click signed-intent jalan: quote `INTENTS` + `generate-intent` (`erc191`, signer = alamat vault) menghasilkan satu `transfer` ke `depositAddress`. **Dipakai: 1Click** |
| G-I: Kontrak bisa membuktikan `depositAddress` milik 1Click | ✅ **Lolos (10 Nov)**. Quote ditandatangani ed25519 oleh key manajer 1Click. Quote asli: valid. `depositAddress` dipalsukan: tidak valid. NEAR punya `env::ed25519_verify` |
| G-J: Model NEAR AI Cloud dengan attestation TEE | ✅ `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `Qwen/Qwen3.8-27B`, `Qwen/Qwen3.6-35B-A3B-FP8` mengembalikan attestation + `signing_address`. Claude/GPT/Qwen-max: tidak ada attestation (anonymised) |
| G-K: `sendAsset` dari master yang ditandatangani MPC diterima Hyperliquid (tarik margin) | ✅ 11 Nov di testnet, token `USDC:0xeb62…` (beda dengan mainnet) |
| G-L: NEAR tidak mengizinkan menghapus akun dengan state besar | ⚠️ Ditemukan 11 Nov → `reinit` dengan prefix storage generasi baru |

Bukti spike (10 Nov, `scripts/spike-chainsig-hl.ts`, master `nullpoint.testnet`/`hl-master` = `0x5e33437E5b871F1Aa9E252Dd00a36C53DFcb9a8D`):

| Langkah | Penanda tangan | Hasil |
|---|---|---|
| `approveAgent` → `0x828766ACCf9179C3b9dA7A6939362ae185Be1831` ("nullpoint-keeper") | MPC | `status: ok`, muncul di `extraAgents` |
| `usdClassTransfer` 50 USDC spot → perp | MPC | `status: ok` |
| Short 0.01 ETH IOC | Agent | Filled @ 2101.65, oid `64984983738`, posisi tercatat di akun master |
| `withdraw3`, `usdSend` | Agent | Ditolak (diatribusikan ke akun agent yang kosong) |
| `agentSendAsset` 1 USDC master → alamat luar (11 Nov) | Agent | **Ditolak**: "Agent can only send asset to same user or their sub-accounts". Aksi L1 ini memang ada untuk agent, tapi Hyperliquid membatasi tujuannya ke akun master sendiri / sub-account-nya |

Bukti spike G-G (10 Nov, `scripts/spike-intents-sig.ts`, `simulate_intents` di `intents.near` mainnet, salt `252812b3`, intent `token_diff` −20 USDC / +0.00026 nBTC):

| Penanda tangan | Hasil verifier | Artinya |
|---|---|---|
| Key lokal (kontrol format) | `insufficient balance or overflow` | Format payload, nonce, tanda tangan benar |
| **MPC** `0x5e33…9a8d` | `insufficient balance or overflow` | ✅ Tanda tangan MPC diterima. Gagal hanya karena saldo kosong |
| MPC, payload diubah setelah ditandatangani | `public key … doesn't exist for account 0x5e33…` | ✅ Tanda tangan benar-benar mengikat isi payload |

Catatan: leverage default Hyperliquid 20x cross, jadi keeper wajib `updateLeverage`. Master final diturunkan dari akun kontrak vault, sehingga butuh pendanaan ulang.

## 9. Pertanyaan terbuka

| ID | Pertanyaan | Status |
|---|---|---|
| O1 | Apakah 1Click punya rute langsung ke Hyperliquid? | ✅ Ya, chain `hypercore` (§5) |
| O2 | Akun NEAR mainnet owner (juga untuk payout hadiah) | Terbuka. Dibutuhkan sebelum migrasi (Kam 13) |
| O3 | ETH di Arbitrum untuk gas alamat master | ✅ Tidak perlu (rute langsung) |
| O4 | Ukuran tim untuk field submission | Terbuka. Sebelum submit |
| O5 | **Partner API key NEAR Intents** (partners.near-intents.org) | ✅ Ada (Distribution Channel, di `.env`). Jalan untuk `quote`/`generate-intent`. Catatan: quote USDC NEAR→Hyperliquid dengan dan tanpa key hasilnya sama (19.68 dari 20), jadi diskon fee belum terlihat. Cek ulang status key di portal. Tidak lagi memblokir mainnet. Daftar secepatnya karena waktu approval tidak terdokumentasi. Fallback bila tidak dapat: swap lewat alamat deposit 1Click dengan mitigasi R7 lama (`max_swap_amount` + cek saldo + auto-pause) |
| O6 | API key NEAR AI Cloud (klaim $10 lewat nearbuilders.org/dashboard) | ✅ Ada di `.env`, chat + endpoint signature jalan |
| O7 | Model NEAR AI Cloud yang dipakai strategist | ✅ `deepseek-ai/DeepSeek-V4.1-Flash-1017`, fallback `Qwen/Qwen3.8-27B` (Gate G-J). Kualitas output JSON dicek saat build |

## 10. Rencana kerja

| Hari | Fase | Status |
|---|---|---|
| Sen 10 Nov | Riset + spike gate A–J | ✅ |
| Sel 11 Nov | Testnet: kontrak + mock + core, keeper (alokasi, rotasi, PARK, withdraw batch, strategist LLM), frontend 4 halaman, demo/attack/simulate, keandalan keeper (near-kit, key terbatas, jurnal, lock, hedge lebih dulu) | ✅ kecuali regresi PARK → RESUME yang tertunda karena Hyperliquid testnet macet |
| Rab 12 Nov | Redesign frontend. Migrasi mainnet: jalur 1Click asli di keeper (`submit-intent` + polling status), deploy kontrak (cap $100), key keeper mainnet, approve agent, deposit $60 | |
| Kam 13 Nov | Keeper mainnet di VPS (pm2), hosting web, monitoring, README | |
| Jum 14 Nov | Video, post X, uji di clone bersih, submit | |

**Aturan migrasi:** mainnet tidak disentuh sampai regresi testnet lulus. Setiap tx mainnet minta konfirmasi owner.

## 11. Kriteria penerimaan submission

- `git clone && npm install && npm run demo` jalan tanpa `.env` (dry-run).
- `npm test` lulus (kontrak + core).
- README dibuka dengan: apa produknya, masalahnya, langkah bernomor "do X → see Y", lalu bagian "What is verifiable" berisi klaim → cara mengecek → link (testnet dan mainnet).
- Daftar tx hash dan alamat: kontrak vault (testnet + mainnet), alamat master turunan, tx `approveAgent`, swap Intents, transfer margin, posisi Hyperliquid, rotasi, percobaan withdraw agent yang gagal.
- Dashboard hosted hidup sampai minimal 18 Nov (idealnya 25 Nov).
- LICENSE (MIT). Disclosure: library, kode hasil AI, tidak ada kode pra-hackathon.
- Tidak ada secret di repo. `.env.example` lengkap.
