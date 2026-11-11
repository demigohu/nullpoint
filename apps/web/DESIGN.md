# Design System: NullPoint

Single source of truth for the web frontend (`apps/web`). Every page, component and animation
follows this file. When code and this file disagree, fix one of them in the same change.

---

## 0. The idea

**Two values, and they always add up to zero.**

The vault holds every position twice: once long (spot in NEAR Intents, `+`) and once short
(a Hyperliquid perp, `−`). The price can do anything; the sum stays at the null point.
The whole visual language comes from that one rule:

- The screen is made of **cells**. Each cell carries one of two signs: `+` (long leg) or `−` (short leg).
- Only **two colors** are on screen at once: the sign color and the ground color.
- When the vault **parks** in USDC there is no position at all, and every sign becomes `0`.
- When the vault **rotates** to a new asset, the whole site changes duotone.

Nothing on the page is decoration without a meaning in the product. If an element can't be traced
back to "long, short, zero", it doesn't belong.

**Design read:** a DeFi product site plus app for crypto-native users and hackathon judges, with an
experimental generative-art language (duotone, kinetic display type, live cell field, HUD labels),
built with Next.js 16 + Tailwind v4, GSAP on the landing page, Motion in the app.

| Dial | Landing `/` | App pages `/app` `/dashboard` `/proof` |
|---|---|---|
| DESIGN_VARIANCE | 9 | 7 |
| MOTION_INTENSITY | 8 | 6 |
| VISUAL_DENSITY | 3 | 6 |

All pages share the same language (type, duotone, field, HUD). The app pages are just as
experimental visually; what changes is pace: no scroll-hijack, and money actions are never slowed
down by animation.

---

## 1. Modes (color)

The site is always in exactly one **mode**. A mode is a duotone (`--t` sign color, `--f` ground
color) plus a glyph pair. By default the mode follows the coin the vault is committed to: the last
accepted ROTATE/RESUME/PARK decision (`targetMode`, the same rule as the keeper). Positions alone
would flicker to PARK while a withdrawal briefly closes the short. Open pages check every 60 s, and a
rotation changes the colors live with the field's wave. The mode never cycles on a timer, so the
color always means something. The account menu lets a visitor preview another mode for the session.

| Mode | Shown when | `--t` sign | `--f` ground | Glyphs (long / short) | Contrast |
|---|---|---|---|---|---|
| **BTC** | vault hedging BTC | Signal Orange `#FF5B14` | Ink `#0A0A0A` | `+` / `−` | 6.37 |
| **ETH** | vault hedging ETH | Cobalt `#2433FF` | Paper `#F2F1EC` | `+` / `−` | 6.21 |
| **NEAR** | vault hedging NEAR | Mint `#00E59B` | Ink `#0A0A0A` | `+` / `−` | 11.96 |
| **PARK** | vault parked in USDC, or no data | Paper `#F2F1EC` | Ink `#0A0A0A` | `0` / `0` | 17.51 |

**Alarm** is the only third color. It appears only when the vault is paused, a withdrawal is stuck
or a transaction failed: `#FF3B30` on Ink (5.58) or `#C8160E` on Paper (5.19). It is never used for
decoration, hover or emphasis.

### Rules
- **Two colors per screen**, plus Alarm only when something is actually wrong. There is no gray,
  no gradient, no shadow, no transparency used as a third tone. Hierarchy comes from size,
  weight, inversion (sign on ground vs ground on sign) and the `wdth` axis.
- The one tint allowed is **Dim** = `color-mix(in srgb, var(--t) 35%, var(--f))`. It is only for
  non-text marks, such as the `/` between glyphs, inactive bits and hairlines. Text is never dim.
- **Mode changes** tween `--t` and `--f` on `:root` over 850 ms with `power2.inOut`. Field glyphs
  and HUD glyphs scramble to the new pair over 500 ms. `<meta name="theme-color">` follows `--f`.
