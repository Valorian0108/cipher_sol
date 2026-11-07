#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$HOME/.cargo/bin:$PATH"
cd "$HOME/krypt-solana"
anchor build
echo "ANCHOR_EXIT=$?"
