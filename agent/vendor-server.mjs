// The vendor. Sells data calls at a published price and delivers only
// against a settled on-chain receipt that names this vendor as payee.
// No account, no subscription, no invoice: the receipt is the payment
// proof, read straight from devnet by RPC.

import http from "node:http";
import crypto from "node:crypto";
import {
  connection,
  readReceipt,
  vendor1,
  vendor2,
  CALL_PRICE,
  PREMIUM,
  sol,
} from "./src/chain.mjs";

const PORT = 4100;

const VENDORS = {
  "1": { keypair: vendor1, name: "market data vendor" },
  "2": { keypair: vendor2, name: "research vendor" },
};
// Accept both "1" and "vendor1" so every caller convention works.
const vendorById = (id) => VENDORS[String(id).replace(/^vendor/, "")];

const CATALOG = [
  { id: "call", lamports: CALL_PRICE, desc: "one market data call" },
  { id: "premium", lamports: PREMIUM, desc: "premium research digest" },
];

function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/catalog") {
    return send(res, 200, {
      vendors: Object.fromEntries(
        Object.entries(VENDORS).map(([id, v]) => [id, v.keypair.publicKey.toBase58()])
      ),
      items: CATALOG,
      note: "pay through your vault, then POST the receipt pubkey to /deliver",
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, slot: await connection.getSlot() });
  }

  if (req.method === "POST" && url.pathname === "/deliver") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "body must be json: {receipt, vendor}" });
    }
    const { receipt, vendor } = parsed;
    const v = vendorById(vendor);
    if (!v) return send(res, 400, { error: "unknown vendor id" });

    let r;
    try {
      r = await readReceipt(receipt);
    } catch {
      return send(res, 404, { error: "receipt account not found on chain" });
    }
    if (r.payee !== v.keypair.publicKey.toBase58()) {
      return send(res, 402, { error: "receipt pays someone else" });
    }
    if (r.status !== "SETTLED" && r.status !== "APPROVED") {
      return send(res, 402, { error: `receipt is ${r.status}, not paid` });
    }
    // Pick the most expensive item the receipt covers, not the first match.
    const item = CATALOG.slice()
      .sort((a, b) => b.lamports - a.lamports)
      .find((c) => c.lamports <= r.amount);
    if (!item) return send(res, 402, { error: "amount below any published price" });

    const digest = crypto
      .createHash("sha256")
      .update(`${receipt}:${r.amount}:${r.ts}`)
      .digest("hex");
    console.log(`delivered ${item.id} against receipt ${receipt} (${sol(r.amount)})`);
    return send(res, 200, {
      delivered: item.id,
      paid: sol(r.amount),
      digest,
      series: Array.from({ length: 12 }, (_, i) =>
        Number((100 + 7 * Math.sin((r.ts % 97) + i)).toFixed(2))
      ),
      note: `${v.name} verified the receipt on devnet before delivering`,
    });
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`vendor listening on http://127.0.0.1:${PORT}`);
  console.log(`vendor1: ${vendor1.publicKey.toBase58()}`);
  console.log(`vendor2: ${vendor2.publicKey.toBase58()}`);
});
