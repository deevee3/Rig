#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/dist-pages"
PROJECT_NAME="${CF_PAGES_PROJECT:-therig}"
API_URL="${RIG_API_URL:-}"
DO_DEPLOY=0

usage() {
  cat <<'EOF'
Usage: deploy/cloudflare-pages.sh [OPTIONS]

Builds a clean static bundle in dist-pages/ for Cloudflare Pages and optionally
deploys it using Wrangler.

Options:
  --api <url>      Inject fallbackApiUrl into dist-pages/index.html (e.g. https://api.therig.co)
  --project <name> Cloudflare Pages project name (default: CF_PAGES_PROJECT or 'therig')
  --build-only     Build dist-pages/ without running wrangler deploy (default)
  --deploy         Deploy dist-pages/ to Cloudflare Pages via npx wrangler
  -h, --help       Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)
      [[ $# -ge 2 ]] || { echo "Error: --api requires a URL argument" >&2; exit 1; }
      API_URL="$2"
      shift 2
      ;;
    --project)
      [[ $# -ge 2 ]] || { echo "Error: --project requires a project name argument" >&2; exit 1; }
      PROJECT_NAME="$2"
      shift 2
      ;;
    --build-only)
      DO_DEPLOY=0
      shift
      ;;
    --deploy)
      DO_DEPLOY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}/assets"

cp "${ROOT_DIR}/index.html" "${OUT_DIR}/index.html"
cp "${ROOT_DIR}/assets/"*.png "${OUT_DIR}/assets/"

if [[ -n "${API_URL}" ]]; then
  CLEAN_API_URL="${API_URL%/}"
  node - "${OUT_DIR}/index.html" "${CLEAN_API_URL}" <<'EOF'
const fs = require('node:fs');
const [indexPath, apiUrl] = process.argv.slice(2);
const html = fs.readFileSync(indexPath, 'utf8');
const target = "fallbackApiUrl: urlParams.get('fallbackApi') ?? '',";
if (!html.includes(target)) {
  console.error('Failed to locate fallbackApiUrl marker in index.html');
  process.exit(1);
}
const escaped = apiUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const next = html.replace(
  target,
  `fallbackApiUrl: urlParams.get('fallbackApi') ?? '${escaped}',`
);
fs.writeFileSync(indexPath, next, 'utf8');
EOF
fi

cat > "${OUT_DIR}/_headers" <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY

/index.html
  Cache-Control: public, max-age=60, must-revalidate

/assets/*
  Cache-Control: public, max-age=3600
EOF

echo "Built Cloudflare Pages artifact at: ${OUT_DIR}"
ls -lh "${OUT_DIR}" "${OUT_DIR}/assets"

if [[ "${DO_DEPLOY}" -eq 1 ]]; then
  WHOAMI_OUT="$(npx --yes wrangler whoami 2>&1 || true)"
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && grep -qi "not authenticated" <<<"${WHOAMI_OUT}"; then
    echo "Error: Wrangler is not authenticated. Run 'npx wrangler login' or export CLOUDFLARE_API_TOKEN." >&2
    exit 1
  fi
  if ! npx --yes wrangler pages project list 2>/dev/null | grep -qE "(^|[[:space:]│|])${PROJECT_NAME}([[:space:]│|]|$)"; then
    echo "Creating Cloudflare Pages project '${PROJECT_NAME}'..."
    npx --yes wrangler pages project create "${PROJECT_NAME}" --production-branch="${CF_PAGES_BRANCH:-main}"
  fi
  echo "Deploying ${OUT_DIR} to Cloudflare Pages project '${PROJECT_NAME}'..."
  npx --yes wrangler pages deploy "${OUT_DIR}" --project-name "${PROJECT_NAME}"
fi
