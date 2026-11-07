#!/usr/bin/env bash
# Part 2: prebuilt anchor binary, project layout in WSL home, devnet keys,
# airdrops, and the agent .env on the Windows side. No sudo, no compiles.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/bin:$PATH"

echo "== anchor prebuilt binary =="
mkdir -p "$HOME/bin"
curl -sSL -o "$HOME/bin/anchor" \
  https://github.com/otter-sec/anchor/releases/download/v1.2.2/anchor-1.2.2-x86_64-unknown-linux-gnu
chmod +x "$HOME/bin/anchor"
grep -q 'HOME/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bashrc"
anchor --version

echo "== project layout in WSL home =="
mkdir -p "$HOME/krypt-solana"
rm -rf "$HOME/krypt-solana/program"
cp -r /mnt/c/Users/USER/krypt-solana/program "$HOME/krypt-solana/program"
cp /mnt/c/Users/USER/krypt-solana/Anchor.toml "$HOME/krypt-solana/Anchor.toml"

echo "== devnet keypairs =="
mkdir -p "$HOME/krypt-solana/keys"
for k in owner agent vendor1 vendor2 rogue program; do
  solana-keygen new --no-passphrase --silent --force -o "$HOME/krypt-solana/keys/$k.json" >/dev/null
  echo "$k: $(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")"
done

echo "== wire program id into Anchor.toml =="
PID=$(solana-keygen pubkey "$HOME/krypt-solana/keys/program.json")
sed -i "s/REPLACE_WITH_PROGRAM_KEYPAIR_PUBKEY/$PID/" "$HOME/krypt-solana/Anchor.toml"
mkdir -p "$HOME/krypt-solana/target/deploy"
cp "$HOME/krypt-solana/keys/program.json" "$HOME/krypt-solana/target/deploy/krypt_solana-keypair.json"

echo "== devnet config and airdrops =="
solana config set --url https://api.devnet.solana.com >/dev/null
for k in owner agent vendor1 vendor2 rogue; do
  pk=$(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")
  for i in 1 2 3 4; do
    if solana airdrop 2 "$pk" >/dev/null 2>&1; then
      echo "airdropped $k"
      break
    fi
    echo "airdrop retry $k attempt $i"
    sleep 4
  done
done

echo "== agent .env on the Windows side =="
ENVF=/mnt/c/Users/USER/krypt-solana/agent/.env
{
  echo "RPC_URL=https://api.devnet.solana.com"
  echo "PROGRAM_ID=$PID"
  echo "OWNER_KEY=$(cat "$HOME/krypt-solana/keys/owner.json")"
  echo "AGENT_KEY=$(cat "$HOME/krypt-solana/keys/agent.json")"
  echo "VENDOR1_KEY=$(cat "$HOME/krypt-solana/keys/vendor1.json")"
  echo "VENDOR2_KEY=$(cat "$HOME/krypt-solana/keys/vendor2.json")"
  echo "VENDOR_ROGUE_KEY=$(cat "$HOME/krypt-solana/keys/rogue.json")"
  echo "DEMO_USD_PER_SOL=200"
} > "$ENVF"
echo "wrote $ENVF"

echo "== balances =="
for k in owner agent vendor1 vendor2 rogue; do
  pk=$(solana-keygen pubkey "$HOME/krypt-solana/keys/$k.json")
  echo "$k: $(solana balance "$pk")"
done

echo PART2_OK
