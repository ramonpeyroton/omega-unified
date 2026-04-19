#!/usr/bin/env bash
# One-shot script to push this repo to GitHub and link it to Vercel for
# automatic deploys on every push.
#
# Requirements: macOS with Homebrew (or manual gh install).
# Run from the repo root: bash scripts/setup-github.sh

set -euo pipefail

REPO_NAME="${REPO_NAME:-omega-unified}"
VISIBILITY="${VISIBILITY:-private}"   # private | public

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Omega Unified → GitHub setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Install GitHub CLI if missing
if ! command -v gh >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Installing Homebrew first…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for this session (Apple Silicon + Intel)
    if [ -d /opt/homebrew/bin ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -d /usr/local/bin/brew ];  then eval "$(/usr/local/bin/brew shellenv)"; fi
  fi
  echo "Installing GitHub CLI…"
  brew install gh
fi

# 2. Auth (opens browser)
if ! gh auth status >/dev/null 2>&1; then
  echo "Logging in to GitHub (your browser will open)…"
  gh auth login --web --git-protocol https
fi

# 3. Create remote + push
cd "$(dirname "$0")/.."

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Creating $VISIBILITY repo '$REPO_NAME' on GitHub…"
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --remote=origin --push
else
  echo "Remote 'origin' already configured:"
  git remote get-url origin
  echo "Pushing latest commits…"
  git push -u origin main 2>/dev/null || git push origin "$(git branch --show-current)"
fi

echo ""
echo "✓ Done. Next step: link to Vercel"
echo "  1. Open https://vercel.com/tioramos-8681s-projects/omega-unified/settings/git"
echo "  2. Click 'Connect Git Repository'"
echo "  3. Select the '$REPO_NAME' repo you just created"
echo ""
echo "From then on, every 'git push' auto-deploys."
