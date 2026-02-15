#!/usr/bin/env bash
set -euo pipefail

INSTANCE_ID="${1:-${LOCAL_INSTANCE_ID:-}}"
if [ -z "${INSTANCE_ID}" ]; then
  echo "Usage: $0 <LOCAL_INSTANCE_ID>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOSTED_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${HOSTED_DIR}/.." && pwd)"
CONTAINER_NAME="${LOCAL_GATEWAY_CONTAINER:-openclaw-local-gateway}"
WEB_LOG_FILE="${HOSTED_DIR}/.tmp/local-web.log"

export OPENCLAW_CACHE_TRACE="${OPENCLAW_CACHE_TRACE:-1}"
export OPENCLAW_CACHE_TRACE_MESSAGES="${OPENCLAW_CACHE_TRACE_MESSAGES:-1}"
export OPENCLAW_CACHE_TRACE_PROMPT="${OPENCLAW_CACHE_TRACE_PROMPT:-1}"
export OPENCLAW_CACHE_TRACE_SYSTEM="${OPENCLAW_CACHE_TRACE_SYSTEM:-1}"
export OPENCLAW_ANTHROPIC_PAYLOAD_LOG="${OPENCLAW_ANTHROPIC_PAYLOAD_LOG:-1}"

echo "Starting local stack for instance: ${INSTANCE_ID}"
make -C "${HOSTED_DIR}" local-up LOCAL_INSTANCE_ID="${INSTANCE_ID}"

echo "Ensuring debug log files exist in container..."
docker exec "${CONTAINER_NAME}" sh -lc \
  'mkdir -p /tmp/.openclaw/logs && touch /tmp/.openclaw/logs/cache-trace.jsonl /tmp/.openclaw/logs/anthropic-payload.jsonl'

mkdir -p "$(dirname "${WEB_LOG_FILE}")"
touch "${WEB_LOG_FILE}"

cleanup() {
  jobs -p | xargs -r kill >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Tailing logs (Ctrl+C to stop tails; stack remains running):"
echo "  - gateway stdout"
echo "  - web app log"
echo "  - cache-trace + anthropic-payload JSONL"

(
  docker logs -f "${CONTAINER_NAME}" 2>&1 | sed 's/^/[gateway] /'
) &

(
  tail -n 40 -f "${WEB_LOG_FILE}" 2>&1 | sed 's/^/[web] /'
) &

(
  docker exec "${CONTAINER_NAME}" sh -lc \
    'tail -n 40 -f /tmp/.openclaw/logs/cache-trace.jsonl /tmp/.openclaw/logs/anthropic-payload.jsonl' \
    2>&1 | sed 's/^/[debug] /'
) &

wait

echo ""
echo "Tip: run 'make -C ${HOSTED_DIR} local-down' when you want to stop the stack."
echo "Repo root: ${ROOT_DIR}"
