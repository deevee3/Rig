# PRD Audit & Architecture Review (`PRD-RIG-2026-01`)

This document captures technical gaps, architectural improvements, and compliance risks identified during review of `PRD-RIG-2026-01`, together with the concrete engineering solutions implemented across `contracts/`, `backend/`, `index.html`, and `assets/`.

---

## 1. Compliance & Market-Integrity Risks (Mandatory Exclusions)

| PRD Section | Identified Risk | Engineering Remediation |
|---|---|---|
| **Section 5 (Phase 1) & Section 6** | Funding 25–40 wallets via staggered CEX withdrawals specifically to evade Bubblemaps cluster alerts masks beneficial insider supply. | **Excluded.** Zero wallet-dispersion, Sybil-masking, or cluster-evasion tooling is built in this repo. |
| **Section 5 (Phase 4) & Section 7** | Running automated micro-buy/sell loops across self-owned wallets to inflate 5-minute transaction counts and scaling out into green candles constitutes wash trading / market manipulation. | **Excluded.** Zero volume-cycling, self-trading, or MEV bundling scripts are built in this repo. |
| **Section 4 (FR-03) vs. Section 3.2** | Streaming *simulated* logs and fabricated incrementing counters on `therig.co` while claiming *"live telemetry"* and *"we keep receipts"* contradicts *"Anchor authority strictly in deterministic on-chain execution and public tape auditability."* | **Fixed.** The UI streams only **authentic Base RPC + x402 v2 settlement receipts** via `backend/` (with direct Base `eth_call` fallback). Before live addresses are configured, it shows `AWAITING GENESIS` rather than fake metrics; test deployments display explicit `BASE SEPOLIA` or `LOCAL ANVIL` badges. |
| **Section 3.2 & Section 6** | Claiming an unfiled Wyoming or Delaware LLC creates regulatory exposure. | **Enforced.** Zero state-charter/LLC claims appear in copy, metadata, API payloads, or brand banners. |

---

## 2. Technical & Protocol Gaps

### Gap 1: Missing Smart Contract Specifications & `0% / 0%` Tax Compatibility
- **Issue:** The PRD asserts `0% / 0%` ERC-20 transfer taxes alongside *"burned and recycled on every agent tool call"*, *"net spread sweeps in USDC/ETH to $RIG Reserve Vault"*, and *"0.00% Air-Gapped"* zero human override, without specifying contract interfaces.
- **Resolution:**
  - `RigIndexToken` (`$RIG`) and `RigGasToken` (`$RGG`) are clean **0% buy / 0% sell** ERC-20 contracts with fixed genesis supply and zero post-genesis minting or blacklist/pause backdoors.
  - All economic routing happens transparently at settlement time inside **`RigX402Router`**, which splits each paid x402 invoice deterministically (`burnBps`, `recycleBps`, `vaultBps`) and sweeps reserve allocations into the non-custodial **`RigReserveVault`**.
  - **`RigController`** anchors canonical twin-genesis provenance on-chain (`rigToken`, `rggToken`, `vault`, `router`, `genesisSealed = true`, `humanOverrideBps = 0`).

### Gap 2: HTTP 402 / `x402 v2` Protocol Alignment on Base (`eip155:8453`)
- **Issue:** The PRD mandates `HTTP 402 / x402 v2` invoices paid in `$RGG`, but generic ERC-20 contracts do not support gasless signed authorizations (`PAYMENT-SIGNATURE` header).
- **Resolution:**
  - `RigGasToken` (`$RGG`) natively implements **EIP-2612 (`permit`)** and **EIP-3009 (`transferWithAuthorization` / `receiveWithAuthorization`)**.
  - `backend/` implements spec-compliant **x402 v2** HTTP headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE` containing Base64-encoded JSON with CAIP-2 `eip155:8453` / `eip155:84532` / `eip155:31337` identifiers).
  - `RigX402Router` also provides a `settleWithAllowance(...)` / USDC rail path so the backend and frontend remain compatible if you supply pre-deployed ERC-20 tokens on Base that lack EIP-3009.

### Gap 3: Browser RPC Throttling vs. Sub-100ms Single-File `index.html`
- **Issue:** Direct `eth_getLogs` polling from every visitor's browser hits Base public RPC `429` limits and causes slow cold loads; synchronous Google Fonts links block initial paint.
- **Resolution:**
  - `index.html` remains a **zero-dependency single HTML file** with inline critical CSS/JS, instant system sans/mono fallbacks, and asynchronous non-blocking Google Fonts loading.
  - `backend/` acts as a single server-side Base RPC indexer caching state and streaming verified receipts over **SSE (`/api/telemetry/stream`)**.
  - When `apiBaseUrl` is empty or unavailable (pure static edge deploy), `index.html` automatically falls back to lightweight read-only `eth_call` queries (`totalSupply`, `balanceOf(dead)`, `balanceOf(vault)`) against the configured Base RPC.

### Gap 4: Verifiable Zero-Override State
- **Issue:** Static marketing badges claiming `"0.00% Air-Gapped"` cannot be audited independently.
- **Resolution:** `RigReserveVault` contains zero arbitrary owner withdrawal functions, `RigController` exposes immutable wiring + `genesisSealed()`, and `backend/` + `index.html` compute live controller/vault verification fields directly from chain state with clickable BaseScan links.