- The light or dark OS preference is **not** used. The mode decides the theme, and ETH is the only
  light mode. Every component must work on both an Ink ground and a Paper ground. Test all four
  modes before shipping.
- **Charts** are drawn with `--t` only:
  - Series are told apart by stroke style (solid 2px = hedged NAV, dotted 1.5px = unhedged asset),
    with direct labels at the line end.
  - There are no legends and no colored series.
  - Every chart has a table view.

### Tokens (`globals.css`)
```css
:root {
  --ink: #0A0A0A;  --paper: #F2F1EC;
  --t: #FF5B14;    --f: var(--ink);           /* set per mode, tweened on change */
  --dim: color-mix(in srgb, var(--t) 35%, var(--f));
  --alarm: #FF3B30;                            /* #C8160E when --f is paper */
  --ease-hud: cubic-bezier(.7, 0, .2, 1);      /* wipes, collapses, mode changes */
  --ease-out: cubic-bezier(.16, 1, .3, 1);     /* reveals (expo.out) */
  --pad: clamp(16px, 2.2vw, 40px);             /* page gutter */
  --hud: clamp(30px, 2.4vw, 38px);             /* HUD control height */
}
```
The Tailwind `@theme inline` block exposes them as `tc` (sign) and `fc` (ground): `bg-tc`,
`text-fc`, `border-tc`, plus `dim` and `alarm`. They aren't named `t`/`f` because `border-t` is
already Tailwind's top border. **Radius is 0 everywhere.** There is no radius token at all.

---

## 2. Typography

Two families, self-hosted with `next/font/google`. They replace Geist.

- **Display + body: Archivo** (variable, `wght` 300–900, `wdth` 62–125).
  Load it with `axes: ["wdth"]`. Width carries the hierarchy: the wider the setting, the louder the
  voice.
- **Labels + numbers: JetBrains Mono** (400–800). It is used for every number the product computes
  (NAV, APR, shares, amounts, hashes, addresses), every HUD label, every table and every input.
  Always `tabular-nums`.

| Role | Font | Size | Weight / wdth | Tracking | Leading |
|---|---|---|---|---|---|
| Hero word | Archivo | `clamp(5rem, 21vw, 22rem)` | 800 / 125 | −0.05em | 0.82 |
| Section title | Archivo | `clamp(2.4rem, 6.2vw, 7.6rem)` | 800 / 118 | −0.045em | 0.9 |
| Big numeral (NAV, APR) | JetBrains Mono | `clamp(3rem, 8vw, 9rem)` | 700 | −0.04em | 0.9 |
| Sub-title | Archivo | `clamp(1.5rem, 2.2vw, 2.8rem)` | 700 / 110 | −0.035em | 1.0 |
| Lede | Archivo | `clamp(16px, 1.25vw, 20px)` | 400 / 104 | 0 | 1.45 |
| Body | Archivo | `clamp(15px, 1.05vw, 17px)` | 400 / 100 | 0 | 1.5, max 62ch |
| HUD label | JetBrains Mono | 11–12px | 500, UPPERCASE | 0.35em | 1 |
| Data / table | JetBrains Mono | 13–14px | 400 | 0 | 1.4 |

- **Emphasis inside a headline** comes in two forms. One is a word **set in Mono inside an
  inverted box**, for the protocol's nouns (for example "the vault keeps `two legs`
  and `no exposure`."). The other is the same family at a narrower `wdth`. Serif and italic are
  not used at all.
- The wordmark is **null**Point: "null" at weight 400, "Point" at weight 800, both at wdth 112.
- Mono labels sit in a **chip**, a box in `--t` with `--f` text and 4px × 8px padding. The section
  index chip (`01`) is the only allowed eyebrow, and only on the landing page's four story chapters.
- Hyphen `-` only. No em dash or en dash appears in any visible copy. The short-leg glyph is the
  real minus sign `−` (U+2212).

