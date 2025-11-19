#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------
# test-webhook.sh — Simulate Vercel Webhooks
# --------------------------------------
# Usage:
#   ./test-webhook.sh <project> <preview-url> [branch]
#
# Example:
#   ./test-webhook.sh dashboard https://dash-abc123.vercel.app main
#
# Defaults:
#   branch = "main"
#
# ENV overrides:
#   VERCEL_WEBHOOK_SECRET
#   WEBHOOK_ENDPOINT
# --------------------------------------

PROJECT="${1:-}"
URL="${2:-}"
BRANCH="${3:-main}"

if [ -z "$PROJECT" ] || [ -z "$URL" ]; then
    echo "Usage: $0 <project-name> <preview-url> [branch]"
    exit 1
fi

# Secret used by the server to verify incoming webhooks
SECRET="${VERCEL_WEBHOOK_SECRET:-your-secret-here}"

# Your deployed API URL
WEBHOOK_ENDPOINT="${WEBHOOK_ENDPOINT:-https://your-vercel-app.vercel.app/api/vercel-to-github-success-deployment}"

# JSON payload
BODY=$(cat <<EOF
{
  "type": "deployment.succeeded",
  "id": "local-test-$(date +%s)",
  "createdAt": $(date +%s000),
  "payload": {
    "deployment": {
      "id": "local-dep-123",
      "url": "$URL",
      "name": "$PROJECT",
      "meta": {
        "branch": "$BRANCH"
      }
    },
    "target": "staging",
    "project": { "id": "local-project" }
  }
}
EOF
)

# Compute HMAC SHA1 signature
SIGNATURE=$(printf "%s" "$BODY" | openssl dgst -sha1 -hmac "$SECRET" | sed 's/^.* //')

echo "➡️  Sending webhook"
echo "   Endpoint: $WEBHOOK_ENDPOINT"
echo "   Project:  $PROJECT"
echo "   URL:      $URL"
echo "   Branch:   $BRANCH"
echo "---"

curl -X POST "$WEBHOOK_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-vercel-signature: $SIGNATURE" \
  --data "$BODY"

echo
echo "✔️  Done"