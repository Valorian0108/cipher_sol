#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$HOME/.cargo/bin:$PATH"
cd "$HOME/krypt-solana"
echo "== explicit program name =="
anchor build -p krypt_solana --skip-lint
echo "EXIT=$?"
echo "== keys list again =="
anchor keys list
