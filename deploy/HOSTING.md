# Local Hosting + Cloudflare Frontend Guide

This repository runs the backend (`x402 v2` compute gateway, Base RPC telemetry indexer, SSE stream, and `/` web shell) **locally on this machine** bound to `127.0.0.1:8787`, while exposing the frontend through Cloudflare using either of two architectures.

---

## 1. Local Hosting on This Machine

### Option 1A: Docker Compose (Recommended)
1. Configure local environment (defaults already point to Base Mainnet + live `$RIG`/`$RGG` contracts):
   ```bash
   cp -n backend/.env.example backend/.env
   ```
2. Build and start the local container (`therig-app`, bound strictly to `127.0.0.1:8787`):
   ```bash
   docker compose up -d --build therig-app
   ```
3. Verify local health and telemetry:
   ```bash
   curl -s http://127.0.0.1:8787/api/health
   curl -s http://127.0.0.1:8787/api/telemetry/snapshot | head -c 300
   ```

### Option 1B: Bare-Metal Node + `systemd --user`
1. Build TypeScript output and verify `.env`:
   ```bash
   cp -n backend/.env.example backend/.env
   cd backend && npm ci && npm run build
   ```
2. Install and enable the user service unit:
   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/systemd/therig.service ~/.config/systemd/user/therig.service
   systemctl --user daemon-reload
   systemctl --user enable --now therig.service
   systemctl --user status therig.service
   ```

---

## 2. Exposing Through Your Existing Cloudflare Tunnel & Cloudflare Pages

> **Note:** `backend/src/server.ts` already sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` on `/api/telemetry/stream` with 15-second keepalives for Cloudflare proxy/SSE compatibility.

If your existing `cloudflared` runs with host networking (or directly on Linux), route your Cloudflare Tunnel **Service URL** to:
- `http://127.0.0.1:8787`

If your existing `cloudflared` or reverse proxy runs inside a **Docker bridge network** instead of host networking, either set `THERIG_BIND_IP` (e.g., to your Docker bridge IP `172.17.0.1`) so `http://host.docker.internal:8787` reaches it, or attach `therig-app` to that proxy network in `docker-compose.yml` and point the tunnel at `http://therig-app:8787`.

### Pattern A (Recommended): Cloudflare Pages Frontend + Existing Tunnel API (`api.<domain>`)
Host static files (`index.html`, `assets/*.png`, `_headers`) on Cloudflare Pages while streaming live SSE telemetry and `x402` calls from your local machine via your existing Cloudflare Tunnel (e.g., `https://api.therig.co`).

1. In your existing tunnel's **Cloudflare Zero Trust Dashboard** (`Networks -> Tunnels -> Public Hostname`), add `api.therig.co` -> `HTTP` -> `http://127.0.0.1:8787` (or `http://therig-app:8787` if attached on the same Docker network).
2. Restrict CORS in `backend/.env` once your domain is live (defaults to `CORS_ORIGIN=*` during setup):
   ```dotenv
   CORS_ORIGIN=https://therig.co
   ```
3. Build static Cloudflare Pages artifacts into `dist-pages/` (excluding `backend/`, `contracts/`, and `.env`):
   ```bash
   ./deploy/cloudflare-pages.sh --api https://api.therig.co --build-only
   ```
4. Authenticate Wrangler once (`npx wrangler login`) or export `CLOUDFLARE_API_TOKEN`, then deploy to Cloudflare Pages (`wrangler.toml` already sets `pages_build_output_dir = "dist-pages"`):
   ```bash
   ./deploy/cloudflare-pages.sh --api https://api.therig.co --deploy
   ```
   Or deploy a static-only fallback build (`https://mainnet.base.org` direct browser RPC fallback when no API URL is configured):
   ```bash
   ./deploy/cloudflare-pages.sh --deploy
   ```

### Pattern B: Single-Origin Through Existing Tunnel (No Cloudflare Pages Upload)
If you prefer serving both UI and API straight from your local `therig-app` container without Wrangler:
1. In your existing tunnel's **Cloudflare Zero Trust Dashboard**, add `therig.co` -> `HTTP` -> `http://127.0.0.1:8787`.
2. `backend/src/server.ts` serves `index.html` (`/`), `/assets/*.png`, `/api/telemetry/snapshot`, `/api/telemetry/stream`, `/v1/x402/terms`, and `/v1/agent/execute` directly from this machine.