---

## 3. The Field (signature component)

A `<canvas>` grid of cells that is the visual heart of every page. It is not wallpaper: it
**renders the vault's state**.

- **Cell value:** each cell reads 2D simplex noise at `(x·scale, y·scale, t)`.
  - Above a threshold the cell is **long** (`+`, filled `--t`, glyph in `--f`).
  - Below it the cell is **short** (`−`, filled `--f`, glyph in `--t`).
- **Data binding:**
  - The threshold is set so that the share of `+` cells equals `long / (long + short)` from the last
    `report_position`. A healthy vault reads close to 50/50, so the field is visibly balanced.
  - Hedge drift moves the balance live. A drift past the hedge band (2%) shows a slow pulse on the
    border cells.
  - In PARK mode every glyph is `0` and the field slows to 20% speed.
- **Time:** `t` advances at 0.6 units/s (landing) or 0.35 units/s (app pages). It freezes when the
  global pause is on.
- **Interaction:** a click or tap sends a ripple from the pointer, flipping signs as the ring
  passes, with a 400 ms cooldown. On the landing hero only, scroll widens the cells
  (`cell × (1 + progress × 3.2)`) so the field "zooms in".
- **Rotation event:** when the live data reports a new active asset, a wave sweeps left to right
  (1.2 s, `--ease-hud`). Cells behind the wave take the new mode's colors, so the site's color
  change *is* the rotation, visible to anyone watching.
- **Text over the field:** text always sits on a **solid block of `--f`** (inverted panel) with
  `--pad` padding. It never sits directly on moving cells. Forms and numbers are never placed over
  the field without that backing.
- **Cell size:** `clamp(22px, 2vw, 32px)` (22 on mobile). DPR is capped at 2.
- **Performance:**
  - One shared `requestAnimationFrame` (or GSAP ticker) drives every field on the page.
  - A field draws only while it is in view (`IntersectionObserver`) and only when the tab is visible.
  - Only cells whose sign changed since the last frame are redrawn.
- **Accessibility:** the canvas is `aria-hidden`. Its meaning is given in text right next to it
  (for example "Long 50.4%, short 49.6%, hedge within band").

The implementation lives in `components/field/`:
- `field.ts`: framework-free core (noise, draw, ripple, wave).
- `<Field />`: the client React wrapper, which takes `{ longShare, mode, speed, interactive }`.

---

## 4. HUD (global chrome)

The HUD is fixed and identical on every page. All controls are Mono and sharp, `--hud` tall, with a
1px `--t` border.

- **Top left:** the null**Point** wordmark, which links home. On app pages the **delta readout**
  sits next to it: `Δ +0.0021 BTC` (coin held minus the short), Alarm if the vault is paused.
- **Top right**, in this order:
  - Page links (`Vault`, `Dashboard`, `Proof`).
  - The **account menu**. Connected, the button shows the account ID truncated from the middle and
    opens a dropdown:
    - `Get 100 test USDC` (testnet only), with its explanation and transaction link.
    - Network: `testnet | mainnet`.
    - Colors: the segmented `BTC | ETH | NEAR | 0` preview (the live coin is named).
    - Animations on/off, which stops all perpetual motion.
    - Disconnect.
  - Disconnected: `Connect wallet` connects directly, and a settings button next to it opens the
    same dropdown with network, colors and animations.
  - The dropdown scales from the button's corner: 150 ms, opacity + `scale .97 → 1`, `ease-out`.
    It closes on Escape (focus returns to the button) and on an outside click.
- **Right edge:** a vertical **7-bit progress readout** made of 7 squares (filled = 1) for the
  scroll percentage in binary, with the decimal value under it rotated 90°. This is the only rotated
  text on the site.
- **Mobile (< 768px):**
  - The page links move into a full-screen menu that opens with a
    CRT-collapse in reverse (see §6).
  - The account menu stays in the bar.
