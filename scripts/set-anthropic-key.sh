#!/usr/bin/env bash
# Sets VITE_ANTHROPIC_KEY in Vercel production + local .env and redeploys.
# Your Anthropic key lives at https://console.anthropic.com/settings/keys
#
# Usage (from repo root):
#   bash scripts/set-anthropic-key.sh sk-ant-your-key-here

set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then
  echo "Usage: bash scripts/set-anthropic-key.sh <your-anthropic-key>"
  echo ""
  echo "Get your key at https://console.anthropic.com/settings/keys"
  exit 1
fi

cd "$(dirname "$0")/.."

# 1. Add to Vercel production
echo "→ Adding to Vercel production…"
# Remove existing (ignore error if not set), then add fresh
printf "y\n" | npx vercel@latest env rm VITE_ANTHROPIC_KEY production 2>/dev/null || true
printf "%s" "$KEY" | npx vercel@latest env add VITE_ANTHROPIC_KEY production

# 2. Update local .env
echo "→ Updating local .env…"
if grep -q "^VITE_ANTHROPIC_KEY=" .env; then
  # macOS sed uses -i ''
  sed -i '' "s|^VITE_ANTHROPIC_KEY=.*|VITE_ANTHROPIC_KEY=$KEY|" .env
else
  echo "" >> .env
  echo "VITE_ANTHROPIC_KEY=$KEY" >> .env
fi

# 3. Redeploy
echo "→ Redeploying to production…"
npx vercel@latest --prod --yes

echo ""
echo "✓ Done. The key is set in Vercel and local .env."
echo "  AI Report + Cost Projection should now work at https://omega-unified.vercel.app"
