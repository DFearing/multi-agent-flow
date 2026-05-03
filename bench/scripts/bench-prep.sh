#!/usr/bin/env bash
# bench-prep.sh — CPU governor + system-state helper for stable benchmarks.
#
# Reports current system state (CPU model, governor, frequency, load, memory).
# Optionally switches the CPU governor to 'performance' for stable results,
# and restores it afterward.
#
# Usage:
#   ./bench/scripts/bench-prep.sh                   # report current state
#   ./bench/scripts/bench-prep.sh --set-performance  # switch to performance governor
#   ./bench/scripts/bench-prep.sh --restore          # restore prior governor
#
# The --set-performance step requires sudo and is entirely optional.
# The benchmark works fine without it — this just reduces variance.

set -euo pipefail

PRIOR_GOVERNOR_FILE="/tmp/bench-prep-prior-governor"

# ─── Helpers ──────────────────────────────────────────────────────────────

print_header() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  bench-prep: system state"
  echo "═══════════════════════════════════════════════════════════"
}

report_state() {
  local cpu_model governor freq_range load_avg free_mem

  cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | sed 's/.*: //' || echo "unknown")

  if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
    governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor)
  else
    governor="unknown (cpufreq not available)"
  fi

  if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq ] && \
     [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq ]; then
    local min_khz max_khz
    min_khz=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_min_freq)
    max_khz=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq)
    freq_range="$((min_khz / 1000))–$((max_khz / 1000)) MHz"
  else
    freq_range="unknown"
  fi

  load_avg=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo "unknown")
  free_mem=$(free -m 2>/dev/null | awk '/^Mem:/ {print $4 " MB"}' || echo "unknown")

  echo ""
  echo "  CPU model:     ${cpu_model}"
  echo "  Governor:      ${governor}"
  echo "  Freq range:    ${freq_range}"
  echo "  Load average:  ${load_avg}"
  echo "  Free memory:   ${free_mem}"
  echo ""
}

set_governor() {
  local target="$1"

  # Try cpupower first
  if command -v cpupower &>/dev/null; then
    echo "  Using cpupower to set governor to '${target}'..."
    if sudo cpupower frequency-set -g "${target}" 2>/dev/null; then
      echo "  Done (via cpupower)."
      return 0
    else
      echo "  cpupower failed, trying sysfs fallback..."
    fi
  fi

  # Fallback: direct sysfs write
  local cpu_dirs
  cpu_dirs=$(ls -d /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor 2>/dev/null || true)
  if [ -z "${cpu_dirs}" ]; then
    echo "  WARNING: No cpufreq sysfs interface found. Skipping governor change."
    echo "  The benchmark will still run, but results may have higher variance."
    return 0
  fi

  echo "  Writing '${target}' to sysfs scaling_governor for all CPUs..."
  local success=true
  for gov_file in ${cpu_dirs}; do
    if ! echo "${target}" | sudo tee "${gov_file}" >/dev/null 2>&1; then
      echo "  WARNING: Failed to write to ${gov_file}"
      success=false
    fi
  done

  if [ "${success}" = true ]; then
    echo "  Done (via sysfs)."
  else
    echo "  WARNING: Some CPUs could not be set. Continuing anyway."
  fi
}

read_current_governor() {
  if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
    cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
  else
    echo ""
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────

action="${1:-report}"

case "${action}" in
  --set-performance)
    print_header

    # Save current governor before changing
    current=$(read_current_governor)
    if [ -z "${current}" ]; then
      echo "  WARNING: Cannot read current governor. cpufreq may not be available."
      echo "  Skipping governor change. The benchmark will still run."
      report_state
      exit 0
    fi

    echo "  Current governor: ${current}"
    echo "  Saving to ${PRIOR_GOVERNOR_FILE}..."
    echo "${current}" > "${PRIOR_GOVERNOR_FILE}"

    if [ "${current}" = "performance" ]; then
      echo "  Already set to 'performance'. Nothing to do."
    else
      echo ""
      echo "  Switching governor to 'performance'..."
      echo "  (This requires sudo. If prompted, enter your password.)"
      echo ""
      set_governor "performance"
    fi

    echo ""
    echo "  State after change:"
    report_state

    echo "  To restore: ./bench/scripts/bench-prep.sh --restore"
    echo ""
    ;;

  --restore)
    print_header

    if [ ! -f "${PRIOR_GOVERNOR_FILE}" ]; then
      echo "  No prior governor saved (${PRIOR_GOVERNOR_FILE} not found)."
      echo "  Nothing to restore. Current state:"
      report_state
      exit 0
    fi

    prior=$(cat "${PRIOR_GOVERNOR_FILE}")
    echo "  Restoring governor to '${prior}' (saved by --set-performance)..."
    set_governor "${prior}"
    rm -f "${PRIOR_GOVERNOR_FILE}"

    echo ""
    echo "  State after restore:"
    report_state
    ;;

  report|*)
    print_header
    report_state

    echo "  For more stable benchmark results, consider:"
    echo "    ./bench/scripts/bench-prep.sh --set-performance   # before bench"
    echo "    node bench/profile-long-tasks.mjs --reps=5        # run bench"
    echo "    ./bench/scripts/bench-prep.sh --restore           # after bench"
    echo ""
    ;;
esac
