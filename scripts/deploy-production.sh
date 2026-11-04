#!/usr/bin/env bash
# Production release, run BY A PERSON following docs/runbooks/deploy.md.
# Without --confirm it only prints what it would do (dry run). It never runs in CI.
#
# Usage:
#   scripts/deploy-production.sh                  # dry run: checks + migration plan
#   scripts/deploy-production.sh --confirm v1.0.0 # tag must exist on origin/main
#
# Needs: supabase CLI linked to the production project (npx supabase link),
#        vercel CLI linked to the production project, PROD_URL set.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CONFIRM=""
TAG=""
if [[ "${1:-}" == "--confirm" ]]; then CONFIRM=yes; TAG="${2:?--confirm needs the release tag, e.g. v1.0.0}"; fi
: "${PROD_URL:?set PROD_URL, e.g. https://app.scalercrm.com}"

step() { echo; echo "==> $*"; }

step "Working tree"
git fetch -q origin main --tags
if [[ -n "$(git status --porcelain)" ]]; then echo "The working tree has changes. Deploy from a clean checkout." >&2; exit 1; fi
if [[ -n "$CONFIRM" ]]; then
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "Tag $TAG not found." >&2; exit 1; }
  git merge-base --is-ancestor "$TAG" origin/main || { echo "$TAG is not on origin/main." >&2; exit 1; }
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse "$TAG^{commit}")" ]] || { echo "Check out $TAG first." >&2; exit 1; }
fi

step "Checks"
npm ci --silent
npm run check
npm run build

step "Database migrations not yet applied to production"
npx supabase db push --dry-run

if [[ -z "$CONFIRM" ]]; then
  echo
  echo "Dry run finished. Take a backup (scripts/backup.sh), then rerun with --confirm <tag>."
  exit 0
fi

read -r -p "Apply the migrations above to PRODUCTION and deploy $TAG? Type the tag to continue: " answer
[[ "$answer" == "$TAG" ]] || { echo "Cancelled."; exit 1; }

step "Migrating production"
npx supabase db push

step "Deploying the app"
npx vercel deploy --prod

step "Smoke test"
scripts/smoke-test.sh "$PROD_URL"
echo
echo "Released $TAG. Watch Sentry and /api/health for the next hour (docs/runbooks/deploy.md, step 9)."
