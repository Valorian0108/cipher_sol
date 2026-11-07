#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/krypt-solana"
echo "== target tree (depth 2) =="
find target -maxdepth 2 | head -40
echo "== wasm =="
ls -la target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || echo none
ls -la target/deploy 2>/dev/null || echo "no target/deploy"
echo "== types =="
ls -la target/types 2>/dev/null || echo "no target/types"