- No magnetic pull on HUD controls: the account menu hangs from its button and must not drift.

---

## 5. Components

All components are sharp-cornered (radius 0) and use only `--t`, `--f`, Dim (non-text) and Alarm.

- **Button, primary:**
  - Solid `--t` with `--f` text, Mono UPPERCASE 13px, tracking 0.2em, min height 48px.
  - Hover: an inverted fill wipes in from the left with `clip-path: inset(0 100% 0 0) → inset(0)`,
    280 ms `--ease-hud`.
  - Active: `scale(.97)` over 120 ms.
  - Labels are at most 3 words.
  - **One primary per screen.**
- **Button, secondary:** outlined with a 1px `--t` border. Same hover wipe.
- **Input (amount):**
  - Label (a Mono chip) sits above.
  - The value is a JetBrains Mono numeral at 48–64px on a solid `--f` panel with a 1px `--t`
    border.
  - A `MAX` chip sits inside on the right.
  - Helper and error text sit below in Mono 12px; errors are in Alarm.
  - Focus is a 2px `--t` outline offset by 2px.
  - The value the user types never animates.
- **Stat block:** a Mono chip label, then a big numeral, then a one-line Mono caption. Live values
  scramble into place when they change (§6). Stat blocks are separated by a 1px `--t` top rule, not
  boxes.
- **Panel:** a solid `--f` block with a 1px `--t` border. It is the only container style and is
  used to lift text, forms and tables off the field. Panels are not nested inside panels.
- **Table and log:**
  - Mono 13px. The header row is Mono chips.
  - Rows have no individual borders. Groups get one top rule.
  - Long values (hashes, addresses) are truncated in the middle and expand on click with a scramble.
- **Status track** (withdrawals and moves):
  - A request shows a row of steps, `requested → signed → paid`.
  - Each step is a square bit: filled when done, outlined while pending, Alarm if it is stuck for
    more than 10 minutes. The pending bit blinks at 1 Hz, which is the only perpetual
    micro-animation in the app.
  - Next to the bit is the step's time in Mono.
- **Monitor:** a framed field (a 1px `--t` border plus a Mono caption bar beneath:
  `monitor BTC` · `fullscreen`). Monitors show one asset's live field on the landing gallery and in
  the dashboard funding radar.
- **Toast:** a slim inverted bar at the bottom center of the screen, Mono 12px. It enters with
  `clip-path inset(0 50%) → inset(0)` over 240 ms and exits in 160 ms.
- **Explainer** (every user action in the app, wording in COPY.md):
  - **Transaction dialog** (`components/tx-dialog.tsx`, native `<dialog>`, 640px max, enters with
    opacity + `scale .97 → 1` over 200 ms `ease-out`, opacity only under reduced motion):
    1. *Review before you sign:* reads the chain and runs the contract's own checks on the
       user's numbers, shown as a list of square bits (filled = passes, Alarm = fails, which
       disables signing). Then a "now → after" table and a plain-words breakdown of the one
       transaction: contract, method, arguments, attached deposit, network fee.
    2. *Waiting for your wallet:* Escape is blocked until the wallet answers.
    3. *Done:* the result read back from the chain, the next step, the tx hash ↗. Or *Not sent*
       with the plain reason and `Review again`.
  - **Errors:** plain words first, then the raw reason in Mono below.
  - **Glossary term:** a dotted 1px `--t` underline. Tapping or hovering opens a 280px panel that
    takes the definition from COPY.md §G. Mark only the first use of a term on each page.
- **Activity feed** (dashboard): one plain sentence per event, with the technical line (method,
  amount, hash) under it in Mono.
- **Empty state:** a still field in PARK mode (`0` glyphs) with one sentence and one action
  (for example "No deposits yet. Deposit USDC to mint shares.").
- **Loading state:** cells fill row by row in Dim with a Mono label `reading chain…`. There are no
  spinners and no shimmer.
