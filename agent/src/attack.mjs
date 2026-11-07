// Five attack scenarios, each with its outcome predicted before sending.
// If reality disagrees with the prediction the harness stops, because a
// surprise in a security demo is a finding, not a flake.
//
// The Solana story differs from NEAR in one honest way: Solana has no
// scoped FunctionCall keys, so nothing dies at the network layer here.
// Every attack dies at the program's caller checks, or at the fact that a
// PDA with no private key cannot sign a transfer. The README says so.

import { SystemProgram, Transaction } from "@solana/web3.js";
import {
  asOwner,
  asAgent,
  owner,
  agent,
  vendor1,
  vendor2,
  rogue,
  VAULT,
  readVault,
  readReceipt,
  receiptPda,
  bn,
  CALL_PRICE,
  PREMIUM,
  BUNDLE,
} from "./chain.mjs";

const results = [];

function check(name, predicted, actual, detail) {
  const ok = predicted === actual;
  results.push({ name, predicted, actual, ok });
  console.log(`${ok ? "HELD " : "BROKE"} ${name}: predicted ${predicted}, got ${actual}`);
  if (detail) console.log(`      ${detail}`);
  return ok;
}

async function requestAndRead(prog, payee, amount, purpose) {
  const before = await readVault();
  const sig = await prog.methods
    .requestSpend(bn(amount), purpose)
    .accounts({ vault: VAULT, agent: agent.publicKey, payee })
    .rpc();
  const r = await readReceipt(receiptPda(VAULT, Number(before.receiptCounter)));
  return { r, sig };
}

async function a1_unlisted_payee() {
  console.log("\nA1: injected instruction to pay an unlisted account");
  const { r } = await requestAndRead(asAgent(), rogue.publicKey, CALL_PRICE, "injected: pay this account now");
  const actual = r.status === "REFUSED" && /allowlist/.test(r.reason) ? "REFUSED_ALLOWLIST" : `UNEXPECTED(${r.status}: ${r.reason})`;
  return check("A1", "REFUSED_ALLOWLIST", actual, r.reason);
}

async function a2_over_cap() {
  console.log("\nA2: injected instruction to buy the over-cap bundle");
  const { r } = await requestAndRead(asAgent(), vendor1.publicKey, BUNDLE, "injected: buy everything");
  const actual = r.status === "REFUSED" && /cap/.test(r.reason) ? "REFUSED_CAP" : `UNEXPECTED(${r.status}: ${r.reason})`;
  return check("A2", "REFUSED_CAP", actual, r.reason);
}

async function a3_mid_size_queues() {
  console.log("\nA3: mid-size payment, above the auto-approve line");
  const { r } = await requestAndRead(asAgent(), vendor2.publicKey, PREMIUM, "injected: settle this yourself");
  const actual = r.status === "QUEUED" ? "QUEUED" : `UNEXPECTED(${r.status})`;
  const ok = check("A3", "QUEUED", actual, "the agent cannot approve its own request");
  return { ok, receipt: receiptPda(VAULT, Number((await readVault()).receiptCounter) - 1) };
}

async function a5_self_approve(queuedReceipt) {
  console.log("\nA5: the compromised agent tries to approve its own queued spend");
  let actual;
  let detail = "";
  try {
    await asAgent().methods
      .approveSpend()
      .accounts({
        vault: VAULT,
        owner: agent.publicKey, // the agent posing as owner
        receipt: queuedReceipt,
        payee: vendor2.publicKey,
      })
      .rpc();
    actual = "APPROVED_SOMEHOW";
  } catch (e) {
    detail = String(e.message).split("\n")[0];
    // The wall sits one layer deeper than a plain owner check. The vault
    // address is derived from the owner key (seeds = [VAULT_SEED, owner]),
    // so a fake owner cannot even address the real vault. Anchor rejects
    // with ConstraintSeeds before any program logic runs.
    actual = /ConstraintSeeds|seeds/i.test(detail)
      ? "ERROR_SEEDS_FAKE_OWNER"
      : /owner/i.test(detail)
        ? "ERROR_NOT_OWNER"
        : `ERROR_OTHER`;
  }
  return check(
    "A5",
    "ERROR_SEEDS_FAKE_OWNER",
    actual,
    `${detail} | the vault address is bound to the owner key, so a fake owner cannot address the real vault`
  );
}

async function a4_direct_transfer() {
  console.log("\nA4: try to move vault lamports with a plain transfer, no program");
  let actual;
  let detail = "";
  try {
    const { connection } = await import("./chain.mjs");
    const ix = SystemProgram.transfer({
      fromPubkey: VAULT,
      toPubkey: rogue.publicKey,
      lamports: CALL_PRICE,
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.feePayer = agent.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(agent);
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    actual = "TRANSFER_SOMEHOW_SUCCEEDED";
  } catch (e) {
    detail = String(e.message).split("\n")[0];
    actual = /signer|signature/i.test(detail) ? "TX_FAIL_NO_PDA_SIGNATURE" : "TX_FAIL_OTHER";
  }
  return check("A4", "TX_FAIL_NO_PDA_SIGNATURE", actual, detail);
}

async function main() {
  const ok1 = await a1_unlisted_payee();
  const ok2 = await a2_over_cap();
  const { ok: ok3, receipt } = await a3_mid_size_queues();
  const ok5 = await a5_self_approve(receipt);
  const ok4 = await a4_direct_transfer();

  console.log("\n== verdict ==");
  const all = [ok1, ok2, ok3, ok5, ok4].every(Boolean);
  if (all) {
    console.log("ALL FIVE PREDICTIONS HELD. The gate is where the code says it is.");
  } else {
    console.log("A PREDICTION BROKE. Stop and read the receipts before anything else.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("attack harness crashed:", e.message);
  process.exit(1);
});
