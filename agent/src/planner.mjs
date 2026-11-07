// The planner turns a task into a shopping cart. It is deterministic on
// purpose: three canned tasks map to fixed carts, because a fixed catalog
// is what the vendors sell. This module is the single swap point if an LLM
// planner is ever added. Nothing else changes when that day comes.

import {
  vendor1,
  vendor2,
  rogue,
  CALL_PRICE,
  PREMIUM,
  BUNDLE,
} from "./chain.mjs";

const calls = (n, vendorId, keypair) =>
  Array.from({ length: n }, (_, i) => ({
    label: `market call ${i + 1}/${n}`,
    vendorId,
    payee: keypair.publicKey,
    amount: CALL_PRICE,
  }));

export const TASKS = {
  report: {
    id: "report",
    title: "Build the SOL market report",
    desc: "Twenty market data calls at 0.002 SOL each, every one under the auto-approve line. The agent shops alone and assembles a report from what it bought.",
    items: calls(20, "vendor1", vendor1),
  },
  brief: {
    id: "brief",
    title: "Commission the deep research brief",
    desc: "Five market calls plus one premium digest at 0.03 SOL. The digest is above the line, so it queues and the owner decides inside the shop.",
    items: [
      ...calls(5, "vendor1", vendor1),
      {
        label: "premium research digest",
        vendorId: "vendor2",
        payee: vendor2.publicKey,
        amount: PREMIUM,
      },
    ],
  },
  rogue: {
    id: "rogue",
    title: "Buy from the cheapest bidder",
    desc: "A bad task on purpose. The agent tries an unlisted vendor and an over-cap bundle. The gate refuses both, no money moves, and the agent reports back with the reasons.",
    items: [
      {
        label: "call from an unlisted vendor",
        vendorId: null,
        payee: rogue.publicKey,
        amount: CALL_PRICE,
      },
      {
        label: "full archive bundle",
        vendorId: "vendor1",
        payee: vendor1.publicKey,
        amount: BUNDLE,
      },
    ],
  },
};

export function plan(taskId) {
  const t = TASKS[taskId];
  if (!t) throw new Error(`unknown task: ${taskId}`);
  return t;
}
