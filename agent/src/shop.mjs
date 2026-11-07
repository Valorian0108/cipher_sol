// The shop loop. One task goes in. The planner makes the cart, the agent
// pays each item through the vault, queued items wait for the owner, every
// settled receipt is presented to the vendor, and the delivered data is
// assembled into the report. Progress is a list of events the page polls.

import {
  asAgent,
  agent,
  VAULT,
  readVault,
  readReceipt,
  receiptPda,
  bn,
  sol,
} from "./chain.mjs";
import { plan } from "./planner.mjs";
import { assemble } from "./report.mjs";

const VENDOR_URL = "http://127.0.0.1:4100";
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

async function buy(item) {
  const prog = asAgent();
  const before = await readVault();
  const counter = Number(before.receiptCounter);
  const sig = await prog.methods
    .requestSpend(bn(item.amount), item.label)
    .accounts({
      vault: VAULT,
      agent: agent.publicKey,
      payee: item.payee,
    })
    .rpc();
  const key = receiptPda(VAULT, counter).toBase58();
  return { key, sig, receipt: await readReceipt(key) };
}

async function waitForOwner(key) {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  let r = await readReceipt(key);
  while (r.status === "QUEUED" && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await readReceipt(key);
  }
  return r;
}

async function deliver(item, key) {
  const res = await fetch(`${VENDOR_URL}/deliver`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receipt: key, vendor: item.vendorId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `vendor said ${res.status}`);
  return body;
}

export async function runTask(taskId, onEvent = () => {}) {
  const task = plan(taskId);
  const events = [];
  const emit = (e) => {
    const stamped = { at: Date.now(), ...e };
    events.push(stamped);
    onEvent(stamped);
  };

  emit({
    type: "plan",
    text: `plan for "${task.title}": ${task.items.length} purchases`,
    cart: task.items.map((i) => ({
      label: i.label,
      amount: i.amount,
      vendor: i.vendorId,
      payee: i.payee.toBase58(),
    })),
  });

  const results = [];
  for (const item of task.items) {
    const { key, sig, receipt } = await buy(item);
    let r = receipt;
    emit({
      type: "purchase",
      label: item.label,
      amount: item.amount,
      status: r.status,
      reason: r.reason,
      receipt: key,
      sig,
    });

    if (r.status === "QUEUED") {
      emit({
        type: "awaiting",
        label: item.label,
        amount: item.amount,
        receipt: key,
        text: `${sol(item.amount)} is above the auto line. Waiting for the owner in the shop.`,
      });
      r = await waitForOwner(key);
      emit({
        type: "decision",
        label: item.label,
        status: r.status,
        reason: r.reason,
        receipt: key,
      });
    }

    let delivery = null;
    if (r.status === "SETTLED" || r.status === "APPROVED") {
      delivery = await deliver(item, key);
      emit({
        type: "delivery",
        label: item.label,
        receipt: key,
        delivered: delivery.delivered,
        note: delivery.note,
      });
    }

    results.push({ item, receipt: { ...r, key }, delivery });
  }

  const report = assemble(task, results);
  emit({ type: "report", text: `report assembled for "${task.title}"`, report });
  return { task, events, report };
}
