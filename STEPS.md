# Toolchain and steps, weekend of Nov 6 2026

## Status log

- 2026-11-06: Path A (Solana Playground, solpg.io) is DEAD. The domain does
  not resolve from this machine or from a server-side fetch
  (DNS_PROBE_FINISHED_NXDOMAIN). Recorded so nobody wastes time retrying it.
- 2026-11-06: Path B chosen: WSL2 Ubuntu 26.04, already present on this
  machine. rustup and the Agave CLI (solana-cli 4.3.2) installed without
  sudo. Anchor arrives as a PREBUILT binary, anchor-cli 1.2.2 from the
  otter-sec/anchor release assets, so no apt packages and no long compile
  were needed after all.
- 2026-11-07: version pairing learned and recorded. The Rust crate is
  anchor-lang 1.2.2 on crates.io. The TypeScript client for 1.x is NOT
  @coral-xyz/anchor (that line stops at 0.32.1); it is @anchor-lang/core
  1.2.2. Both are pinned accordingly.
- 2026-11-07: Anchor 1.x program discovery requires the canonical layout,
  programs/<name> with the package name matching. A flat program/ directory
  builds nothing and prints nothing. Fixed by moving to programs/krypt_solana.
- 2026-11-07: the devnet CLI faucet refuses this IP outright (ten straight
  rate-limit errors). Funding moves to the browser faucet at
  faucet.solana.com. Only owner and agent need SOL; vendors and the rogue
  account are payees and never sign.
- 2026-11-07: Anchor 1.x TypeScript demands every u64 argument as a BN
  instance. Plain numbers die with "src.toArrayLike is not a function".
  The shared helper is bn() in agent/src/chain.mjs and every amount arg
  (setRules, requestSpend, simulate) goes through it.
- 2026-11-07: .simulate() in @anchor-lang/core 1.x returns { events, raw }.
  The program logs live in raw, not logs like in 0.x. The dry-mode parser
  reads res.raw || res.logs.
- 2026-11-07: attack scenario A5 taught the harness something. A fake owner
  cannot even address the real vault, because the vault PDA seeds include
  the owner key. Anchor rejects with ConstraintSeeds (2006) before the
  NotOwner check ever runs. The prediction was updated to
  ERROR_SEEDS_FAKE_OWNER. All five attacks now hold: allowlist, cap,
  queue, seeds-bound vault, and unsigned PDA transfer.
- 2026-11-07: full stack verified on devnet. Errands write 23+ receipts,
  dry mode agrees on all five probes, the vendor delivers only against a
  settled receipt naming it as payee ("receipt pays someone else" and
  "receipt is REFUSED, not paid" both enforced), and the demo page serves
  on http://localhost:4200 with keys staying server-side.
- 2026-11-07: the demo page became a product. Owner decided against an
  explainer dashboard: the shop is the app and the gate is why the shop
  can trust a machine buyer. New modules: planner.mjs (task to cart,
  deterministic, the single swap point for a future LLM planner),
  shop.mjs (the loop: plan, pay, wait for the owner, deliver, assemble),
  report.mjs (artifact from real vendor deliveries). demo-server gained
  /api/tasks, /api/task start and poll, and /api/topup (owner re-sets the
  budget above current spend, an honest on-chain action, because
  set_rules never resets spent).
- 2026-11-07: front rebuilt as five screens in neobrutalism (owner picked
  it from four HTML mocks, file kept at design/style-mocks.html):
  Landing, Setup, Shop, Report, Audit. Vanilla JS, hash router, no build
  step.
- 2026-11-07: two shop bugs found and fixed by end-to-end runs. The rogue
  task assembles a zero-spend report with both refusal reasons. The brief
  task ran the full product loop: five settled calls delivered against
  receipts, premium digest queued, approved by owner over the API,
  delivered, report assembled with real index stats. Vendor catalog bug:
  a 0.03 receipt delivered the 0.002 item because the catalog picked the
  first match; now it picks the most expensive item the receipt covers.

## Steps, current

1. Wait for TOOLCHAIN_OK from the background install.
2. Generate the four devnet keypairs: owner, agent, vendor1, vendor2.
   Private keys stay in `agent/.env`, git-ignored, never in the repo.
3. Airdrop devnet SOL to all four: `solana airdrop 2 <pubkey>` with the
   cluster set to devnet. Rate limits are real; claim early.
4. Generate the program keypair, put its address in Anchor.toml, then
   `anchor build` and `anchor deploy --provider.cluster devnet`.
5. Smoke test: initialize_vault from the owner key, read the vault account
   back, confirm rules_set is false (failing closed).
6. Then the errands, the vendor, the attack suite, the app, the README.

## Known friction, decided in advance

- If `anchor build` complains about the anchor-lang version, match the
  Cargo.toml dependency to whatever `avm list` says is installed. One line.
- If devnet airdrops fail repeatedly, use https://faucet.solana.com in a
  browser with the cluster set to Devnet.
- Never fix a Rust build error by guessing at midnight. Paste it verbatim.
