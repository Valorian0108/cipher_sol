#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$HOME/.cargo/bin:$PATH"
cd "$HOME/krypt-solana"
echo "== version =="
anchor --version
echo "== build help head =="
anchor build --help 2>&1 | head -30
echo "== cargo metadata program name =="
cargo metadata --no-deps --format-version 1 2>/dev/null | head -c 400
echo
echo "== keys list =="
anchor keys list 2>&1 | head -5
echo "== pwd and ls =="
pwd
ls -la
