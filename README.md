# Krypt on Solana

Krypt bounds what an AI agent may spend. The money sits in a per-owner
vault that is a program-derived address on Solana devnet, and the vault's
rules live in program state that the agent cannot edit. The agent can ask
the vault to pay. It cannot take money out, change the rules, or approve
its own request.

This is the Solana reference implementation of the same gate that runs on
NEAR as Krypt (github.com/Valorian0108/krypt). The thesis is chain-agnostic.
The two implementations differ in exactly one place, and the difference is
the most interesting fact in this repository: NEAR hands you a scoped key
at the protocol level, while Solana has no such key, so on Solana the wall
moves into the program. The vault is a PDA with no private key. Nobody can
sign a transfer from it. The only door is program code that checks the
caller and the rules first.

## The idea in one paragraph

An AI agent that can spend is an agent that can be tricked into spending
wrong. Handing it a wallet with a normal keypair makes the drain total the
moment it is manipulated. Krypt removes the need to trust the agent. The
owner writes rules as data: a cap per purchase, an auto-approve line, a
budget for the run, and an allowlist of payees. Every request is checked
against those rules in a fixed order and ends one of three ways: settled,
queued for the owner, or refused with a readable reason. Every decision
writes a receipt account on chain. Refusals write receipts too, because a
refusal is the evidence.

## How a spend works

1. The agent calls `request_spend(payee, amount, purpose)` with its own
   keypair.
2. The program checks, in order: rules exist, amount is nonzero, payee is
   not the vault itself, payee is on the allowlist, amount is under the
   cap, the spend stays inside the budget, and the spendable balance
   covers it.
3. Under the auto-approve line the vault pays immediately. Above it the
   request queues and waits for the owner.
4. Approval re-runs every check except the auto-approve line, so a request
   queued under old rules cannot slip through after a change.
5. Every outcome is a receipt account: payee, amount, purpose, status,
   reason, timestamp, readable by anyone with the address.

A fresh vault fails closed. Until the owner sets rules, every request is
refused.

## The demo: a machine-payments market

The shopping story is per-call machine payments, the commerce shape that
only exists on a chain this fast and cheap. A vendor sells single data
calls at 0.002 SOL each. The agent buys twenty of them in a row to assemble
a report, and every call settles without a human, because each is under
the auto-approve line. One premium digest at 0.03 SOL queues and waits for
the owner. One bundle at 0.08 SOL is refused as over the cap. One payment
to an unlisted vendor is refused as off the allowlist.

The vendor delivers only against a settled receipt. It reads the receipt
account from devnet by RPC, checks that it names the vendor as payee and
that the status is paid, and only then returns the data. No subscription,
no invoice, no account. The receipt is the payment proof.

## Try it

Level 1, the dry mode. No key, no balance, nothing written.

```sh
cd agent && npm install && npm run sim
```

You see five questions answered by the live program: what would you do
with this request? Each answer names the status and the reason a real
request would receive.

Level 2, the errands on devnet. Needs the keys in `agent/.env`.

```sh
npm run vendor     # one terminal, the data vendor on 127.0.0.1:4100
npm run errands    # another terminal
```

You see the vault initialize, the rules and allowlist set, twenty calls
settle in a burst, one request queue and then get owner-approved, one
refused over cap, one refused off allowlist, and a receipt table whose
rows link to the explorer.

Level 3, the attack suite. Five scenarios, each with its outcome predicted
before sending. If reality disagrees with a prediction the harness stops.

```sh
npm run attack
```

| Scenario | Predicted and observed |
| --- | --- |
| Pay an unlisted account | Refused, reason names the allowlist |
| Buy the over-cap bundle | Refused, reason names the cap |
| Mid-size payment | Queued, waits for a human |
| Plain transfer out of the vault, no program | Transaction fails, a PDA cannot sign |
| Agent approves its own queued spend | Error, caller is not the owner |

## How Solana fits, and the honest difference from NEAR

Solana has no equivalent of NEAR's FunctionCall access key. A Solana
keypair is full access or nothing. So the scoped-identity wall that NEAR
enforces at the protocol level is constructed here at the program level:
the vault is a PDA, it has no private key, and lamports leave it only
through direct debit inside program code that has already run its checks.
The consequence for the attack story is honest and visible: on NEAR two of
five attacks die at the network layer before the contract is reached,
while on Solana no attack dies at the network layer, because there is no
network-layer scope to die at. All five die at the program. Same gate,
different wall placement, and the placement is a property of the chain,
not a design preference.

Solana also supplies the economics that make the demo meaningful: twenty
settled micropayments in seconds at a fraction of a cent each is per-call
machine pricing, which is uneconomical on any chain with a dollar-scale
fee.

## Limitations

- Devnet only. All funds are test money.
- Dollar figures use a fixed demo conversion rate, not a market price.
- The budget is a total for the run, not a rolling period window.
- The agent keypair is a normal Solana keypair. It holds its own small
  balance and could in principle spend that balance freely. What it cannot
  do is touch the vault except through `request_spend`. On NEAR the key
  itself is the first wall; here the program is the first wall.
- Receipts are public. Selective disclosure is not built.
- The bundled agent is deterministic on purpose. It stands in for any
  agent, because the guarantees come from the program, not from the
  agent's behavior.

## Prior work, disclosed

- The policy design, the errand and attack structure, and the dry mode
  descend from Krypt on NEAR, built by the same owner in the NEAR
  HACKATHON window of November 2026.
- The web design system used by the demo pages is the owner's own,
  maintained before this event.
- Third-party libraries: anchor-lang, @anchor-lang/core, @solana/web3.js,
  express-free node http, dotenv, bs58. Versions pinned in the manifests.

## License

MIT.
