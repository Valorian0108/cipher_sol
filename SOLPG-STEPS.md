# Solana Playground steps, tonight (Nov 6 2026)

Path A is the plan: browser-based Anchor, no WSL, deploy to devnet.
Path B (WSL2 + Solana CLI + Anchor) is the fallback only if solpg blocks us.

## Step 1. Create the project

1. Open https://solpg.io and sign in (GitHub login works).
2. Create a new project from the Anchor template. Any name, the folder
   name does not matter.
3. Open `src/lib.rs` in the playground editor.

## Step 2. Paste the program

1. Copy the whole content of `program/src/lib.rs` (this repo) over the
   playground's `lib.rs`, with one exception: keep the playground's own
   `declare_id!(...)` line. It is already wired to the playground program
   credentials, so deployment works without any ID juggling.
2. Save.

## Step 3. Build and deploy

1. In the solpg terminal: `build`. Fix nothing yet; if it errors, paste the
   error verbatim into the chat. Do not improvise fixes at midnight.
2. Then: `deploy`. This deploys to devnet using playground credits.
3. Copy the program address solpg prints. We need it for the agent, the
   server, and the local Cargo copy.

## Step 4. First smoke test, in the solpg terminal

```
solana airdrop 2 <your-owner-pubkey>
```

Then use the playground's TypeScript test file later; tonight the goal is
only: program deployed, address copied, owner wallet funded on devnet.

## Known friction, decided in advance

- If `anchor-lang` version in solpg differs from 0.30.1 and the build
  complains about `ctx.bumps.vault`, the fix is one line and I will give it.
- If solpg cannot deploy due to credits, fallback: `solana config set
  --url https://api.devnet.solana.com` and deploy from WSL (Path B).
- Faucet: https://faucet.solana.com with cluster set to Devnet, or
  `solana airdrop 2 <pubkey>`. Rate limits are real, claim early for all
  four accounts: owner, agent, vendor1, vendor2.

## After deploy succeeds

Next artifacts, in order, all drafted in the chat:
1. `agent/` TypeScript client on @solana/web3.js + Anchor IDL: keypairs
   from .env, the four errands, receipt reads.
2. `vendor/` tiny server that verifies payment by RPC read, then delivers
   the data file.
3. `attack.mjs` five self-predicting scenarios.
4. `app/` three tabs, soft.css reuse.
5. README.
