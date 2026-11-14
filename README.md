# The Rig (`$RIG` + `$RGG`)

Twin-Contract Genesis on Base (`eip155:8453`):
- **`$RIG` (Hardware Index / Reserve Layer):** `0xbfefd4d88899830d756b2678944770a792315ba3`
- **`$RGG` (Execution Gas / x402 Throughput Layer):** `0x36376c7058894685507eca5112d04cfb2547cba3`

---

## Repository Layout

- `index.html` — Zero-dependency single-file `therig.co` web shell (`FR-01` through `FR-04`), wired to live SSE backend telemetry with automatic Base JSON-RPC fallback.
- `backend/` — TypeScript HTTP 402 (`x402 v2`) compute gateway + Base RPC live event indexer & SSE server.
- `contracts/` — Foundry Solidity suite (`RigController`, `RigIndexToken`, `RigGasToken`, `RigReserveVault`, `RigX402Router`) supporting both fresh genesis and binding to pre-deployed `$RIG`/`$RGG` contracts.
- `assets/` — Brand visuals (`avatar-1024x1024.png`, `x-header-1500x500.png`, `dexscreener-rig-1500x500.png`, `dexscreener-rgg-1500x500.png`) + deterministic `render_assets.py`.
- `docs/` — Canonical `PRD.md` and `PRD_REVIEW.md` (technical audit, x402 v2 protocol alignment, and compliance guardrails).

---

## Quick Start

### 1. Run Smart Contract Tests (Foundry)
```bash
cd contracts
forge test -vvv
```

### 2. Run Backend & End-to-End Local Anvil Integration Test
```bash
cd backend
npm install
npm test
```

### 3. Start Live Backend Connected to Base Mainnet
```bash
cd backend
cp .env.example .env
# Optional: set BASE_RPC_URL to a dedicated Alchemy/QuickNode Base endpoint
# Optional: set RIG_CONTROLLER_ADDRESS, RIG_VAULT_ADDRESS, RIG_X402_ROUTER_ADDRESS after binding
npm run build && npm start
```
Then open `http://127.0.0.1:8787/` — the backend serves `index.html` alongside `/api/telemetry/snapshot`, `/api/telemetry/stream`, `/v1/x402/terms`, and `POST /v1/agent/execute`.

### 4. Sub-30-Second CA Hot-Swap (`index.html`)
Edit `#ca-rig` and `#ca-rgg` in `index.html` (lines 706 and 720) or pass `?api=https://api.therig.co` / edit `RIG_CONFIG` at the top of `<script>`. All BaseScan, DexScreener, short hashes, and RPC queries derive dynamically from those single-line DOM IDs.

### 5. Local Hosting + Cloudflare Pages & Existing Tunnel
See [`deploy/HOSTING.md`](deploy/HOSTING.md) for wiring your local `127.0.0.1:8787` backend (`docker compose up -d --build`) to Cloudflare:
- **Cloudflare Pages Frontend + Existing Tunnel API (Recommended):** Point a Public Hostname on your existing Cloudflare Tunnel (e.g. `api.therig.co`) to local `:8787`, then deploy `dist-pages/` via `./deploy/cloudflare-pages.sh --api https://api.therig.co --deploy`.
- **Single-Origin Existing Tunnel:** Route your domain directly on your existing Cloudflare Tunnel to local `:8787` (`backend/src/server.ts` serves `index.html`, `/assets/*.png`, `/api/*`, and `/v1/*`).

### 6. Deploy Canonical Vault + x402 Router Bound to Live `...ba3` Tokens
```bash
cd contracts
EXISTING_RIG_TOKEN=0xbfefd4d88899830d756b2678944770a792315ba3 \
EXISTING_RGG_TOKEN=0x36376c7058894685507eca5112d04cfb2547cba3 \
DEPLOYER_PRIVATE_KEY=0x... \
forge script script/DeployTwinGenesis.s.sol:DeployTwinGenesis --rpc-url "$BASE_RPC_URL" --broadcast
```
