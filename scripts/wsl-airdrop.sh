#!/usr/bin/env bash
# Airdrop devnet SOL to the two accounts that actually sign and pay fees:
# owner (vault init, approvals) and agent (requests, receipt rent).
# Vendors and the rogue account are payees only; they never need SOL.
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana config set --url https://api.devnet.solana.com >/dev/null
for k in owner agent; do
  pk=$(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")
  for i in 1 2 3 4 5; do
    if solana airdrop 2 "$pk"; then
      echo "airdropped $k"
      break
    fi
    echo "retry $k attempt $i"
    sleep 6
  done
done
for k in owner agent; do
  pk=$(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")
  echo "$k: $(solana balance "$pk")"
done
