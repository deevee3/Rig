# Product Requirements Document: The Rig ($RIG + $RGG)

- **Document ID:** `PRD-RIG-2026-01`
- **Architecture:** Twin-Contract Genesis (Hardware Index + Execution Gas)
- **Target Network:** Base Mainnet (L2)
- **Status:** Ready for Production Staging

## 1. Executive Summary & Problem Statement

Single-token AI projects do not fail on code. They fail on accounting.

When a protocol forces one token to act as both long-term treasury equity and high-frequency working capital, the chart cannibalizes itself. If autonomous agents sell the token to pay for bandwidth, they bleed the holders. If holders hoard the supply, the agents price themselves out of compute.

At the same time, deploying two tickers (`$RIG` and `$RGG`) from a single developer wallet in the meme coin trenches triggers automated "previous launch" alerts on Rick Bot, Photon, and BullX. Left unexplained, scanners read two contracts as a botched deployment. Framed as a synchronized twin-contract genesis, the exact same on-chain footprint reads as institutional systems engineering.

**The Product Thesis:** Separate the machine from the fuel at Block 0. `$RIG` anchors the bare-metal cluster index and treasury vault. `$RGG` clears high-velocity HTTP 402 (`x402`) machine-to-machine execution gas. One controller. Two primitives. Zero human override.

## 2. Twin-Token Architecture & Economic Specification

The system splits capital storage from transaction velocity across two synchronized Base ERC-20 contracts initialized by the canonical cluster controller.

| Parameter | `$RIG` (The Hardware Index) | `$RGG` (Rig Execution Gas) |
|---|---|---|
| **System Layer** | Capital & Reserve Layer | Throughput & Settlement Layer |
| **Core Utility** | Tracks bare-metal cluster equity and vault reserves | Clears sub-second x402 inference challenges |
| **Velocity Target** | Low-velocity store of value | High-velocity machine medium of exchange |
| **Liquidity Pairing** | Base WETH / USDC primary anchor pool | Base WETH high-turnover execution pool |
| **Value Capture** | Receives net USDC/ETH protocol spread sweeps | Burned and recycled on every agent tool call |
| **Target Buyers** | Conviction holders and treasury indexers | Momentum traders and high-frequency volume |

### The Closed-Loop Value Flow

```text
External Client requests compute
  → Pays HTTP 402 invoice in $RGG
  → Agent burns/recycles $RGG
  → Net spread sweeps in USDC/ETH to $RIG Reserve Vault
```

## 3. Brand, Narrative & Visual Requirements

In the trenches, traders do not read whitepapers. They scan tickers at 100 miles per hour and buy whatever triggers recognition in the first 400 milliseconds.

### 3.1 Subconscious Familiarity Mechanics
- **Entity Handle (`@therigco`):** Borrows immediate lexical equity from $100M+ AI infrastructure runners while using the `"The [Noun] Co"` convention to position a trench launch as an institutional desk.
- **Phonetic Ticker Hook (`$RIG` + `$RGG`):** `$RIG` captures literal category search volume; `$RGG` uses the repeating-consonant visual pattern (X-Y-Y, mirroring `$BZZ` and `$ZZZ`) that stops the scroll on DexScreener feeds.
- **Three-Way Meta-Stacking:** Autonomous local-cluster AI agents → HTTP 402 (`x402`) machine payment rails → native `@base` liquidity settlement.

### 3.2 Visual Design System (Dark-Mode Native)

| UI Role | Color Name | Hex Code | Contrast Ratio | Component Assignment |
|---|---|---|---|---|
| Primary Surface | Obsidian Slate | `#090A0F` | 19.4:1 | Main viewport canvas and X header background |
| Secondary Surface | Carbon Panel | `#12151E` | 15.8:1 | Terminal container, charter card, and CA boxes |
| Capital Accent | Phosphor Mint | `#00F59B` | 11.2:1 | `$RIG` badges, live status indicators, primary CTAs |
| Velocity Accent | Electric Cyan | `#38BDF8` | 10.6:1 | `$RGG` gas badges, x402 log tags, secondary copy CTA |
| Primary Text | Clinical White | `#F3F5F8` | 18.1:1 | Display headers, ticker symbols, live metrics |

- **Typography:** Inter Tight (SemiBold/Bold, `-0.03em` tracking) for headers; Inter (Regular) for prose; JetBrains Mono for contract hashes, timestamps, and live x402 log lines.
- **Legal Guardrail:** Do not claim an off-chain Wyoming or Delaware LLC registration unless the state charter is formally filed and active. Anchor authority strictly in deterministic on-chain execution and public tape auditability.

## 4. Technical & Frontend Requirements

The web application (`therig.co`) is a zero-dependency, single-file `index.html` asset engineered for sub-100ms load times on Cloudflare Pages or Vercel.

- **FR-01 (Dual-Contract Copy Architecture):** Display stacked, color-coded contract boxes above the fold—Phosphor Mint for `$RIG` (Capital Layer) and Electric Cyan for `$RGG` (Throughput Layer)—with independent `navigator.clipboard` copy triggers and DOM selection fallback.
- **FR-02 (Twin-Genesis Specification Panel):** Render an institutional specification card detailing Controller State, Capital Primitive (`$RIG`), Velocity Primitive (`$RGG`), Settlement Rail (`HTTP 402 / x402 v2`), and Human Intervention (`0.00% Air-Gapped`).
- **FR-03 (Live Dual-Primitive Telemetry Terminal):** Stream agent execution logs (`AGENT-01` through `VAULT-01`) with interactive filter tabs (`ALL FLOW`, `$RIG VAULT`, `$RGG GAS`), pause/clear controls, and live treasury and gas counters.
- **FR-04 (Sub-30-Second CA Hot-Swap):** Store both contract addresses in clean, single-line DOM IDs (`#ca-rig` and `#ca-rgg`) so the operator can paste live hashes and redeploy via Git in less than 30 seconds at genesis.

## 5. End-to-End Launch Execution Plan (Reference Operational Checklist)

> Note: Operational items below are preserved from the original PRD for reference; see `docs/PRD_REVIEW.md` for engineering, protocol, and compliance remediations applied in this codebase.

- **Phase 1: Pre-Flight Staging (T-Minus 3 Hours):** Web shell (`index.html`), social identity (`@therigco`, 1:1 isometric cube avatar, 1500x500 header banner, bio).
- **Phase 2: Contract Synchronization (T-Minus 15 Minutes):** Verify twin contracts, clean controller deployment.
- **Phase 3: Atomic Migration & Fast-Track Indexing (T-Plus 0 to 5 Minutes):** Hot-swap `#ca-rig` and `#ca-rgg`, update DexScreener profiles (`01 // $RIG HARDWARE INDEX`, `02 // $RGG EXECUTION GAS`).
- **Phase 4: Post-Migration Telemetry & Treasury Routing:** Publish transparent on-chain receipts linking `$RGG` x402 activity to `$RIG` reserve sweeps.

## 6. Operational KPIs & Audit Gates

- **Pre-Launch Gate:** Web, DNS, and X visual assets staged prior to Block 0.
- **Scanner Audit Gate:** LP tokens 100% burned upon migration; contract taxes locked at `0% / 0%`.
- **Legal Guardrail:** Zero unfiled state-charter claims; all legitimacy anchored in deterministic code and BaseScan audit trails.
