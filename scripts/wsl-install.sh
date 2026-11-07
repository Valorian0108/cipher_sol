#!/usr/bin/env bash
# One-shot toolchain install for the krypt-solana weekend build.
# Installs: build deps, rustup, wasm target, Agave (Solana) CLI, Anchor via avm.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "== apt deps =="
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential pkg-config libssl-dev curl

echo "== rustup =="
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
rustc --version

echo "== agave (solana cli) =="
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
grep -q active_release "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> "$HOME/.bashrc"
solana --version

echo "== anchor via avm =="
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
anchor --version

echo TOOLCHAIN_OK
