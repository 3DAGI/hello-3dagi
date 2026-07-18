// ============================================================
// Program client for the Pixel Drag Racer Anchor program.
// Hand-rolled instruction encoding (borsh) + account decoding so
// the game doesn't need the full Anchor JS SDK. Reads work on any
// platform via RPC; writes go through the Mobile Wallet Adapter.
// ============================================================

import { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { getConnection, getPublicKey, sendIxs, sol } from './solana.js';

// Replace after `anchor keys sync && anchor deploy` (docs/ONCHAIN_PROGRAM.md)
export const PROGRAM_ID = new PublicKey('DmnJq3fTKxCzBAW965MxBGa25H9SmKKgSZ2YVNqQQFrh');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export const FUEL_DECIMALS = 6;
export const BOARD_SIZE = 16;
export const DUEL_STAKES = [25, 100, 500]; // whole FUEL
export const CAR_MODELS = 5;
export const CAR_PRICES_FUEL = [2000, 6500, 18000, 42000, 110000]; // whole FUEL, burned on mint

// sha256("global:<ix>")[0..8] / sha256("account:<name>")[0..8]
const IX = {
  mintCar: [125, 246, 210, 195, 91, 198, 69, 131],
  register: [211, 124, 67, 15, 211, 194, 178, 240],
  submitTime: [31, 215, 161, 190, 201, 5, 137, 131],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  createDuel: [49, 28, 93, 11, 75, 242, 69, 165],
  joinDuel: [7, 247, 76, 103, 101, 139, 254, 61],
  submitDuelTime: [44, 241, 254, 54, 144, 130, 156, 50],
  settleDuel: [148, 90, 251, 130, 217, 144, 190, 239],
  cancelDuel: [83, 124, 224, 237, 235, 44, 38, 57],
};

// ------------------------------------------------------------
// PDAs
// ------------------------------------------------------------
const enc = new TextEncoder();

function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

export const configPda = () => pda([enc.encode('config')]);
export const fuelMintPda = () => pda([enc.encode('fuel')]);
export const carMintPda = (model, index) => pda([enc.encode('carmint'), new Uint8Array([model]), u32le(index)]);
export const boardPda = (season) => pda([enc.encode('season'), u16le(season)]);
export const playerPda = (wallet) => pda([enc.encode('player'), wallet.toBytes()]);
export const duelPda = (creator, seed) => pda([enc.encode('duel'), creator.toBytes(), u32le(seed)]);
export const vaultPda = (duel) => pda([enc.encode('vault'), duel.toBytes()]);

export function ataFor(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ------------------------------------------------------------
// little-endian byte helpers
// ------------------------------------------------------------
function u16le(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
function u32le(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }
function u64le(v) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; }
function cat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

class Reader {
  constructor(data) { this.d = data; this.o = 0; this.v = new DataView(data.buffer, data.byteOffset); }
  skip(n) { this.o += n; }
  u8() { return this.d[this.o++]; }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  u64() { const x = this.v.getBigUint64(this.o, true); this.o += 8; return Number(x); }
  i64() { const x = this.v.getBigInt64(this.o, true); this.o += 8; return Number(x); }
  pubkey() { const k = new PublicKey(this.d.slice(this.o, this.o + 32)); this.o += 32; return k; }
  option(fn) { return this.u8() ? fn.call(this) : null; }
}

// ------------------------------------------------------------
// Account fetch + decode
// ------------------------------------------------------------
async function fetchAccount(pubkey) {
  const info = await getConnection().getAccountInfo(pubkey);
  return info ? new Uint8Array(info.data) : null;
}

export async function getConfig() {
  const data = await fetchAccount(configPda());
  if (!data) return null;
  const r = new Reader(data);
  r.skip(8);
  const cfg = {
    admin: r.pubkey(),
    mint: r.pubkey(),
    season: r.u16(),
    seasonDuration: r.i64(),
    seasonEnd: r.i64(),
    baseReward: r.u64(),
    referralBps: r.u16(),
    carsMinted: [],
  };
  for (let i = 0; i < CAR_MODELS; i++) cfg.carsMinted.push(r.u32());
  return cfg;
}

export async function getBoard(season) {
  const data = await fetchAccount(boardPda(season));
  if (!data) return null;
  const r = new Reader(data);
  r.skip(8);
  const out = { season: r.u16(), entries: [] };
  for (let i = 0; i < BOARD_SIZE; i++) {
    const wallet = r.pubkey();
    const etMs = r.u32();
    const car = r.u8();
    const ts = r.i64();
    if (!wallet.equals(PublicKey.default)) {
      out.entries.push({ wallet: wallet.toBase58(), etMs, car, ts });
    }
  }
  out.entries.sort((a, b) => a.etMs - b.etMs);
  return out;
}

export async function getPlayer(wallet) {
  const data = await fetchAccount(playerPda(wallet));
  if (!data) return null;
  const r = new Reader(data);
  r.skip(8);
  return {
    wallet: r.pubkey(),
    referrer: r.option(Reader.prototype.pubkey),
    season: r.u16(),
    bestEtMs: r.u32(),
    races: r.u32(),
    claimable: r.u64(),
    referralCount: r.u32(),
    referralEarned: r.u64(),
  };
}

export async function getDuel(creator, seed) {
  const addr = duelPda(creator, seed);
  const data = await fetchAccount(addr);
  if (!data) return null;
  const r = new Reader(data);
  r.skip(8);
  return {
    address: addr,
    seed: r.u32(),
    creator: r.pubkey(),
    opponent: r.pubkey(),
    stake: r.u64(),
    creatorEtMs: r.u32(),
    opponentEtMs: r.u32(),
    deadline: r.i64(),
    settled: !!r.u8(),
  };
}

export async function getFuelBalance(owner) {
  try {
    const res = await getConnection().getTokenAccountBalance(ataFor(owner, fuelMintPda()));
    return Number(res.value.amount) / 10 ** FUEL_DECIMALS;
  } catch {
    return 0; // ATA does not exist yet
  }
}

// ------------------------------------------------------------
// Instruction builders (account order mirrors the Rust contexts;
// Anchor encodes absent optional accounts as the program id)
// ------------------------------------------------------------
function ix(disc, args, keys) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data: cat(new Uint8Array(disc), args),
  });
}
const k = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });

export function registerIx(authority, referrer) {
  const args = referrer ? cat(new Uint8Array([1]), referrer.toBytes()) : new Uint8Array([0]);
  return ix(IX.register, args, [
    k(authority, true, true),
    k(configPda()),
    k(playerPda(authority), true),
    referrer ? k(playerPda(referrer), true) : k(PROGRAM_ID),
    k(SystemProgram.programId),
  ]);
}

export function submitTimeIx(authority, season, etMs, car, referrer) {
  return ix(IX.submitTime, cat(u32le(etMs), new Uint8Array([car])), [
    k(authority, false, true),
    k(configPda()),
    k(playerPda(authority), true),
    k(boardPda(season), true),
    referrer ? k(playerPda(referrer), true) : k(PROGRAM_ID),
  ]);
}

export function claimIx(authority) {
  const mint = fuelMintPda();
  return ix(IX.claim, new Uint8Array(0), [
    k(authority, true, true),
    k(configPda()),
    k(mint, true),
    k(playerPda(authority), true),
    k(ataFor(authority, mint), true),
    k(SystemProgram.programId),
    k(TOKEN_PROGRAM_ID),
    k(ASSOCIATED_TOKEN_PROGRAM_ID),
  ]);
}

export function createDuelIx(authority, seed, stakeFuel) {
  const mint = fuelMintPda();
  const duel = duelPda(authority, seed);
  const stake = BigInt(Math.round(stakeFuel * 10 ** FUEL_DECIMALS));
  return ix(IX.createDuel, cat(u32le(seed), u64le(stake)), [
    k(authority, true, true),
    k(configPda()),
    k(mint),
    k(duel, true),
    k(vaultPda(duel), true),
    k(ataFor(authority, mint), true),
    k(SystemProgram.programId),
    k(TOKEN_PROGRAM_ID),
    k(SYSVAR_RENT_PUBKEY),
  ]);
}

export function joinDuelIx(authority, creator, seed) {
  const duel = duelPda(creator, seed);
  return ix(IX.joinDuel, new Uint8Array(0), [
    k(authority, true, true),
    k(duel, true),
    k(vaultPda(duel), true),
    k(ataFor(authority, fuelMintPda()), true),
    k(TOKEN_PROGRAM_ID),
  ]);
}

export function submitDuelTimeIx(authority, creator, seed, etMs) {
  return ix(IX.submitDuelTime, u32le(etMs), [
    k(authority, false, true),
    k(duelPda(creator, seed), true),
  ]);
}

export function settleDuelIx(payer, duelState) {
  const mint = fuelMintPda();
  const duel = duelState.address;
  return ix(IX.settleDuel, new Uint8Array(0), [
    k(payer, false, true),
    k(configPda()),
    k(mint, true),
    k(duel, true),
    k(vaultPda(duel), true),
    k(ataFor(duelState.creator, mint), true),
    k(ataFor(duelState.opponent, mint), true),
    k(TOKEN_PROGRAM_ID),
  ]);
}