- **Icons:** Phosphor, `weight="bold"`, 16px, only where a word won't fit (copy, external link,
  close). Most "icons" are glyphs: `+ − 0 / ↗ ×`.

---

## 6. Motion

**Engines**
- **Landing** uses `gsap` + `ScrollTrigger` + `SplitText` + `lenis` (`lerp: 0.085`).
  GSAP's ticker drives Lenis, and all of this lives in client leaf components.
- **App pages** use `motion/react` and CSS. There is no Lenis and no scroll pinning.
- A component never uses both GSAP and Motion.

**Easing and duration**
| Use | Easing | Duration |
|---|---|---|
| Wipes, collapses, mode change | `--ease-hud` / `power2.inOut` | 280–850 ms |
| Reveals (lines, chars, panels) | `expo.out` / `--ease-out` | 900–1300 ms, stagger 40–80 ms |
| Press feedback | `ease-out` | 120 ms |
| Toast / menu exit | `ease-out` | 160 ms (exits faster than entries) |
| Scrubbed scroll | `none`, scrub 0.6 | scroll-linked |

**Signature moves** (each one has a reason, written next to it):

1. **Loader:**
   - *What:* a Δ counter runs from a random ±value down to `0.000` while a 7-bit binary readout
     fills and a glyph field flickers behind. The screen then collapses like a CRT switching off
     (core `scaleY → 0` over 350 ms, panel `scaleY → .004` over 500 ms, then `scaleX → 0` over
     320 ms).
   - *Why:* it states the thesis (everything converges to zero) before a word is read.
   - *Where:* landing only. It plays on the first visit of a session and is skipped after that
     (sessionStorage).
   - *Limit:* at most 2.2 s.
2. **Scramble:**
   - *What:* text resolves left to right from random glyphs of the current mode (`+−` or `0`),
     at 6 updates/s.
   - *Why:* values "settle" the way the hedge settles.
   - *Where:* hero chars, section titles on enter, mode change, and any live number that changes
     (NAV, APR, Δ).
   - *Never on:* amounts the user typed, confirmation dialogs, or addresses being copied.
3. **Hero split:**
   - *What:* "null" and "Point" sit on two lines. On scroll the hero pins for +75% of the viewport,
     line 1 drifts `xPercent −14`, line 2 drifts `+10`, and the side copy fades up and out.
   - *Why:* two legs moving in opposite directions while the composition stays balanced.
4. **Line reveal:** paragraphs split by line with a mask, each line rising `yPercent 110 → 0`.
5. **Word scrub:**
   - *What:* in one long statement per page, words go from 18% to 100% opacity as you scroll.
   - *Where:* the security manifesto.
6. **Clip wipe:** HUD chips, labels and panels open with `clip-path: inset(0 100% 0 0) → inset(0)`.
7. **Mode wave:** described in §3, the rotation made visible.
8. **Marquee:**
   - *What:* one footer band, `NULLPOINT  +/−  BTC  ETH  NEAR`, that runs for 38 s per loop. Its
     timeScale follows Lenis scroll velocity (up to 7× in either direction).
   - *Limit:* this is the only marquee on the site.

**Rules**
- Animate `transform`, `opacity` and `clip-path` only. Canvas work goes through the shared ticker.
- Every ScrollTrigger is created inside `gsap.context()` (or `useGSAP`) and reverted on unmount.
- Nothing animates on keyboard-driven actions, form submission or tab switches in the app.
- **Pause** (the HUD control) freezes fields, marquees, the scramble loop and blink. The choice is
  remembered in localStorage.
- **`prefers-reduced-motion: reduce`:**
  - No loader, no Lenis, no pins or scrubs, no scramble (text appears final), and no ripple or wave.
  - The field renders one still frame.
  - Mode changes become an instant color swap.
  - Opacity fades of 200 ms or less are kept.

