// The four errands, in order. This is the demo spine a visitor watches:
// a burst of tiny purchases that all settle, one premium call that queues
// and then gets owner-approved, one over-cap bundle that is refused, and
// one payment to an unlisted vendor that is refused.

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
  listReceipts,
  printDecision,
  sol,
  usd,
  bn,
  connection,
  CALL_PRICE,
  CAP,
  AUTO,
  BUDGET,
  PREMIUM,
  BUNDLE,
  explorerAddr,
} from "./chain.mjs";
import { pathToFileURL } from "node:url";
import { SystemProgram, Transaction } from "@solana/web3.js";

export async function ensureVault() {
  const prog = asOwner();
  let vault;
  try {
    vault = await readVault();
  } catch {
    console.log("no vault yet, initializing");
    await prog.methods
      .initializeVault()
      .accounts({ vault: VAULT, owner: owner.publicKey })
      .rpc();
    vault = await readVault();
  }
  console.log(`vault: ${explorerAddr(VAULT)}`);
  console.log(`rules_set: ${vault.rulesSet}`);

  console.log("setting rules and allowlist");
  await prog.methods
    .setRules(bn(CAP), bn(AUTO), bn(BUDGET))
    .accounts({ vault: VAULT, owner: owner.publicKey })
    .rpc();
  await prog.methods
    .registerAgent(agent.publicKey)
    .accounts({ vault: VAULT, owner: owner.publicKey })
    .rpc();
  for (const payee of [vendor1.publicKey, vendor2.publicKey]) {
    try {
      await prog.methods
        .addPayee(payee)
        .accounts({ vault: VAULT, owner: owner.publicKey })
        .rpc();
    } catch (e) {
      // Already listed is fine; the errands must be re-runnable.
      if (!String(e.message).includes("allowlist")) throw e;
    }
  }

  // Fund the vault once, the way a person tops up a card. The spendable
  // balance is what settles purchases, above the rent the account holds.
  const bal = await connection.getBalance(VAULT);
  if (bal < 300_000_000) {
    console.log("funding the vault with 0.5 SOL from the owner");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: VAULT,
        lamports: 500_000_000,
      })
    );
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(owner);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`vault funded: ${explorerAddr(VAULT)}`);
  }
  return readVault();
}

export async function burst() {
  console.log("\n== errand 1: twenty market calls, each below the line ==");
  const prog = asAgent();
  const before = await readVault();
  const start = Number(before.receiptCounter);
  for (let i = 0; i < 20; i++) {
    const sig = await prog.methods
      .requestSpend(bn(CALL_PRICE), `market call ${i + 1}/20`)
      .accounts({
        vault: VAULT,
        agent: agent.publicKey,
        payee: vendor1.publicKey,
      })
      .rpc();
    const r = await readReceipt(receiptPda(VAULT, start + i));
    printDecision(`call ${String(i + 1).padStart(2, "0")}`, r, sig);
  }
}

export async function premiumThenApprove() {
  console.log("\n== errand 2: premium digest, above the line, then approved ==");
  const progA = asAgent();
  const before = await readVault();
  const counter = Number(before.receiptCounter);
  const sig = await progA.methods
    .requestSpend(bn(PREMIUM), "premium research digest")
    .accounts({
      vault: VAULT,
      agent: agent.publicKey,
      payee: vendor2.publicKey,
    })
    .rpc();
  const rp = receiptPda(VAULT, counter);
  let r = await readReceipt(rp);
  printDecision("premium request", r, sig);

  console.log("owner approves the queued request");
  const progO = asOwner();
  const sig2 = await progO.methods
    .approveSpend()
    .accounts({
      vault: VAULT,
      owner: owner.publicKey,
      receipt: rp,
      payee: vendor2.publicKey,
    })
    .rpc();
  r = await readReceipt(rp);
  printDecision("after approval", r, sig2);
}

export async function overCap() {
  console.log("\n== errand 3: the full archive bundle, above the cap ==");
  const prog = asAgent();
  const before = await readVault();
  const sig = await prog.methods
    .requestSpend(bn(BUNDLE), "full archive bundle")
    .accounts({
      vault: VAULT,
      agent: agent.publicKey,
      payee: vendor1.publicKey,
    })
    .rpc();
  const r = await readReceipt(receiptPda(VAULT, Number(before.receiptCounter)));
  printDecision("bundle", r, sig);
}

export async function unlistedPayee() {
  console.log("\n== errand 4: pay a vendor that was never approved ==");
  const prog = asAgent();
  const before = await readVault();
  const sig = await prog.methods
    .requestSpend(bn(CALL_PRICE), "pay an unlisted vendor")
    .accounts({
      vault: VAULT,
      agent: agent.publicKey,
      payee: rogue.publicKey,
    })
    .rpc();
  const r = await readReceipt(receiptPda(VAULT, Number(before.receiptCounter)));
  printDecision("unlisted", r, sig);
}

async function main() {
  const v0 = await ensureVault();
  console.log(`spent so far: ${sol(Number(v0.spent))} (${usd(Number(v0.spent))})`);
  await burst();
  await premiumThenApprove();
  await overCap();
  await unlistedPayee();

  const v1 = await readVault();
  console.log(`\nspent after errands: ${sol(Number(v1.spent))} (${usd(Number(v1.spent))})`);
  console.log("receipts on chain:");
  for (const r of await listReceipts()) {
    console.log(
      `  #${String(r.counter).padStart(2, "0")} ${r.status.padEnd(13)} ${sol(r.amount).padStart(14)}  ${r.purpose}  | ${r.reason}`
    );
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((e) => {
    console.error("errands failed:", e.message);
    process.exit(1);
  });
}
