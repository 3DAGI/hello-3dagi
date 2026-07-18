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
export const CAR_PRICES_FUEL = [2000, 6500, 18000, 42000, 110000]; // whole FUEL
export const PACK_PRICES_FUEL = [250, 800, 2000]; // whole FUEL
export const BOSS_REWARDS_FUEL = [25, 50, 100, 250]; // whole FUEL

// payment currencies: FUEL burns, SOL/SKR split pool/treasury
export const CUR_FUEL = 0, CUR_SOL = 1, CUR_SKR = 2;
export const CUR_NAMES = ['FUEL', 'SOL', 'SKR'];

export function solCost(cfg, fuelWhole) {
  return fuelWhole * 1e6 * cfg.solRate / 1e6 / 1e9; // → SOL
}
export function skrCost(cfg, fuelWhole) {
  const raw = fuelWhole * 1e6 * cfg.skrRate / 1e6;
  return raw * (10000 - cfg.skrDiscountBps) / 10000 / 1e6; // → whole SKR (6dp assumed for display)
}
export function fmtPrice(cfg, fuelWhole, currency) {
  if (currency === CUR_SOL) return solCost(cfg, fuelWhole).toFixed(3) + ' SOL';
  if (currency === CUR_SKR) return skrCost(cfg, fuelWhole).toFixed(1) + ' SKR';
  return fuelWhole + ' FUEL';
}

// sha256("global:<ix>")[0..8] / sha256("account:<name>")[0..8]
const IX = {
  mintCar: [125, 246, 210, 195, 91, 198, 69, 131],
  setRates: [53, 124, 188, 253, 56, 211, 29, 2],
  buyPack: [151, 46, 141, 93, 174, 5, 49, 173],
  openPack: [75, 203, 144, 65, 63, 253, 103, 85],
  claimCareerBoss: [182, 226, 24, 126, 67, 197, 76, 96],
  listNft: [88, 221, 93, 166, 63, 220, 106, 232],
  buyNft: [96, 0, 28, 190, 49, 107, 83, 222],
  cancelListing: [41, 183, 50, 232, 230, 233, 157, 70],
  queueJoin: [92, 200, 67, 181, 226, 164, 189, 56],
  queueMatch: [251, 238, 110, 237, 158, 151, 221, 12],
  queueLeave: [52, 192, 93, 86, 59, 56, 237, 42],
  submitRankedTime: [223, 56, 168, 66, 18, 176, 96, 194],
  settleRanked: [78, 68, 211, 230, 47, 191, 182, 178],
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
export const queuePda = () => pda([enc.encode('queue')]);
export const qvaultPda = () => pda([enc.encode('qvault')]);
export const matchPda = (a, b) => pda([enc.encode('match'), a.toBytes(), b.toBytes()]);
export const mvaultPda = (m) => pda([enc.encode('mvault'), m.toBytes()]);
export const listingPda = (mint) => pda([enc.encode('listing'), mint.toBytes()]);
export const lvaultPda = (mint) => pda([enc.encode('lvault'), mint.toBytes()]);
export const solPoolPda = () => pda([enc.encode('solpool')]);
export const skrPoolPda = () => pda([enc.encode('skrpool')]);
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
  cfg.skrMint = r.pubkey();
  cfg.treasury = r.pubkey();
  cfg.solRate = r.u64();
  cfg.skrRate = r.u64();
  cfg.skrDiscountBps = r.u16();
  cfg.committedSol = r.u64();
  cfg.committedSkr = r.u64();
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
  const p = {
    wallet: r.pubkey(),
    referrer: r.option(Reader.prototype.pubkey),
    season: r.u16(),
    bestEtMs: r.u32(),
    races: r.u32(),
    claimable: r.u64(),
    referralCount: r.u32(),
    referralEarned: r.u64(),
    rp: r.u16(),
    activeMatch: r.pubkey(),
    claimableSol: r.u64(),
    claimableSkr: r.u64(),
    packCredits: [r.u16(), r.u16(), r.u16()],
    careerBosses: r.u8(),
  };
  if (p.activeMatch.equals(PublicKey.default)) p.activeMatch = null;
  return p;
}

export async function getSolBalance(owner) {
  try { return (await getConnection().getBalance(owner)) / 1e9; } catch { return 0; }
}