---

## 7. Pages

### `/` Landing (story in chapters, each a different layout)
1. **Loader** (§6.1).
2. **Hero** (pinned):
   - A full-bleed field in the live mode with the giant two-line wordmark.
   - An inverted panel holds the headline, sub and CTAs from COPY.md.
   - The live numbers (active coin, funding, share price) sit in the HUD delta readout, not in the
     hero.
3. **Two legs** (pinned scrub, +160%):
   - The field zooms out like an aerial view until the cells resolve into a 30-day chart: BTC price
     (dotted) swinging while the hedged NAV (solid) stays flat.
   - A Mono readout counts the BTC drawdown alongside the vault's change.
   - A side panel explains where the fee comes from (funding).
   - This replaces the current hero chart.
4. **One cycle, four verbs** (pinned, +280%):
   - On the left, a list of the keeper cycle: `Sweep`, `Hedge`, `Report`, `Rotate`.
   - On the right, a square canvas whose behavior changes per step:
     - Sweep: cells enter from the edges.
     - Hedge: the signs pair up.
     - Report: borders light up as the contract checks them.
     - Rotate: the mode wave.
   - The active verb is shown full width at 800, the inactive ones at weight 400. A progress rule
     sits under each verb.
5. **Three assets** (horizontal pan on desktop, vertical on mobile):
   - Three monitors: BTC, ETH and NEAR. Each card is drawn in its own asset's duotone (local
     `--t`/`--f`), so the site's mode keeps meaning "what the vault holds".
   - Each card shows the asset's live funding APR (from `fundingRadar`), its open interest, and
     whether the strategist currently holds it.
   - Frames tilt ±1.5° with scroll.
6. **Built with** (five-row index):
   - Each row shows the brand's name in Archivo 700 / wdth 118 and its one job in body text. A
     monochrome mark in `--t` goes next to the name once the SVGs are in (COPY.md `[NEED]`).
   - Hovering a row (fine pointer only) inverts it with the clip wipe.
   - The marks are official SVGs drawn in a single color. The section has no logo wall and no
     category labels.
7. **The bot runs the trades. It can't take the money.**
   - A word-scrub manifesto (§6.5), followed by an evidence grid of the four attack results from
     `npm run attack`, each with its on-chain rejection and a link to `/proof`.
   - The grid is asymmetric: one large cell for the keeper-key attack, three small cells.
8. **What can still go wrong:** a spec grid of risks in Mono with plain answers. It is grouped
   into 3 clusters (venue, oracle, operator) and has no row borders.
9. **Footer:**
   - The marquee.
   - The statement *"Long, short, and nothing in between."*
   - Credits and links.
   - `start over`, which scrolls to the top and rewinds the field.

