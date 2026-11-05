#!/usr/bin/env bash
# Sprint 16 acceptance: two tenants on different custom domains in ONE deployment.
# Builds the app, serves it against a stand-in for Supabase's API that knows two
# active domains (scripts/white-label/mock-supabase.cjs), then checks over HTTP that:
#   - each domain's manifest installs as that tenant's app (name, icon);
#   - each sign-in page shows only its own brand, and no SCALER sign-up;
#   - no cookie is scoped beyond its host (no Domain attribute).
# The database side (RLS, plan gating, brand_for_host) is supabase/tests/988_white_label.sql.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3200}"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder

cd "$ROOT"
[[ "${SKIP_BUILD:-}" == 1 ]] || npm run build >/dev/null
node scripts/white-label/mock-supabase.cjs >/dev/null 2>&1 & MOCK=$!
npx next start -p "$PORT" >/dev/null 2>&1 & APP=$!
trap 'kill $MOCK $APP 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/api/health" && break; sleep 1; done

fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok - $1"; else echo "FAIL - $1 (got '$2', wanted '$3')"; fail=1; fi; }
manifest() { curl -s -H "Host: $1" "http://localhost:$PORT/manifest.webmanifest" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log(m.name+'|'+m.icons[0].src)})"; }
login() { curl -s -H "Host: $1" "http://localhost:$PORT/login"; }

check "alpha installs as Alpha CRM with its icon" "$(manifest crm.alpha.test)" "Alpha CRM|/brand/icon?v=aaaa1111bbbb"
check "beta installs as Beta Desk" "$(manifest desk.beta.test)" "Beta Desk|/icons/icon-192.png"
check "SCALER's own host stays SCALER" "$(manifest localhost:$PORT)" "SCALER CRM|/icons/icon-192.png"
check "alpha's sign-in shows no beta brand" "$(login crm.alpha.test | grep -c 'Beta Desk' || true)" "0"
check "beta's sign-in shows no alpha brand" "$(login desk.beta.test | grep -c 'Alpha CRM' || true)" "0"
check "alpha's sign-in shows its brand" "$(login crm.alpha.test | grep -c 'Welcome to Alpha' || true)" "1"
check "no SCALER sign-up on a tenant domain" "$(login crm.alpha.test | grep -c 'New to SCALER' || true)" "0"
check "alpha hides Powered by SCALER (plan allows)" "$(login crm.alpha.test | grep -c 'Powered by SCALER' || true)" "0"
check "beta shows Powered by SCALER" "$(login desk.beta.test | grep -c 'Powered by SCALER' || true)" "1"
check "alpha's icon is served on alpha's domain" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' -H 'Host: crm.alpha.test' "http://localhost:$PORT/brand/icon?v=aaaa1111bbbb")" "200 image/png"
for h in crm.alpha.test desk.beta.test; do
  check "no cookie on $h is scoped beyond its host" "$(curl -s -D - -o /dev/null -H "Host: $h" "http://localhost:$PORT/login" | grep -ci 'set-cookie:.*domain=' || true)" "0"
done
exit $fail