export async function getSkrBalance(owner, cfg) {
  try {
    const res = await getConnection().getTokenAccountBalance(ataFor(owner, cfg.skrMint));
    return Number(res.value.uiAmount) || 0;
  } catch { return 0; }
}

export async function getQueue() {
  const data = await fetchAccount(queuePda());
  if (!data) return { slots: [] };
  const r = new Reader(data);
  r.skip(8);
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const player = r.pubkey();
    const rp = r.u16();
    const stake = r.u64();
    const ts = r.i64();
    if (!player.equals(PublicKey.default)) slots.push({ index: i, player, rp, stake, ts });
  }
  return { slots };
}

export async function getMatch(address) {
  const data = await fetchAccount(address);
  if (!data) return null;
  const r = new Reader(data);
  r.skip(8);
  return {
    address,
    a: r.pubkey(),
    b: r.pubkey(),
    stake: r.u64(),
    aEtMs: r.u32(),
    bEtMs: r.u32(),
    deadline: r.i64(),
    settled: !!r.u8(),
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

export function claimIx(authority, cfg) {
  const mint = fuelMintPda();
  return ix(IX.claim, new Uint8Array(0), [
    k(authority, true, true),
    k(configPda(), true),
    k(mint, true),
    k(cfg.skrMint),
    k(playerPda(authority), true),
    k(ataFor(authority, mint), true),
    k(solPoolPda(), true),
    k(skrPoolPda(), true),
    k(ataFor(authority, cfg.skrMint), true),
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

// the optional payment accounts, in context order; unused optionals
// are encoded as the program id (Anchor's "None" convention)
function paymentKeys(buyer, currency, cfg) {
  const fuel = fuelMintPda();
  return [
    currency === CUR_FUEL ? k(ataFor(buyer, fuel), true) : k(PROGRAM_ID),
    k(solPoolPda(), true),
    k(cfg.treasury, true),
    k(skrPoolPda(), true),
    currency === CUR_SKR ? k(ataFor(buyer, cfg.skrMint), true) : k(PROGRAM_ID),
    currency === CUR_SKR ? k(ataFor(cfg.treasury, cfg.skrMint), true) : k(PROGRAM_ID),
  ];
}

export function mintCarIx(buyer, model, index, currency, cfg) {
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
  return ix(IX.mintCar, new Uint8Array([model, currency]), [
    k(buyer, true, true),
    k(configPda(), true),
    k(fuel, true),
    ...paymentKeys(buyer, currency, cfg),
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

export function buyPackIx(buyer, tier, currency, cfg) {
  const fuel = fuelMintPda();
  const pay = paymentKeys(buyer, currency, cfg);
  return ix(IX.buyPack, new Uint8Array([tier, currency]), [
    k(buyer, true, true),
    k(configPda()),
    k(fuel, true),
    k(playerPda(buyer), true),
    ...pay,
    k(TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
  ]);
}

export function openPackIx(authority, tier) {
  return ix(IX.openPack, new Uint8Array([tier]), [
    k(authority, false, true),
    k(playerPda(authority), true),
  ]);
}

export function claimCareerBossIx(authority, boss) {
  return ix(IX.claimCareerBoss, new Uint8Array([boss]), [
    k(authority, false, true),
    k(playerPda(authority), true),
  ]);
}

// Which car NFTs does this wallet hold? Enumerates the program's car
// mints (bounded by carsMinted) and checks the owner's ATAs in
// batches — no indexer/DAS needed. Returns [{model, index, mint}].
export async function getOwnedCarNfts(owner, cfg) {
  const out = [];
  const connection = getConnection();
  const checks = [];
  for (let model = 0; model < CAR_MODELS; model++) {
    const count = Math.min(cfg.carsMinted[model] || 0, 64);
    for (let i = 0; i < count; i++) {
      const mint = carMintPda(model, i);
      checks.push({ model, index: i, mint, ata: ataFor(owner, mint) });
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
      if (amount >= 1n) out.push({ model: slice[j].model, index: slice[j].index, mint: slice[j].mint });
    });
  }
  return out;
}

export async function getOwnedCarModels(owner, cfg) {
  return [...new Set((await getOwnedCarNfts(owner, cfg)).map(n => n.model))];
}

// All open marketplace listings, found by scanning the bounded car
// mint space for listing PDAs.
export async function getListings(cfg) {
  const connection = getConnection();
  const mints = [];
  for (let model = 0; model < CAR_MODELS; model++) {
    const count = Math.min(cfg.carsMinted[model] || 0, 64);
    for (let i = 0; i < count; i++) mints.push({ model, index: i, mint: carMintPda(model, i) });
  }
  const out = [];
  for (let o = 0; o < mints.length; o += 100) {
    const slice = mints.slice(o, o + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map(m => listingPda(m.mint)));
    infos.forEach((info, j) => {
      if (!info) return;
      const r = new Reader(new Uint8Array(info.data));
      r.skip(8);
      out.push({
        seller: r.pubkey(),
        mint: r.pubkey(),
        model: r.u8(),
        price: r.u64(),
        currency: r.u8(),
        ts: r.i64(),
        index: slice[j].index,
      });
    });
  }
  out.sort((a, b) => a.price - b.price);
  return out;
}

// price is in the listing currency's base units
export function listNftIx(seller, model, index, priceUnits, currency) {
  const mint = carMintPda(model, index);
  const price = BigInt(Math.round(priceUnits));
  return ix(IX.listNft, cat(new Uint8Array([model]), u32le(index), u64le(price), new Uint8Array([currency])), [
    k(seller, true, true),
    k(configPda()),
    k(mint),
    k(listingPda(mint), true),
    k(lvaultPda(mint), true),
    k(ataFor(seller, mint), true),
    k(TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
    k(SYSVAR_RENT_PUBKEY),
  ]);
}

export function buyNftIx(buyer, listing, cfg) {
  const fuel = fuelMintPda();
  const cur = listing.currency;
  return ix(IX.buyNft, new Uint8Array(0), [
    k(buyer, true, true),
    k(configPda()),
    k(fuel, true),
    k(listingPda(listing.mint), true),
    k(listing.seller, true),
    k(listing.mint),
    k(lvaultPda(listing.mint), true),
    cur === CUR_FUEL ? k(ataFor(buyer, fuel), true) : k(PROGRAM_ID),
    cur === CUR_FUEL ? k(ataFor(listing.seller, fuel), true) : k(PROGRAM_ID),
    k(solPoolPda(), true),
    k(cfg.treasury, true),
    k(skrPoolPda(), true),
    cur === CUR_SKR ? k(ataFor(buyer, cfg.skrMint), true) : k(PROGRAM_ID),
    cur === CUR_SKR ? k(ataFor(listing.seller, cfg.skrMint), true) : k(PROGRAM_ID),
    cur === CUR_SKR ? k(ataFor(cfg.treasury, cfg.skrMint), true) : k(PROGRAM_ID),
    k(ataFor(buyer, listing.mint), true),
    k(TOKEN_PROGRAM_ID),
    k(ASSOCIATED_TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
  ]);
}

export function cancelListingIx(seller, mint) {
  return ix(IX.cancelListing, new Uint8Array(0), [
    k(seller, true, true),
    k(listingPda(mint), true),
    k(lvaultPda(mint), true),
    k(ataFor(seller, mint), true),
    k(TOKEN_PROGRAM_ID),
  ]);
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
  const cfg = await getConfig();
  if (!cfg) { sol.error = 'PROGRAM NOT LIVE'; return ''; }
  return await sendIxs([claimIx(me, cfg)]);
}

// Buy a pack on-chain in the chosen currency; credit lands on the
// player profile and the game opens it.
export async function buyPackOnChain(tier, currency) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  const cfg = await getConfig();
  if (!cfg) { sol.error = 'PROGRAM NOT LIVE'; return ''; }
  if (!(await getPlayer(me))) { sol.error = 'SUBMIT A TIME FIRST TO REGISTER'; return ''; }
  return await sendIxs([buyPackIx(me, tier, currency, cfg)]);
}

export async function openPackOnChain(tier) {
  const me = getPublicKey();
  if (!me) return '';
  return await sendIxs([openPackIx(me, tier)]);
}

export async function claimCareerBoss(boss) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  if (!(await getPlayer(me))) { sol.error = 'SUBMIT A TIME FIRST TO REGISTER'; return ''; }
  return await sendIxs([claimCareerBossIx(me, boss)]);
}

// ------------------------------------------------------------
// Ranked queue instruction builders + flows
// ------------------------------------------------------------
export const RANKED_STAKE = 50; // whole FUEL

function queueJoinIx(authority, stakeFuel) {
  const fuel = fuelMintPda();
  const stake = BigInt(Math.round(stakeFuel * 10 ** FUEL_DECIMALS));
  return ix(IX.queueJoin, u64le(stake), [
    k(authority, true, true),
    k(configPda()),
    k(fuel),
    k(playerPda(authority)),
    k(queuePda(), true),
    k(qvaultPda(), true),
    k(ataFor(authority, fuel), true),
    k(TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
    k(SYSVAR_RENT_PUBKEY),
  ]);
}

function queueMatchIx(authority, slot) {
  const fuel = fuelMintPda();
  const m = matchPda(slot.player, authority);
  return ix(IX.queueMatch, new Uint8Array([slot.index]), [
    k(authority, true, true),
    k(configPda()),
    k(fuel),
    k(playerPda(authority), true),
    k(playerPda(slot.player), true),
    k(queuePda(), true),
    k(qvaultPda(), true),
    k(m, true),
    k(mvaultPda(m), true),
    k(ataFor(authority, fuel), true),
    k(TOKEN_PROGRAM_ID),
    k(SystemProgram.programId),
    k(SYSVAR_RENT_PUBKEY),
  ]);
}

function queueLeaveIx(authority) {
  return ix(IX.queueLeave, new Uint8Array(0), [
    k(authority, true, true),
    k(queuePda(), true),
    k(qvaultPda(), true),
    k(ataFor(authority, fuelMintPda()), true),
    k(TOKEN_PROGRAM_ID),
  ]);
}

export function submitRankedTimeIx(authority, matchAddress, etMs) {
  return ix(IX.submitRankedTime, u32le(etMs), [
    k(authority, false, true),
    k(matchAddress, true),
  ]);
}

export function settleRankedIx(payer, m) {
  const fuel = fuelMintPda();
  return ix(IX.settleRanked, new Uint8Array(0), [
    k(payer, false, true),
    k(configPda()),
    k(fuel, true),
    k(m.address, true),
    k(mvaultPda(m.address), true),
    k(ataFor(m.a, fuel), true),
    k(ataFor(m.b, fuel), true),
    k(playerPda(m.a), true),
    k(playerPda(m.b), true),
    k(TOKEN_PROGRAM_ID),
  ]);
}

// One-button matchmaking: match a waiting rival inside the band if
// possible, otherwise enqueue. Returns {sig, matched}.
export async function enterRankedQueue() {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return { sig: '', matched: false }; }
  const player = await getPlayer(me);
  if (!player) { sol.error = 'SUBMIT A TIME FIRST TO REGISTER'; return { sig: '', matched: false }; }
  if (player.activeMatch) { sol.error = 'FINISH YOUR MATCH FIRST'; return { sig: '', matched: false }; }
  const queue = await getQueue();
  const now = Date.now() / 1000;
  const candidate = queue.slots.find(s => {
    if (s.player.equals(me)) return false;
    const band = 150 + Math.max(0, Math.floor((now - s.ts) / 60)) * 50;
    return Math.abs(player.rp - s.rp) <= band;
  });
  if (queue.slots.some(s => s.player.equals(me))) {
    sol.error = 'ALREADY IN QUEUE';
    return { sig: '', matched: false };
  }
  if (candidate) {
    const sig = await sendIxs([queueMatchIx(me, candidate)]);
    return { sig, matched: !!sig };
  }
  const sig = await sendIxs([queueJoinIx(me, RANKED_STAKE)]);
  return { sig, matched: false };
}

export async function leaveRankedQueue() {
  const me = getPublicKey();
  if (!me) return '';
  return await sendIxs([queueLeaveIx(me)]);
}

// Mints the given car model as an NFT, paid in the chosen currency.
export async function mintCarNft(model, currency) {
  const me = getPublicKey();
  if (!me) { sol.error = 'CONNECT WALLET FIRST'; return ''; }
  const cfg = await getConfig();
  if (!cfg) { sol.error = 'PROGRAM NOT LIVE'; return ''; }
  return await sendIxs([mintCarIx(me, model, cfg.carsMinted[model] || 0, currency, cfg)]);
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
