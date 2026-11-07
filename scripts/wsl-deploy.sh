#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$HOME/.cargo/bin:$PATH"
cd "$HOME/krypt-solana"
echo "== artifacts =="
ls -la target/deploy/ 2>/dev/null
ls -la target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || echo "no plain wasm (expected, sbf uses .so)"
echo "== owner balance =="
solana balance "$(solana-keygen pubkey "$HOME/krypt-solana/keys/owner.json")"
echo "== deploy attempt =="
anchor deploy --provider.cluster devnet 2>&1 | tail -15
echo "DEPLOY_EXIT=${PIPESTATUS[0]}"
echo "== copy IDL =="
mkdir -p /mnt/c/Users/USER/krypt-solana/agent/idl
cp target/idl/krypt_solana.json /mnt/c/Users/USER/krypt-solana/agent/idl/krypt_solana.json && echo "idl copied"
echo "== program show =="
solana program show 7VCNmeFyt1oRm8u2GxKDmJPnXjM7hmM5Vq66SxKYcX7B 2>&1 | head -8
