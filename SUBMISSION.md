# MLH Solana Hackathon submission draft (Nov 2026)

Fill the bracketed items after the demo runs. Paste nothing before reading
it aloud once.

## Project name

CIPHER. The psi in the header mark is drawn only. The name is spelled CIPHER
everywhere it is typed, because domains, package names, and forms are ASCII.

## Tracks

AI track, DeFi track. Top overall is automatic.

## One-line description

A spending gate for AI agents on Solana: the agent can ask a vault to pay,
and the vault's on-chain rules decide, with a receipt for every decision.

## Description for the form

An AI agent that can spend is an agent that can be tricked into spending
wrong. CIPHER removes the need to trust the agent. The owner's money sits in
a vault that is a program-derived address on Solana, so no key anywhere can
sign a transfer out of it. The only door is program code that checks the
caller and the owner's rules: a cap per purchase, an auto-approve line, a
budget, and an allowlist of payees. Under the line a purchase settles
instantly. Above it the request queues for a human. Wrong requests are
refused with a readable reason, and every decision, including refusals,
writes a receipt account anyone can open in the explorer.

The demo is a machine-payments market, the commerce shape that only exists
on a chain this fast and cheap. The agent buys twenty data calls at 0.002
SOL each in one burst, every call settling without a human because each is
under the line. A premium digest queues and waits for the owner. An
over-cap bundle and an unlisted vendor are refused on chain. The vendor
delivers its data only after reading the settled receipt from devnet by
RPC: no subscription, no invoice, the receipt is the payment proof.

The build ships a dry mode that answers "what would you do with this
request" using the real decision code and writing nothing, and a
five-scenario attack suite where each outcome is predicted before sending
and the harness stops if reality disagrees. On Solana the wall lives in the
program, because Solana has no scoped keys: the same gate on NEAR loses two
of five attacks at the network layer, while here all five die at the
program. Same gate, different wall placement, and the placement is a
property of the chain.

## Links to fill

- Repo: https://github.com/Valorian0108/cipher_sol
- Video: [demo recording, Sunday morning]
- Live demo: [the page is local by design; the video carries it, or a
  tunnelled url if time allows]
- Program address: 7VCNmeFyt1oRm8u2GxKDmJPnXjM7hmM5Vq66SxKYcX7B
- Vault address: TaYLzRTh97n53mPDJwE8nRk7hhxCcoc3upiiEEZZUmW

## What the judges should click, in order

1. npm run sim: five dry questions answered by the live program.
2. npm run errands: the burst, the queue, the approval, the two refusals.
3. npm run attack: five predictions held.
4. The receipts tab: every row linked to the explorer.
