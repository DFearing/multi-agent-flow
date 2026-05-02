#!/bin/bash
# Scheduled rerun of the full benchmark matrix.
# Invoked by a systemd-run user unit (see bench/README.md "Scheduled reruns").
# Appends new rows to runs.jsonl, then writes the updated summary.
set -u
cd "$(dirname "$0")"

LOG="results/scheduled-rerun-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "=== scheduled rerun starting $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee "$LOG"

# Each (stack, sim-count) tuple is run if the stack's app.js exists.
# Order: light cells first (sim-count=1, then 3) so partial results are useful.
PAIRS=(
  "A-base 1"
  "C-pr1  1"
  "A-base 3"
  "C-pr1  3"
  "D-pr31 3"
)

for pair in "${PAIRS[@]}"; do
  read -r stack count <<<"$pair"
  case "$stack" in
    A-base)  app="../../baseline-tree/app/dist/app.js" ;;
    B-preperf) app="../../preperf-tree/app/dist/app.js" ;;
    C-pr1)   app="../../pr1-tree/app/dist/app.js" ;;
    D-pr31)  app="../../pr31-tree/app/dist/app.js" ;;
    *) echo "unknown stack: $stack" | tee -a "$LOG"; continue ;;
  esac
  if [ ! -f "$app" ]; then
    echo "[skip] $stack sim-count=$count — $app missing" | tee -a "$LOG"
    continue
  fi
  echo "[run]  $stack sim-count=$count" | tee -a "$LOG"
  if ! node run-bench.mjs --append --stack "$stack" --sim-count "$count" >>"$LOG" 2>&1; then
    echo "[fail] $stack sim-count=$count — see $LOG" | tee -a "$LOG"
  fi
done

echo "=== scheduled rerun finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
