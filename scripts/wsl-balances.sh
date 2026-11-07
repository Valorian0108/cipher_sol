#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
for k in owner agent; do
  pk=$(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")
  echo "$k: $(solana balance "$pk")"
done
