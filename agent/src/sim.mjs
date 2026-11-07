// The dry mode probe. simulate runs the exact decision code on chain and
// writes nothing. The answer arrives through program logs. Anyone can ask
// it, with no key and no balance, which is the point.

import {
  asAgent,
  VAULT,
  vendor1,
  vendor2,
  rogue,
  sol,
  bn,
  CALL_PRICE,
  PREMIUM,
  BUNDLE,
} from "./chain.mjs";

const cases = [
  { label: "one market call, listed vendor", payee: vendor1.publicKey, amount: CALL_PRICE, expect: "SETTLED" },
  { label: "premium digest, above the line", payee: vendor2.publicKey, amount: PREMIUM, expect: "QUEUED" },
  { label: "archive bundle, above the cap", payee: vendor1.publicKey, amount: BUNDLE, expect: "REFUSED" },
  { label: "any amount, unlisted vendor", payee: rogue.publicKey, amount: CALL_PRICE, expect: "REFUSED" },
  { label: "zero amount", payee: vendor1.publicKey, amount: 0, expect: "REFUSED" },
];

async function main() {
  const prog = asAgent();
  let allOk = true;
  for (const c of cases) {
    const res = await prog.methods
      .simulate(bn(c.amount), c.label)
      .accounts({ vault: VAULT, payee: c.payee })
      .simulate();
    const logs = res.raw || res.logs || [];
    const line = logs.find((l) => l.includes("SIMULATE")) || "no SIMULATE line in logs";
    const got = (line.match(/status (\w+)/) || [])[1] || "UNKNOWN";
    const ok = got === c.expect;
    allOk = allOk && ok;
    console.log(`${ok ? "HELD " : "BROKE"} ${c.label}: ${sol(c.amount)} -> ${got}`);
    console.log(`      ${line.replace("Program log: ", "")}`);
  }
  console.log(allOk ? "\ndry mode agrees with the rules." : "\ndry mode disagrees. stop.");
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error("sim crashed:", e.message);
  process.exit(1);
});
