#!/usr/bin/env bash
# Sync sources from the Windows side, then build. Run before every build so
# the WSL copy never drifts from the repo of record.
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$HOME/.cargo/bin:$PATH"
SRC=/mnt/c/Users/USER/krypt-solana
rm -rf "$HOME/krypt-solana/programs" "$HOME/krypt-solana/program"
mkdir -p "$HOME/krypt-solana"
cp -r "$SRC/programs" "$HOME/krypt-solana/programs"
cp "$SRC/Cargo.toml" "$HOME/krypt-solana/Cargo.toml"
cp "$SRC/Anchor.toml" "$HOME/krypt-solana/Anchor.toml"
solana config set --keypair "$HOME/krypt-solana/keys/owner.json" >/dev/null
cd "$HOME/krypt-solana"
anchor build 2>&1 | tail -40
echo "BUILD_EXIT=$?"
ls -la target/idl/ 2>/dev/null || echo "no idl dir"
