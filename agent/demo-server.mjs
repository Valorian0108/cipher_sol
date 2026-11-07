// The demo server. It holds the owner and agent keys on localhost, exactly
// like the NEAR Krypt relay model: the browser never sees a private key.
// It serves the three-tab page and exposes the errands, the approval path,
// and the dry mode as local endpoints.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  asOwner,
  asAgent,
  owner,
  VAULT,
  readVault,
  readReceipt,
  listReceipts,
  vendor1,
  vendor2,
  rogue,
  CALL_PRICE,
  CAP,
  AUTO,
  BUDGET,
  PREMIUM,
  BUNDLE,
  LAMPORTS_PER_SOL,
  bn,
  connection,
} from "./src/chain.mjs";
import {
  ensureVault,
  burst,
  premiumThenApprove,
  overCap,
  unlistedPayee,
} from "./src/errands.mjs";
import { runTask } from "./src/shop.mjs";
import { TASKS } from "./src/planner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, "..", "app");
const PORT = 4200;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj, null, 2));
}

function vaultJson(v) {
  return {
    address: VAULT.toBase58(),
    owner: v.owner.toBase58(),
    agent: v.agent.toBase58(),
    rulesSet: Boolean(v.rulesSet),
    cap: Number(v.cap),
    auto: Number(v.auto),
    budget: Number(v.budget),
    spent: Number(v.spent),
    receiptCounter: Number(v.receiptCounter),
    payees: v.payees.slice(0, Number(v.payeeCount)).map((p) => p.toBase58()),
  };
}

const running = new Set();
const tasks = new Map();

async function runOnce(name, fn) {
  if (running.has(name)) return { error: `${name} is already running` };
  running.add(name);
  try {
    await fn();
    return { ok: true, name };
  } catch (e) {
    return { error: String(e.message).split("\n")[0] };
  } finally {
    running.delete(name);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/api/")) {
    let body = "";
    for await (const c of req) body += c;
    const parsed = body ? JSON.parse(body) : {};

    try {
      if (req.method === "GET" && url.pathname === "/api/state") {
        const v = await readVault();
        return send(res, 200, {
          vault: { ...vaultJson(v), balance: await connection.getBalance(VAULT) },
          receipts: await listReceipts(),
          constants: { CALL_PRICE, CAP, AUTO, BUDGET, PREMIUM, BUNDLE, LAMPORTS_PER_SOL },
          addresses: {
            vendor1: vendor1.publicKey.toBase58(),
            vendor2: vendor2.publicKey.toBase58(),
            rogue: rogue.publicKey.toBase58(),
          },
        });
      }

      if (req.method === "POST" && url.pathname === "/api/setup") {
        await ensureVault();
        return send(res, 200, { ok: true });
      }

      // The shop. Tasks run in the background; the page polls their events.
      if (req.method === "GET" && url.pathname === "/api/tasks") {
        return send(res, 200, {
          tasks: Object.values(TASKS).map((t) => ({
            id: t.id,
            title: t.title,
            desc: t.desc,
            items: t.items.map((i) => ({ label: i.label, amount: i.amount })),
          })),
        });
      }

      if (req.method === "POST" && url.pathname === "/api/task") {
        const id = parsed.taskId;
        if (!TASKS[id]) return send(res, 400, { error: `unknown task: ${id}` });
        if ([...tasks.values()].some((t) => t.status === "running")) {
          return send(res, 409, { error: "a task is already running" });
        }
        const record = { id, status: "running", events: [], report: null, error: null };
        const taskId = `t${Date.now()}`;
        tasks.set(taskId, record);
        runTask(id, (e) => record.events.push(e))
          .then(({ report }) => {
            record.status = "done";
            record.report = report;
          })
          .catch((e) => {
            record.status = "error";
            record.error = String(e.message).split("\n")[0];
          });
        return send(res, 202, { taskId });
      }

      if (req.method === "GET" && url.pathname === "/api/task") {
        const record = tasks.get(url.searchParams.get("id"));
        if (!record) return send(res, 404, { error: "no such task" });
        return send(res, 200, record);
      }

      // Owner top-up: re-set the rules with a fresh budget above what is
      // already spent. An honest owner action, the same call as setup uses.
      if (req.method === "POST" && url.pathname === "/api/topup") {
        const v = await readVault();
        const spent = Number(v.spent);
        const prog = asOwner();
        const sig = await prog.methods
          .setRules(bn(CAP), bn(AUTO), bn(spent + BUDGET))
          .accounts({ vault: VAULT, owner: owner.publicKey })
          .rpc();
        return send(res, 200, { ok: true, sig, newBudget: spent + BUDGET });
      }

      if (req.method === "POST" && url.pathname === "/api/errand/burst") {
        return send(res, 200, await runOnce("burst", burst));
      }
      if (req.method === "POST" && url.pathname === "/api/errand/premium") {
        return send(res, 200, await runOnce("premium", premiumThenApprove));
      }
      if (req.method === "POST" && url.pathname === "/api/errand/overcap") {
        return send(res, 200, await runOnce("overcap", overCap));
      }
      if (req.method === "POST" && url.pathname === "/api/errand/unlisted") {
        return send(res, 200, await runOnce("unlisted", unlistedPayee));
      }

      if (req.method === "POST" && url.pathname === "/api/approve") {
        const r = await readReceipt(parsed.receipt);
        if (r.status !== "QUEUED") return send(res, 409, { error: `receipt is ${r.status}` });
        const prog = asOwner();
        const sig = await prog.methods
          .approveSpend()
          .accounts({
            vault: VAULT,
            owner: owner.publicKey,
            receipt: parsed.receipt,
            payee: r.payee,
          })
          .rpc();
        return send(res, 200, { ok: true, sig, after: await readReceipt(parsed.receipt) });
      }

      if (req.method === "POST" && url.pathname === "/api/refuse") {
        const prog = asOwner();
        const sig = await prog.methods
          .refuseSpend(parsed.reason || "the owner refused this request")
          .accounts({
            vault: VAULT,
            owner: owner.publicKey,
            receipt: parsed.receipt,
            payee: (await readReceipt(parsed.receipt)).payee,
          })
          .rpc();
        return send(res, 200, { ok: true, sig, after: await readReceipt(parsed.receipt) });
      }

      if (req.method === "POST" && url.pathname === "/api/simulate") {
        const payees = { vendor1, vendor2, rogue };
        const payee = payees[parsed.payeeId];
        if (!payee) return send(res, 400, { error: "payeeId must be vendor1, vendor2, or rogue" });
        const resSim = await asAgent().methods
          .simulate(bn(Number(parsed.amount)), parsed.purpose || "dry question from the page")
          .accounts({ vault: VAULT, payee: payee.publicKey })
          .simulate();
        const line = (resSim.raw || resSim.logs || []).find((l) => l.includes("SIMULATE")) || "no answer";
        return send(res, 200, { answer: line.replace("Program log: ", "") });
      }

      return send(res, 404, { error: "unknown api route" });
    } catch (e) {
      return send(res, 500, { error: String(e.message).split("\n")[0] });
    }
  }

  // static
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.join(APP, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`demo page: http://localhost:${PORT}`);
});
