// The report assembler. It consumes what the vendors actually delivered,
// which is data released only against settled on-chain receipts, and turns
// it into the artifact the owner asked for. Deterministic on purpose: the
// numbers come from the chain deliveries, the prose describes them plainly.

import { sol, usd } from "./chain.mjs";

export function assemble(task, results) {
  const settled = results.filter((r) => r.receipt.status === "SETTLED");
  const approved = results.filter((r) => r.receipt.status === "APPROVED");
  const refused = results.filter((r) => r.receipt.status.startsWith("REFUSED") || r.receipt.status === "OWNER_REFUSED");
  const paid = [...settled, ...approved];
  const deliveries = paid.map((r) => r.delivery).filter(Boolean);
  const totalSpent = paid.reduce((sum, r) => sum + r.receipt.amount, 0);

  // Every delivered series is real data the vendor released against a
  // settled receipt. Pool them for the market numbers.
  const allSeries = deliveries.flatMap((d) => d.series || []);
  const stats = allSeries.length
    ? {
        min: Math.min(...allSeries),
        max: Math.max(...allSeries),
        mean: allSeries.reduce((a, b) => a + b, 0) / allSeries.length,
        points: allSeries.length,
      }
    : null;

  const lines = [];
  lines.push(`Task: ${task.title}`);
  lines.push(
    `${paid.length} of ${results.length} purchases went through, ${refused.length} were refused by the vault.`
  );
  lines.push(`Total spent: ${sol(totalSpent)} (${usd(totalSpent)}).`);
  if (approved.length) {
    lines.push(
      `${approved.length} purchase needed the owner and was approved in the shop before it settled.`
    );
  }
  if (stats) {
    lines.push(
      `Market data across ${deliveries.length} deliveries: index ranged ${stats.min.toFixed(2)} to ${stats.max.toFixed(2)}, mean ${stats.mean.toFixed(2)}, from ${stats.points} points.`
    );
    const last = deliveries[deliveries.length - 1].series;
    const first = deliveries[0].series;
    const drift = last[last.length - 1] - first[0];
    lines.push(
      `Trend across the run: ${drift >= 0 ? "up" : "down"} ${Math.abs(drift).toFixed(2)} index points from first call to last.`
    );
  }
  for (const r of refused) {
    lines.push(`Refused: "${r.receipt.purpose || r.item.label}" because ${r.receipt.reason}.`);
  }
  lines.push(
    "Every purchase below carries its receipt. Each receipt is an account on devnet that anyone can open."
  );

  return {
    title: task.title,
    summary: lines,
    stats,
    totalSpent,
    counts: { settled: settled.length, approved: approved.length, refused: refused.length },
    ledger: results.map((r) => ({
      label: r.item.label,
      amount: r.receipt.amount,
      status: r.receipt.status,
      reason: r.receipt.reason,
      receipt: r.receipt.key,
      delivered: r.delivery ? r.delivery.delivered : null,
      digest: r.delivery ? r.delivery.digest : null,
    })),
  };
}