### `/app` Deposit and withdraw
- Desktop layout:
  - The left half is a field that renders **your** position (your shares × the vault's long share).
  - The right half is a single panel that switches between `Deposit` and `Withdraw` (segmented
    control, no animation).
  - Above the panel sit your value in a big numeral and the share price.
- Withdraw is automatic. The status track (§5) shows `requested → signed → paid`.
  `Finish it myself` appears only when a withdrawal is stuck for more than 10 minutes, in Alarm.
- Test USDC (testnet only) lives in the account menu (§4), not in the deposit panel.
- Deposit, withdraw and "finish it myself" each open the transaction dialog (§5 Explainer).

### `/dashboard`
- A cockpit layout on a 12-column grid:
  - **Top row:** 4 stat blocks (NAV/share, TVL, funding APR, Δ).
  - **Middle:** the NAV chart (8 cols) and the funding radar (4 cols), which shows three
    mini-monitors with their APRs, highlighting the active one.
  - **Bottom:** the strategist decision log (Mono terminal list: time, action, payback, accepted
    or rejected by the guardrail, TEE signature check) and the latest MPC signatures.
- The page's mode follows the active asset, so the dashboard's color itself tells you what the
  vault holds.

### `/proof`
- One column, like a document:
  - Contract addresses.
  - The vault's MPC-derived EVM address.
  - The agent key's permissions.
  - The latest signatures, each expandable to show the payload with a scramble-in.
- Every hash links to its explorer (↗).

---

## 8. Layout and responsive

- 12-column CSS grid with `--pad` gutters and a max width of 1680px. The field and the hero are full
  bleed.
- Full-height sections use `min-h-[100dvh]`, never `h-screen`.
- **Below 768px:**
  - Everything is a single column.
  - Pins and the horizontal pan are off, and those sections become stacked clip-path reveals.
  - The hero word drops to `clamp(3.4rem, 19vw, 6rem)`.
  - The field cell size is 22px.
- Touch targets are at least 44px. There is no horizontal page scroll at any width from 320px up.

---

## 9. Accessibility

- All four modes were checked for text contrast (table in §1). Large display type is above 6:1
  everywhere.
- Every canvas is `aria-hidden` and has a text equivalent next to it.
- Mode changes and live alerts are announced through one polite `aria-live` region
  ("Vault rotated to ETH").
- Focus is visible on every control (2px `--t` outline, offset 2px).
- The site has a skip link and is fully usable from the keyboard. Esc closes the menu and
  fullscreen.
- Users have a pause control and reduced-motion support (§6).

---

## 10. Copy voice

All visible strings come from `COPY.md`. Change the wording there first, then in the code.

- The copy is plain, specific and short. It names the mechanism, never the hype.
  Good: "The keeper can trade. The contract decides where money goes."
- Numbers are real (live from chain or Hyperliquid) or explicitly labeled as backtest.
- Banned:
  - em and en dashes
  - "seamless", "unleash", "elevate", "next-gen", "revolutionary"
  - emoji
  - scroll cues
  - version labels in the hero
  - fake round numbers

---

## 11. Deliberate choices and bans

**Deliberate (kept even though generic taste rules say otherwise):**
- **Ink `#0A0A0A` and Paper `#F2F1EC`** are near-pure on purpose. The duotone needs full tonal
  contrast.
- **Numbered chips (`01`–`04`)** appear only on the landing story chapters and the four verbs.
  They are real sequence, not decoration.
- **The vertical bit readout** is the only rotated text, and it carries real information.
- **No light or dark toggle:** the mode is the theme.

**Never:**
- rounded corners, shadows, gradients, glassmorphism or blur
- a third color outside Alarm
- gray text
- text on moving cells without a solid backing
- centered hero
- three equal cards in a row
- a second marquee
- spinners
- custom cursors
- animating amounts the user typed
- scroll-jacking on app pages
- a judge's or person's name in the copy

---

## 12. Brand assets (all generated in code, mode-colored)

- `app/icon.svg`: the favicon, a 32×32 square split into two cells. The left cell is `--t` with a
  `+` cut out; the right cell is `--f` with a `−` in `--t`. It ships in BTC colors and uses
  `prefers-color-scheme` only to keep the outline visible on browser tab bars.
- `app/apple-icon.tsx`: a 180×180 version of the same two cells, made with `ImageResponse`.
- `app/opengraph-image.tsx`: 1200×630. A still field (seeded, so it looks the same every time)
  with the wordmark and the hero headline, colored in the vault's live mode at render time.
- Wallet connector icon (`near-connect`): it points to `/icon.svg`.
- No external logo file is needed. The wordmark is live type.

## 13. Dependencies to add

```bash
npm install gsap@3 lenis@1 --workspace apps/web    # landing only (SplitText ships with gsap 3.13+)
```

Fonts come from `next/font/google`: `Archivo({ subsets: ["latin"], axes: ["wdth"] })` and
`JetBrains_Mono({ subsets: ["latin"] })`. Remove `app/fonts/Geist*` once the swap is done.
