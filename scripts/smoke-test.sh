#!/usr/bin/env bash
# Read-only checks against a deployed SCALER. Safe to run against production:
# it creates nothing, and the API check uses a deliberately invalid key.
# Usage: scripts/smoke-test.sh https://app.example.com
set -uo pipefail

BASE="${1:?base URL, e.g. https://app.scalercrm.com}"
fail=0
check() { # name, expected status, curl args…
  local name="$1" want="$2"; shift 2
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@")
  if [[ "$got" == "$want" ]]; then echo "ok   $name ($got)"; else echo "FAIL $name: expected $want, got $got"; fail=1; fi
}
header() { # name, header regex, url
  if curl -sI --max-time 15 "$3" | grep -qiE "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

check "login page" 200 "$BASE/login"
check "app redirects when signed out" 307 "$BASE/dashboard"
check "health (database and jobs)" 200 "$BASE/api/health"
check "manifest" 200 "$BASE/manifest.webmanifest"
check "service worker" 200 "$BASE/sw.js"
check "offline page" 200 "$BASE/offline"
check "lead API refuses a bad key" 401 -X POST -H 'authorization: Bearer sk_smoke_invalid' -H 'content-type: application/json' -d '{"phone":"+910000000000"}' "$BASE/api/v1/leads"
check "job route refuses without the secret" 401 "$BASE/api/cron/tasks"
check "WhatsApp webhook refuses a wrong verify token" 403 "$BASE/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"
header "HSTS" "strict-transport-security: max-age" "$BASE/login"
header "no framing" "x-frame-options: DENY" "$BASE/login"
if curl -sI --max-time 15 "$BASE/login" | grep -qi '^x-powered-by'; then echo "FAIL X-Powered-By is sent"; fail=1; else echo "ok   no X-Powered-By"; fi

exit $fail
