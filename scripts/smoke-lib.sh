# Sourced by smoke-run and verify-asar-integrity.
# smoke_launch <exe> <report-file> <limit-seconds> <log-file>
# Runs the app with MCMONITOR_SMOKE=1 and --smoke and prints its exit code; 124 means it was killed on timeout.
smoke_launch() {
  local exe=$1 report=$2 limit=$3 log=$4
  MCMONITOR_SMOKE=1 MCMONITOR_SMOKE_REPORT="$report" "$exe" --smoke >"$log" 2>&1 &
  local pid=$!
  local ticks=$((limit * 10))
  while ((ticks > 0)) && kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    ticks=$((ticks - 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    echo 124
    return
  fi
  local code=0
  wait "$pid" || code=$?
  echo "$code"
}

budget_value() {
  node -e "process.stdout.write(String(require(process.argv[1])[process.argv[2]]))" \
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/budget.json" "$1"
}
