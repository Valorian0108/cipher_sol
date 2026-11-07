#!/usr/bin/env bash
# Part 1 of the toolchain: everything that needs no sudo.
set -euo pipefail

echo "== rustup =="
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
rustc --version

echo "== agave (solana cli) =="
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q active_release "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
solana --version

echo PART1_OK
