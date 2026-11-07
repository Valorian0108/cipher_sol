# CIPHER on Solana

A spending gate for AI agents.

The money sits in a vault that is a program-derived address on Solana devnet.
It has no private key, so nothing anywhere can sign a transfer out of it. The
only way money leaves is through program code that has already checked the
owner's rules.

The agent can ask the vault to pay. It cannot take money out, it cannot change
the rules, and it cannot approve its own request.

Program `7VCNmeFyt1oRm8u2GxKDmJPnXjM7hmM5Vq66SxKYcX7B`
Demo vault `TaYLzRTh97n53mPDJwE8nRk7hhxCcoc3upiiEEZZUmW`

## Why bother

An agent that can spend is an agent that can be talked into spending wrong.
Hand it a normal keypair and the drain is total the moment something
manipulates it.

So the owner writes rules as data instead. A cap per purchase. A line above
which the owner gets asked. A budget for the run. A list of payees the card
may pay. Every request is checked against those rules and ends one of three
ways: settled, queued for a human, or refused with a reason you can actually
read.

Every decision writes a receipt on chain. Refusals write receipts too, because
a refusal is evidence.

## What happens when the agent asks to pay

1. The agent calls `request_spend(payee, amount, purpose)` with its own key.
2. The program checks, in this order: rules exist, the amount is not zero, the
   payee is not the vault itself, the payee is on the allowlist, the amount is
   under the cap, the spend fits inside the budget, and the balance covers it.
3. Under the auto-approve line the vault pays straight away. Above it the
   request queues and waits for the owner.
4. Approving re-runs every check except the auto-approve line, so something
   queued under old rules cannot slip through after a change.
5. Either way you get a receipt: payee, amount, purpose, status, reason,
   timestamp. Anyone with the address can read it.

A fresh vault fails closed. Until the owner sets rules, everything is refused.

## The demo

A machine-payments market, because that is the shape of commerce that only
works on a chain this fast and cheap.

A vendor sells single data calls at 0.002 SOL each. The agent buys twenty in a
row to assemble a report, and not one of them needs a human, because each is
under the line. A premium digest at 0.03 SOL queues and waits. A bundle at
0.08 SOL is refused as over the cap. A payment to a vendor nobody approved is
refused as off the allowlist.

The vendor only hands over data against a settled receipt that names it as
payee. It reads that receipt off devnet by RPC before it responds. No account,
no invoice, no subscription. The receipt is the proof of payment.

## Running it

Three levels, cheapest first.

**Dry mode.** No keys, no balance, nothing written.

```sh
cd agent && npm install && npm run sim
```

Five questions get answered by the live program: what would you do with this
request. Each answer names the status and the reason a real request would
receive.

**The errands on devnet.** Needs keys in `agent/.env`. Copy
`agent/.env.example` and fill it in.

```sh
npm run vendor     # one terminal, the data vendor on 127.0.0.1:4100
npm run errands    # another terminal
```

You watch the vault initialize, the rules and allowlist get set, twenty calls
settle in a burst, one request queue and then get approved by the owner, one
get refused over cap, one get refused off allowlist, and a receipt table whose
rows link to the explorer.

**The web page.** Same thing you can click.

```sh
npm run demo       # http://localhost:4200
```

Five screens. SETUP shows the gate being built, one transaction per row, each
linked to the explorer. SHOP runs the errands. AUDIT lists every decision in
order.

Two buttons on SETUP are worth understanding before you press them. TOP UP
BUDGET raises the ceiling to spent plus 0.2 SOL, and that is the one you want
before a run. RUN SETUP rebuilds the gate from nothing and writes a flat 0.2
SOL budget, which on a vault that has already spent will lower your headroom.
Use the first one. Leave the second alone unless the vault is empty.

Keep one browser tab open on 4200, not five. Every tab polls devnet on its
own and the public endpoint rate limits aggressively.

**The attack suite.** Five scenarios, each with its outcome predicted before
anything is sent. If reality disagrees with a prediction the harness stops.

```sh
npm run attack
```

| Scenario | Predicted, and observed |
| --- | --- |
| Pay an unlisted account | Refused, reason names the allowlist |
| Buy the over-cap bundle | Refused, reason names the cap |
| Mid-size payment | Queued, waits for a human |
| Plain transfer out of the vault, no program | Fails, a PDA cannot sign |
| Agent approves its own queued spend | Error, caller is not the owner |

## Why Solana

Twenty settled micropayments in seconds at a fraction of a cent each is
per-call machine pricing, which does not work on a chain with a dollar-scale
fee.

## Limitations

- Devnet only. All of it is test money.
- Dollar figures use a fixed demo rate, not a market price.
- The budget is a total for the run, not a rolling window.
- The agent key is a normal Solana keypair. It holds its own small balance and
  could spend that freely. What it cannot do is touch the vault except through
  `request_spend`.
- Receipts are public. Selective disclosure is not built.
- The bundled agent is deterministic on purpose. It stands in for any agent,
  because the guarantees come from the program and not from how the agent
  behaves.

## Prior work, disclosed

- The policy design, the errand and attack structure, and the dry mode descend
  from earlier work by the same owner. The Solana program, the agent suite,
  and the demo pages were built for this hackathon.
- The web design system used by the demo pages is the owner's own and predates
  this event.
- Third-party libraries: anchor-lang, @anchor-lang/core, @solana/web3.js,
  plain node http, dotenv, bs58. Versions are pinned in the manifests.

## License

MIT.
