// Shared chain access for the krypt-solana agent, attacks, and vendor.
// One place holds the keypair parsing, the program loader, and the PDA
// derivations, so every script agrees on what the addresses are.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bs58 from "bs58";
import BN from "bn.js";
import * as anchor from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", ".env") });

export const {
  RPC_URL = "https://api.devnet.solana.com",
  PROGRAM_ID,
  DEMO_USD_PER_SOL = "200",
} = process.env;

if (!PROGRAM_ID) {
  console.error("PROGRAM_ID missing in agent/.env");
  process.exit(1);
}

export const programId = new PublicKey(PROGRAM_ID);
export const connection = new Connection(RPC_URL, "confirmed");
export const LAMPORTS_PER_SOL = 1_000_000_000;

// Anchor 1.x TypeScript wants u64 instruction args as BN, not plain numbers.
export const bn = (n) => new BN(n);

// Demo money knobs, locked 2026-11-06. Lamports.
export const CALL_PRICE = 2_000_000;   // 0.002 SOL, one data call
export const CAP = 50_000_000;        // 0.05 SOL per purchase
export const AUTO = 10_000_000;       // 0.01 SOL auto-approve line
export const BUDGET = 200_000_000;    // 0.2 SOL for the run
export const PREMIUM = 30_000_000;    // 0.03 SOL, queues for the owner
export const BUNDLE = 80_000_000;     // 0.08 SOL, above cap, refused

export const STATUS = {
  0: "SETTLED",
  1: "QUEUED",
  2: "REFUSED",
  3: "APPROVED",
  4: "OWNER_REFUSED",
};

export function usd(lamports) {
  const sol = lamports / LAMPORTS_PER_SOL;
  return `$${(sol * Number(DEMO_USD_PER_SOL)).toFixed(4)}`;
}

export function sol(lamports) {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}

// A secret is either a JSON byte array (solana-keygen file content) or a
// base58 string. Both are accepted so nobody has to convert by hand.
export function keypairFromEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    console.error(`${name} missing in agent/.env`);
    process.exit(1);
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

export const owner = keypairFromEnv("OWNER_KEY");
export const agent = keypairFromEnv("AGENT_KEY");
export const vendor1 = keypairFromEnv("VENDOR1_KEY");
export const vendor2 = keypairFromEnv("VENDOR2_KEY");
export const rogue = keypairFromEnv("VENDOR_ROGUE_KEY");

function loadProgram(wallet) {
  const idlPath = path.join(here, "..", "idl", "krypt_solana.json");
  if (!fs.existsSync(idlPath)) {
    console.error(
      "IDL missing at agent/idl/krypt_solana.json. Copy it from the build: " +
        "WSL ~/krypt-solana/target/idl/krypt_solana.json"
    );
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  idl.address = PROGRAM_ID;
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  return new anchor.Program(idl, provider);
}

export const asOwner = () => loadProgram(owner);
export const asAgent = () => loadProgram(agent);
export const asRogue = () => loadProgram(rogue);

// PDAs, mirrored from the Rust seeds.
export function vaultPda(ownerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), ownerPubkey.toBuffer()],
    programId
  )[0];
}

export function receiptPda(vaultPubkey, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(counter));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPubkey.toBuffer(), buf],
    programId
  )[0];
}

export const VAULT = vaultPda(owner.publicKey);

export async function readVault() {
  return asOwner().account.vault.fetch(VAULT);
}

export async function readReceipt(pubkey) {
  const r = await asOwner().account.receipt.fetch(pubkey);
  return {
    counter: Number(r.counter),
    payee: r.payee.toBase58(),
    amount: Number(r.amount),
    status: STATUS[r.status] ?? `UNKNOWN(${r.status})`,
    purpose: unpack(r.purpose),
    reason: unpack(r.reason),
    ts: Number(r.ts),
  };
}

export async function listReceipts() {
  const all = await asOwner().account.receipt.all([
    { memcmp: { offset: 8, bytes: VAULT.toBase58() } },
  ]);
  const rows = all.map(({ publicKey, account }) => ({
    key: publicKey.toBase58(),
    counter: Number(account.counter),
    payee: account.payee.toBase58(),
    amount: Number(account.amount),
    status: STATUS[account.status] ?? `UNKNOWN(${account.status})`,
    purpose: unpack(account.purpose),
    reason: unpack(account.reason),
    ts: Number(account.ts),
  }));
  rows.sort((a, b) => a.counter - b.counter);
  return rows;
}

function unpack(buf) {
  const bytes = Buffer.from(buf);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
}

export function explorerTx(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddr(addr) {
  const a = typeof addr === "string" ? addr : addr.toBase58();
  return `https://explorer.solana.com/address/${a}?cluster=devnet`;
}

// Print one decision the way the demo prints it: status, amount, reason,
// and the explorer link that proves it is on-chain.
export function printDecision(label, receipt, sig) {
  console.log(
    `${label}: ${receipt.status} ${sol(receipt.amount)} (${usd(receipt.amount)})`
  );
  console.log(`  reason: ${receipt.reason}`);
  if (sig) console.log(`  tx: ${explorerTx(sig)}`);
}
