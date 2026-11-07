// Print every receipt for this vault, in order, the way the explorer
// would show them but readable.

import { listReceipts, sol, usd, explorerAddr } from "./chain.mjs";

const rows = await listReceipts();
console.log(`${rows.length} receipts on chain`);
for (const r of rows) {
  console.log(
    `#${String(r.counter).padStart(2, "0")} ${r.status.padEnd(13)} ${sol(r.amount).padStart(14)} ${usd(r.amount).padStart(10)}  ${r.purpose}`
  );
  console.log(`     reason: ${r.reason}`);
  console.log(`     receipt: ${explorerAddr(r.key)}`);
}
