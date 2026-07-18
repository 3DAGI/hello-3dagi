#!/usr/bin/env node
// ============================================================
// Rate keeper — fetches live SOL/SKR prices and updates the
// program's exchange rates via set_rates when they drift.
//
// Usage:
//   ADMIN_KEYPAIR=~/.config/solana/id.json \
//   RPC_URL=https://api.devnet.solana.com \
//   node scripts/update-rates.mjs [--dry-run] [--threshold-bps 500]
//
// Run manually, via cron, or via the update-rates GitHub workflow.
// ============================================================

import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('DmnJq3fTKxCzBAW965MxBGa25H9SmKKgSZ2YVNqQQFrh');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const FUEL_USD = 0.001; // keep in sync with src/prices.js
const SKR_DISCOUNT_BPS = 1000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const thIdx = args.indexOf('--threshold-bps');
const thresholdBps = thIdx >= 0 ? parseInt(args[thIdx + 1], 10) : 500; // 5%

const rpc = process.env.RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(rpc, 'confirmed');
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];

function disc(name) {
  return crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}

// --- read on-chain config ---
const info = await connection.getAccountInfo(configPda);
if (!info) {
  console.error('config not found - is the program initialized on', rpc, '?');
  process.exit(1);
}
const d = info.data;
// layout after the 8-byte discriminator: admin(32) mint(32) season(2)
// dur(8) end(8) base(8) refbps(2) cars(5*4) skr_mint(32) treasury(32)
// sol_rate(8) skr_rate(8) ...
const skrMint = new PublicKey(d.subarray(8 + 112, 8 + 144)).toBase58();
const view = new DataView(d.buffer, d.byteOffset);
const curSolRate = Number(view.getBigUint64(8 + 176, true));
const curSkrRate = Number(view.getBigUint64(8 + 184, true));
console.log('on-chain: sol_rate', curSolRate, 'skr_rate', curSkrRate, 'skr mint', skrMint);

// --- live prices (Jupiter v3, CoinGecko fallback for SOL) ---
let solUsd = 0, skrUsd = 0;
try {
  const data = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT},${skrMint}`);
  solUsd = data[SOL_MINT]?.usdPrice || 0;
  skrUsd = data[skrMint]?.usdPrice || 0;
} catch (e) {
  console.warn('jupiter failed:', e.message);
}
if (!solUsd) {
  const cg = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
  solUsd = cg.solana?.usd || 0;
}
if (!solUsd) {
  console.error('no SOL price available');
  process.exit(1);
}
console.log('live: SOL $' + solUsd.toFixed(2), skrUsd ? 'SKR $' + skrUsd.toFixed(4) : 'SKR (no market data, keeping rate)');

// --- derive target rates from the FUEL peg ---
const newSolRate = Math.round(FUEL_USD / solUsd * 1e9);
const newSkrRate = skrUsd > 0 ? Math.round(FUEL_USD / skrUsd * 1e6) : curSkrRate;
const drift = (a, b) => (b > 0 ? Math.abs(a - b) * 10_000 / b : 0);
const maxDrift = Math.max(drift(curSolRate, newSolRate), drift(curSkrRate, newSkrRate));
console.log('target: sol_rate', newSolRate, 'skr_rate', newSkrRate,
  '- drift', (maxDrift / 100).toFixed(1) + '%', '(threshold', thresholdBps / 100 + '%)');

if (maxDrift < thresholdBps) {
  console.log('within threshold - nothing to do');
  process.exit(0);
}
if (dryRun) {
  console.log('dry run - would call set_rates');
  process.exit(0);
}

// --- send set_rates as the admin ---
const kpPath = process.env.ADMIN_KEYPAIR;
if (!kpPath) {
  console.error('set ADMIN_KEYPAIR to the admin keypair json path');
  process.exit(1);
}
const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(kpPath, 'utf8'))));
const data = Buffer.alloc(8 + 8 + 8 + 2);
disc('set_rates').copy(data, 0);
data.writeBigUInt64LE(BigInt(newSolRate), 8);
data.writeBigUInt64LE(BigInt(newSkrRate), 16);
data.writeUInt16LE(SKR_DISCOUNT_BPS, 24);
const ixn = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: false },
    { pubkey: configPda, isSigner: false, isWritable: true },
  ],
  data,
});
const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ixn), [admin]);
console.log('rates updated:', sig);
