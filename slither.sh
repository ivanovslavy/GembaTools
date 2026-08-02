#!/usr/bin/env bash
# Static analysis — Slither over the production contracts only (test/mocks excluded).
# Install once:  pipx install slither-analyzer
set -euo pipefail
cd "$(dirname "$0")"
echo "== Slither — GembaTools production contracts (contracts/*.sol) =="
slither . \
  --filter-paths "node_modules|contracts/test|lib|test-forge" \
  --exclude-dependencies \
  2>&1 | tee slither-report.txt || true
echo
echo "Focus detectors: reentrancy-eth · arbitrary-send-eth · unchecked-transfer ·"
echo "  unused-return (approve) · calls-loop · block-timestamp · missing-zero-check"
