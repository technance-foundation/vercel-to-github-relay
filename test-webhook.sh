#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------
# test-webhook.sh -- Simulate Vercel deployment.succeeded webhooks
# --------------------------------------
# Usage:
#   ./test-webhook.sh <deployment-name> <preview-url> [branch] [project-id]
#
# Example:
#   ./test-webhook.sh midnight https://midnight-git-main-abc123.vercel.app main prj_jWLGA9cpGatUCCf4kVLC5V44kuDt
#
# Defaults:
#   branch = "main"
#   project-id = "local-project"
#
# ENV overrides:
#   VERCEL_WEBHOOK_SECRET
#   WEBHOOK_ENDPOINT
# --------------------------------------

DEPLOYMENT_NAME="${1:-}"
URL="${2:-}"
BRANCH="${3:-main}"
PROJECT_ID="${4:-local-project}"

if [ -z "$DEPLOYMENT_NAME" ] || [ -z "$URL" ]; then
    echo "Usage: $0 <deployment-name> <preview-url> [branch] [project-id]"
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
      "name": "$DEPLOYMENT_NAME",
      "meta": {
        "branch": "$BRANCH"
      }
    },
    "target": "staging",
    "project": {
      "id": "$PROJECT_ID"
    }
  }
}
EOF
)

# Compute HMAC SHA1 signature
SIGNATURE=$(printf "%s" "$BODY" | openssl dgst -sha1 -hmac "$SECRET" | sed 's/^.* //')

echo "Sending webhook"
echo "  Endpoint:        $WEBHOOK_ENDPOINT"
echo "  Deployment Name: $DEPLOYMENT_NAME"
echo "  URL:             $URL"
echo "  Branch:          $BRANCH"
echo "  Project ID:      $PROJECT_ID"
echo "---"

curl -X POST "$WEBHOOK_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-vercel-signature: $SIGNATURE" \
  --data "$BODY"

echo
echo "Done"