export function cancelDuelIx(authority, seed) {
  const duel = duelPda(authority, seed);
  return ix(IX.cancelDuel, new Uint8Array(0), [
    k(authority, true, true),
    k(duel, true),
    k(vaultPda(duel), true),
    k(ataFor(authority, fuelMintPda()), true),
    k(TOKEN_PROGRAM_ID),
  ]);
}

export function mintCarIx(buyer, model, index) {
  const fuel = fuelMintPda();
  const carMint = carMintPda(model, index);
  const metadata = PublicKey.findProgramAddressSync(
    [enc.encode('metadata'), METADATA_PROGRAM_ID.toBytes(), carMint.toBytes()],
    METADATA_PROGRAM_ID
  )[0];
  const edition = PublicKey.findProgramAddressSync(
    [enc.encode('metadata'), METADATA_PROGRAM_ID.toBytes(), carMint.toBytes(), enc.encode('edition')],
    METADATA_PROGRAM_ID
  )[0];
  return ix(IX.mintCar, new Uint8Array([model]), [
    k(buyer, true, true),
    k(configPda(), true),
    k(fuel, true),
    k(ataFor(buyer, fuel), true),
    k(carMint, true),
    k(ataFor(buyer, carMint), true),
    k(metadata, true),
    k(edition, true),
    k(METADATA_PROGRAM_ID),
    k(TOKEN_PROGRAM_ID),
    k(ASSOCIATED_TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
    k(SYSVAR_RENT_PUBKEY),
  ]);
}

// Which car models does this wallet hold as NFTs? Enumerates the
// program's car mints (bounded by carsMinted) and checks the owner's
// ATAs in batches — no indexer/DAS needed.
export async function getOwnedCarModels(owner, cfg) {
  const models = new Set();
  const connection = getConnection();
  const checks = [];
  for (let model = 0; model < CAR_MODELS; model++) {
    const count = Math.min(cfg.carsMinted[model] || 0, 64);
    for (let i = 0; i < count; i++) {
      checks.push({ model, ata: ataFor(owner, carMintPda(model, i)) });
    }
  }
  for (let o = 0; o < checks.length; o += 100) {
    const slice = checks.slice(o, o + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map(c => c.ata));
    infos.forEach((info, j) => {
      if (!info || info.data.length < 72) return;
      const amount = new DataView(
        info.data.buffer, info.data.byteOffset + 64, 8
      ).getBigUint64(0, true);
      if (amount >= 1n) models.add(slice[j].model);
    });
  }
  return [...models];
}

// ------------------------------------------------------------
// High-level flows used by the game UI
// ------------------------------------------------------------

// Submits a time; registers the player first when needed (applying
// the pending referrer, if any). Returns tx signature or ''.
export async function submitTimeOnChain(etMs, car, pendingReferrer) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  const cfg = await getConfig();
  if (!cfg) { sol.error = 'PROGRAM NOT LIVE'; return ''; }
  const player = await getPlayer(me);
  const ixs = [];
  let referrer = player ? player.referrer : null;
  if (!player) {
    let ref = null;
    try { if (pendingReferrer) ref = new PublicKey(pendingReferrer); } catch {}
    if (ref && !(await getPlayer(ref))) ref = null; // referrer must exist
    ixs.push(registerIx(me, ref));
    referrer = ref;
  }
  ixs.push(submitTimeIx(me, cfg.season, etMs, car, referrer));
  return await sendIxs(ixs);
}

export async function claimFuel() {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  return await sendIxs([claimIx(me)]);
}

// Mints the given car model as an NFT (price burned in FUEL).
export async function mintCarNft(model) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  const cfg = await getConfig();
  if (!cfg) { sol.error = 'PROGRAM NOT LIVE'; return ''; }
  return await sendIxs([mintCarIx(me, model, cfg.carsMinted[model] || 0)]);
}

export async function registerWithReferrer(pendingReferrer) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  if (await getPlayer(me)) { sol.error = 'ALREADY REGISTERED'; return ''; }
  let ref = null;
  try { if (pendingReferrer) ref = new PublicKey(pendingReferrer); } catch { sol.error = 'BAD ADDRESS'; return ''; }
  if (ref && !(await getPlayer(ref))) { sol.error = 'REFERRER NOT REGISTERED'; return ''; }
  return await sendIxs([registerIx(me, ref)]);
}
