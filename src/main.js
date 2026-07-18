// ============================================================
// PIXEL DRAG RACER — mobile drag racing (landscape)
// Cars, career mode, named upgrade parts, NOS, tachometer,
// manual gearbox, christmas-tree start, quarter mile.
// ============================================================

import { sol, mwaSupported, connectWallet, disconnectWallet, postRecord, CLUSTER, getPublicKey } from './solana.js';
import {
  getConfig, getBoard, getPlayer, getDuel, getFuelBalance,
  submitTimeOnChain, claimFuel, registerWithReferrer,
  createDuelIx, joinDuelIx, submitDuelTimeIx, settleDuelIx, cancelDuelIx,
  mintCarNft, getOwnedCarNfts, getListings, listNftIx, buyNftIx, cancelListingIx,
  getQueue, getMatch, enterRankedQueue, leaveRankedQueue,
  submitRankedTimeIx, settleRankedIx, RANKED_STAKE,
  DUEL_STAKES, FUEL_DECIMALS, CAR_PRICES_FUEL, CAR_MODELS,
} from './chain.js';
import { sendIxs } from './solana.js';
import { PublicKey } from '@solana/web3.js';

const W = 480;
const H = 270;
const QUARTER_MILE = 402.336; // meters

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ============================================================
// CARS — stats + pixel sprites (facing right)
// sprite chars: b body, h accent, d dark, w window, x detail, . empty
// ============================================================
const CARS = [
  {
    id: 'hatch', name: 'HATCH 86', price: 0, etHint: 16.2,
    mass: 1040, torque: 148, redline: 7200, limiter: 7800,
    gears: [3.45, 2.05, 1.42, 1.06, 0.85], finalDrive: 4.1,
    traction: 6800, drag: 0.42, wheelRadius: 0.29,
    pal: { b: '#e0a63a', h: '#f4d06f', d: '#8a6420', w: '#aee6ff' },
    wheels: [{ x: 4, s: 5 }, { x: 19, s: 5 }], wheelY: 8,
    sprite: [
      '..........dddddddd..........',
      '........ddbwwwwwwbdd........',
      '.......dbbwwwwwwwwbbd.......',
      '......dbbbwwwwwwwwbbbd......',
      '...ddbbbbbbbbbbbbbbbbbdd....',
      '..dbbbbbbbbbbbbbbbbbbbbbd...',
      '.dbhhhhhhhhhhhhhhhhhhhhbdd..',
      '.dbbbbbbbbbbbbbbbbbbbbbbbd..',
      '.ddbbbbbbbbbbbbbbbbbbbbbdd..',
      '..dbbbbbbbbbbbbbbbbbbbbbd...',
    ],
  },
  {
    id: 'muscle', name: 'ROAD KING V8', price: 6500, etHint: 13.9,
    mass: 1480, torque: 395, redline: 6300, limiter: 6900,
    gears: [2.90, 1.95, 1.42, 1.08, 0.88], finalDrive: 3.5,
    traction: 9800, drag: 0.50, wheelRadius: 0.33,
    pal: { b: '#2a4fd0', h: '#e8e8f4', d: '#16255e', w: '#cfe8ff' },
    wheels: [{ x: 5, s: 6 }, { x: 26, s: 6 }], wheelY: 7,
    sprite: [
      '.............ddddddddd..............',
      '............dbwwwwwwwbdd............',
      '...........dbbwwwwwwwbbbd...........',
      '....dddddddbbbbbbbbbbbbbxxddddd.....',
      '..ddbbbbbbbbbbbbbbbbbbbbxxbbbbdd....',
      '.dbbhhbbbbbbbbbbbbbbbbbbbbbbhhbbd...',
      '.dbbhhbbbbbbbbbbbbbbbbbbbbbbhhbbd...',
      '.dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd...',
      '.ddbbbbbbbbbbbbbbbbbbbbbbbbbbbbdd...',
    ],
  },
  {
    id: 'jdm', name: 'RX TURBO', price: 18000, etHint: 12.2,
    mass: 1230, torque: 330, redline: 8400, limiter: 9000,
    gears: [3.50, 2.30, 1.72, 1.34, 1.08, 0.90], finalDrive: 3.9,
    traction: 9200, drag: 0.37, wheelRadius: 0.31,
    pal: { b: '#e8e8f0', h: '#e03a3a', d: '#8890a0', w: '#88d4ff' },
    wheels: [{ x: 5, s: 5 }, { x: 24, s: 5 }], wheelY: 8,
    sprite: [
      '..dd..............................',
      '..dddd............................',
      '...dd........ddddddddd............',
      '...........ddbwwwwwwwbdd..........',
      '....dddddbbbbwwwwwwwwwbbddd.......',
      '..ddbbbbbbbbbbbbbbbbbbbbbbbddd....',
      '.dbbbbbbbbbbbbbbbbbbbbbbbbbbbbdd..',
      '.dhhhhhhhhhhhhhhhhhhhhhhhhhhhhbd..',
      '.dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd..',
      '.ddbbbbbbbbbbbbbbbbbbbbbbbbbbbdd..',
    ],
  },
  {
    id: 'super', name: 'VIPER GT', price: 42000, etHint: 11.3,
    mass: 1320, torque: 465, redline: 8600, limiter: 9200,
    gears: [3.20, 2.15, 1.65, 1.30, 1.05, 0.86], finalDrive: 3.6,
    traction: 12000, drag: 0.33, wheelRadius: 0.33,
    pal: { b: '#e03a3a', h: '#181820', d: '#8c1f1f', w: '#aee6ff' },
    wheels: [{ x: 5, s: 5 }, { x: 26, s: 5 }], wheelY: 7,
    sprite: [
      '..xxxx..............................',
      '..xxxxx.............................',
      '....dd..........ddddddddddd.........',
      '.......dddddddbbwwwwwwwwwbbddd......',
      '....ddbbbbbbbbbbwwwwwwwwwbbbbbddd...',
      '..dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbdd..',
      '.dbhhbbbbbbbbbbbbbbbbbbbbbbbbhhbbd..',
      '.dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd..',
      '.ddbbbbbbbbbbbbbbbbbbbbbbbbbbbbbdd..',
    ],
  },
  {
    id: 'dragster', name: 'TOP FUEL X', price: 110000, etHint: 8.8,
    mass: 880, torque: 1025, redline: 9200, limiter: 9800,
    gears: [2.40, 1.60, 1.15, 0.90], finalDrive: 3.0,
    traction: 22000, drag: 0.55, wheelRadius: 0.45,
    pal: { b: '#9a5cff', h: '#ffd166', d: '#4b2a80', w: '#aee6ff' },
    wheels: [{ x: 3, s: 8 }, { x: 38, s: 3 }], wheelY: 6,
    sprite: [
      '..xxx.......................................',
      '..xxxx......................................',
      '...dd.........xx............................',
      '...dbb.......dxxd...........................',
      '...dbbb.....dbwwbd..........................',
      '..dbbbbbdddbbbbbbbdddddddd..................',
      '..dbbbbbbbbbbbbbbbbbbbbbbbbddddddddddd......',
      '..dhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhbdd....',
      '..dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd....',
    ],
  },
];
// pack-exclusive premium cars (not buyable in the dealer)
CARS.push({
  ...CARS[2], id: 'wolf', name: 'NIGHT WOLF', price: 0, packOnly: true, etHint: 11.8,
  mass: 1180, torque: 360, redline: 8800, limiter: 9400,
  gears: [3.40, 2.25, 1.70, 1.33, 1.08, 0.90], finalDrive: 3.9,
  traction: 9600, drag: 0.35, wheelRadius: 0.31,
  pal: { b: '#23252e', h: '#ff3a3a', d: '#101318', w: '#9fd4ff' },
});
CARS.push({
  ...CARS[3], id: 'bullet', name: 'GOLDEN BULLET', price: 0, packOnly: true, etHint: 10.8,
  mass: 1260, torque: 500, redline: 8800, limiter: 9400,
  gears: [3.20, 2.15, 1.65, 1.30, 1.05, 0.86], finalDrive: 3.6,
  traction: 12500, drag: 0.32, wheelRadius: 0.33,
  pal: { b: '#f4c542', h: '#181820', d: '#8a6a1a', w: '#aee6ff' },
});
const CAR_BY_ID = Object.fromEntries(CARS.map(c => [c.id, c]));

// ------------------------------------------------------------
// Shop packs — premium cars, free upgrade stages, exclusive paints
// ------------------------------------------------------------
const PREMIUM_PAINT_START = 8; // PAINTS[8..] are pack-exclusive
const PACKS = [
  { name: 'STREET PACK', price: 2500, color: '#7ec8ff', desc: 'CASH · PART · PAINT' },
  { name: 'PRO PACK', price: 8000, color: '#ffd166', desc: 'BIGGER DROPS · 10% CAR' },
  { name: 'ELITE PACK', price: 20000, color: '#ff5c7a', desc: '20% PREMIUM CAR · PITY 5' },
];

function openPack(tier) {
  const pack = PACKS[tier];
  if (G.cash < pack.price) { setFlash('NOT ENOUGH CASH', PAL.red); return; }
  G.cash -= pack.price;
  const r = Math.random();
  const premiumLeft = ['wolf', 'bullet'].filter(id => !G.owned.includes(id));
  const carChance = tier === 0 ? 0.03 : tier === 1 ? 0.10 : 0.20;
  let forceCar = false;
  if (tier === 2) {
    G.pity++;
    if (G.pity >= 5) forceCar = true;
  }

  let result;
  if ((forceCar || r >= 1 - carChance) && premiumLeft.length) {
    const id = premiumLeft[Math.floor(Math.random() * premiumLeft.length)];
    G.owned.push(id);
    G.garage[id] = freshParts();
    if (tier === 2) G.pity = 0;
    result = { label: CAR_BY_ID[id].name, sub: 'PREMIUM CAR UNLOCKED!', color: PAL.cash, car: id };
  } else if (r < (tier === 0 ? 0.60 : tier === 1 ? 0.40 : 0.30)) {
    const amt = [1000 + Math.floor(Math.random() * 2000),
      4000 + Math.floor(Math.random() * 5000),
      10000 + Math.floor(Math.random() * 10000)][tier];
    G.cash += amt;
    result = { label: '$' + amt, sub: 'CASH DROP', color: PAL.green };
  } else if (r < (tier === 0 ? 0.85 : tier === 1 ? 0.70 : 0.55)) {
    // free upgrade stage on the current car
    const open = UPGRADES.filter(u => G.garage[G.carId][u.id] < MAX_LEVEL);
    if (open.length) {
      const upg = open[Math.floor(Math.random() * open.length)];
      const stage = upg.stages[G.garage[G.carId][upg.id]];
      G.garage[G.carId][upg.id]++;
      recalcStats();
      result = { label: stage, sub: 'FREE PART INSTALLED (' + S.car.name + ')', color: PAL.nos };
    } else {
      G.cash += 2000;
      result = { label: '$2000', sub: 'CAR MAXED - CASH INSTEAD', color: PAL.green };
    }
  } else {
    // exclusive paint
    const locked = [];
    for (let i = PREMIUM_PAINT_START; i < PAINTS.length; i++) {
      if (!G.unlockedPaints.includes(i)) locked.push(i);
    }
    if (locked.length) {
      const idx = locked[Math.floor(Math.random() * locked.length)];
      G.unlockedPaints.push(idx);
      result = { label: PREMIUM_PAINT_NAMES[idx - PREMIUM_PAINT_START], sub: 'EXCLUSIVE PAINT UNLOCKED', color: PAINTS[idx] };
    } else {
      G.cash += 1500;
      result = { label: '$1500', sub: 'ALL PAINTS OWNED - CASH INSTEAD', color: PAL.green };
    }
  }
  G.packsOpened++;
  G.packReveal = { ...result, t: 0 };
  save();
  buzz([30, 40, 30]);
}

// opponent cars always render in this rival paint
const RIVAL_PAL = { b: '#3aa05a', h: '#8ce8a8', d: '#1d5a32', w: '#ffe6ae' };

// paint shop colors (applied to body, shadow derived automatically)
// indices 8+ are pack-exclusive premium paints
const PAINTS = ['#e03a3a', '#2a4fd0', '#e0a63a', '#3aa05a', '#9a5cff', '#e8e8f0', '#3a4048', '#ff7a3c',
  '#d8e4ee', '#f4c542', '#7dff3a', '#ff3ad6'];
const PREMIUM_PAINT_NAMES = ['CHROME', 'GOLD LEAF', 'NEON TOXIC', 'HYPER MAGENTA'];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (x) => Math.max(0, Math.min(255, Math.round(x * f)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => ch(v).toString(16).padStart(2, '0')).join('');
}

function carPal(car) {
  const idx = G.paint[car.id];
  if (idx === undefined || idx === null) return car.pal;
  const b = PAINTS[idx];
  return { b, d: shade(b, 0.55), h: car.pal.h, w: car.pal.w };
}

// race environments (picked per race; career walks through them)
const THEMES = [
  { name: 'NIGHT CITY', night: true, sky1: '#0a0a1e', sky2: '#141433', bld: '#1b1b3a', lit: '#e8c85a', ground: '#101024', fence: '#3a3a4a', road: '#2a2a34', moon: '#e8e8f4' },
  { name: 'SUNSET MESA', night: false, sky1: '#31174a', sky2: '#d0603a', bld: '#3a1e30', lit: '#00000000', ground: '#241420', fence: '#4a3040', road: '#332b33', sun: '#ffd166' },
  { name: 'DOCKLANDS', night: true, sky1: '#0c141c', sky2: '#22343e', bld: '#16262e', lit: '#7ec8ff', ground: '#0e1a20', fence: '#2e3e46', road: '#242a30', moon: '#cfe8ff' },
];

// quick-race distances (career + duels stay 1/4 mile)
const DISTANCES = [
  { label: '1/8 MI', m: 201.168, aiScale: 0.645, payScale: 0.6 },
  { label: '1/4 MI', m: 402.336, aiScale: 1, payScale: 1 },
  { label: '1/2 MI', m: 804.672, aiScale: 1.75, payScale: 1.5 },
];

const QUICK_RIVALS = ['MIDNIGHT RUNNER', '8-BIT BANDIT', 'TURBO TERI', 'CHROME FOX', 'VHS VIPER', 'NEON NOMAD', 'RUST BUCKET', 'PIXEL PETE'];

// ============================================================
// UPGRADES — 7 categories, 5 named stages each (realistic parts)
// ============================================================
const UPGRADES = [
  {
    id: 'engine', name: 'ENGINE',
    stages: ['SPORT FILTER', 'RACE CAMSHAFT', 'FORGED PISTONS', 'STROKER KIT', 'RACE BLOCK'],
    prices: [400, 900, 1800, 3400, 6000],
    mult: [1, 1.05, 1.11, 1.18, 1.26, 1.36], // torque
  },
  {
    id: 'turbo', name: 'TURBO',
    stages: ['SMALL TURBO', 'INTERCOOLER', 'BIG TURBO', 'TWIN TURBO', 'RACE TURBO'],
    prices: [500, 1100, 2200, 4000, 7000],
    mult: [1, 1.06, 1.12, 1.19, 1.26, 1.34], // torque above 55% redline
  },
  {
    id: 'exhaust', name: 'EXHAUST',
    stages: ['SPORT MUFFLER', 'HEADERS', 'FULL EXHAUST', 'RACE MANIFOLD', 'TITANIUM SYS'],
    prices: [250, 600, 1200, 2200, 3800],
    mult: [1, 1.05, 1.10, 1.15, 1.20, 1.26], // torque below 60% redline
  },
  {
    id: 'tires', name: 'TIRES',
    stages: ['SPORT TIRES', 'SEMI-SLICKS', 'SLICKS', 'DRAG RADIALS', 'RACE SLICKS'],
    prices: [300, 700, 1500, 2800, 5000],
    mult: [1, 1.06, 1.12, 1.19, 1.26, 1.34], // traction
  },
  {
    id: 'gearbox', name: 'GEARBOX',
    stages: ['SHORT SHIFTER', 'SPORT CLUTCH', 'RACE CLUTCH', 'DOG BOX', 'SEQUENTIAL'],
    prices: [350, 800, 1600, 3000, 5200],
    mult: [1, 0.87, 0.75, 0.63, 0.52, 0.42], // shift time
  },
  {
    id: 'weight', name: 'WEIGHT',
    stages: ['SEAT DELETE', 'CARBON HOOD', 'CARBON PANELS', 'LEXAN GLASS', 'FULL STRIPOUT'],
    prices: [300, 650, 1300, 2500, 4500],
    mult: [1, 0.97, 0.945, 0.92, 0.895, 0.87], // mass
  },
  {
    id: 'nitro', name: 'NITROUS',
    stages: ['NOS KIT', 'BIG BOTTLE', 'DIRECT PORT', 'DUAL STAGE', 'RACE BLEND'],
    prices: [600, 1200, 2400, 4200, 7500],
    power: [0, 1.12, 1.16, 1.20, 1.25, 1.30],
    duration: [0, 2.0, 2.4, 2.8, 3.2, 3.6],
  },
];
const MAX_LEVEL = 5;
const UPG_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

function freshParts() {
  return { engine: 0, turbo: 0, exhaust: 0, tires: 0, gearbox: 0, weight: 0, nitro: 0 };
}

// ============================================================
// CAREER — rivals get faster and faster
// ============================================================
const CAREER = [
  { name: 'RUSTY RICK',      et: 18.5, reward: 250 },
  { name: 'LIL TOMMY',       et: 17.8, reward: 300 },
  { name: 'MAYA DRIFT',      et: 17.2, reward: 350 },
  { name: 'OLD MAN JOE',     et: 16.6, reward: 400 },
  { name: 'KING CARL',       et: 16.0, reward: 900,  boss: true },
  { name: 'TURBO TINA',      et: 15.4, reward: 550 },
  { name: 'DIESEL DAVE',     et: 14.9, reward: 650 },
  { name: 'MIDNIGHT KAI',    et: 14.4, reward: 750 },
  { name: 'SLICK SARA',      et: 13.9, reward: 850 },
  { name: 'DR TORQUE',       et: 13.4, reward: 2200, boss: true },
  { name: 'NITRO NED',       et: 12.9, reward: 1400 },
  { name: 'GHOST',           et: 12.4, reward: 1700 },
  { name: 'LADY LIGHTNING',  et: 11.9, reward: 2000 },
  { name: 'CRAZY IVAN',      et: 11.4, reward: 2400 },
  { name: 'LA MUERTE',       et: 10.9, reward: 5500, boss: true },
  { name: 'JET JACKSON',     et: 10.4, reward: 3200 },
  { name: 'PHANTOM QUEEN',   et: 10.0, reward: 3800 },
  { name: 'THE MACHINE',     et: 9.6,  reward: 4500 },
  { name: 'GOLIATH',         et: 9.2,  reward: 10000, boss: true },
];

function rivalCarFor(et) {
  if (et >= 15.5) return CAR_BY_ID.hatch;
  if (et >= 12.8) return CAR_BY_ID.muscle;
  if (et >= 10.7) return CAR_BY_ID.jdm;
  if (et >= 9.4) return CAR_BY_ID.super;
  return CAR_BY_ID.dragster;
}

// quick race classes (grind money between career stages)
const DIFFICULTIES = [
  { name: 'STREET', et: 15.4, jitter: 0.5, color: '#7ec8ff', win: 300,  lose: 75 },
  { name: 'PRO',    et: 13.9, jitter: 0.4, color: '#ffd166', win: 700,  lose: 150 },
  { name: 'BOSS',   et: 12.9, jitter: 0.3, color: '#ff5c7a', win: 1500, lose: 300 },
];

// ============================================================
// Game state + save
// ============================================================
const G = {
  screen: 'menu',        // menu | quick | career | garage | dealer | staging | race | results
  mode: 'quick',         // quick | career
  difficulty: 0,
  dealerIdx: 0,
  time: 0,
  raceT: 0,
  // player physics
  pos: 0, speed: 0, rpm: 1000, gear: 1,
  throttle: false,
  shiftTimer: 0,
  clutchTimer: 0,
  launchRpm: 0,
  launchKind: '',
  bogTimer: 0, spinTimer: 0,
  perfectShifts: 0,
  nosUsed: false, nosTimer: 0,
  finished: false, et: 0, trap: 0, newBest: false,
  // opponent
  aiEt: 14, aiPos: 0, aiSpeed: 0, aiFinished: false,
  oppName: '', oppCar: CARS[0],
  // progression
  cash: 0,
  carId: 'hatch',
  owned: ['hatch'],
  garage: { hatch: freshParts() },
  best: {},              // best ET per car id
  career: 0,             // next career stage index
  earned: null,
  // on-chain hub
  chainTab: 'wallet',    // wallet | board | duel | ref
  chainCfg: null, chainPlayer: null, fuel: 0,
  board: null, chainLoading: false, chainMsg: '',
  duel: null,            // {creator, seed, role, submitted} (persisted)
  duelInfo: null, duelStakeIdx: 1,
  pendingReferrer: '',   // applied at on-chain registration (persisted)
  // quality of life
  ghosts: {},            // best-run position trace per car (persisted)
  trace: [],             // current run trace (10 samples/s)
  streak: 0,             // quick-race win streak (persisted)
  muted: false,          // sound off (persisted)
  // race presentation & new mechanics
  theme: 0,
  stage: 'burnout',      // staging sub-phase: burnout | tree
  burnT: 0, treeT: 0,
  tireTemp: 0, tireBonus: 1,
  rt: null,              // reaction time (s from green to first throttle)
  distanceM: QUARTER_MILE,
  distIdx: 1,            // quick-race distance (persisted)
  slowmo: false, finishFlash: 0,
  paint: {},             // paint index per car (persisted)
  tune: {},              // {carId: {fd, nos}} dyno setup (persisted)
  nftModels: [],         // car models this wallet holds as NFTs
  chainQueue: null,      // ranked queue slots
  chainMatch: null,      // my active on-chain ranked match
  // shop + marketplace
  unlockedPaints: [],    // premium paint indices (persisted)
  pity: 0, packsOpened: 0,
  packReveal: null,      // {label, sub, color, t}
  nftInstances: [],      // [{model,index,mint}] held in wallet
  listings: [],          // open marketplace listings
  listPriceIdx: 1,
  // ranked mode (persisted)
  rp: 0, rankedW: 0, rankedL: 0, rankedMonth: '',
  rankedOpp: null,       // matched opponent {name, et, rp, car}
  rankedSearchT: 0,      // >0 while the fake matchmaking runs
  lastRpDelta: 0,
  // fx
  flash: null,
  particles: [],
  shake: 0,
  wheelFrame: 0,
};

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('pdr_save') || '{}');
    if (typeof s.cash === 'number') G.cash = s.cash;
    if (s.v === 2) {
      if (CAR_BY_ID[s.carId]) G.carId = s.carId;
      if (Array.isArray(s.owned)) G.owned = s.owned.filter(id => CAR_BY_ID[id]);
      if (!G.owned.includes('hatch')) G.owned.push('hatch');
      if (s.garage) {
        for (const id of G.owned) {
          G.garage[id] = Object.assign(freshParts(), s.garage[id]);
          for (const k in G.garage[id]) G.garage[id][k] = Math.min(MAX_LEVEL, G.garage[id][k] | 0);
        }
      }
      if (s.best) G.best = s.best;
      if (typeof s.career === 'number') G.career = Math.min(CAREER.length, s.career);
      if (s.duel && s.duel.creator && typeof s.duel.seed === 'number') G.duel = s.duel;
      if (typeof s.pendingReferrer === 'string') G.pendingReferrer = s.pendingReferrer;
      if (s.ghosts) G.ghosts = s.ghosts;
      if (typeof s.streak === 'number') G.streak = s.streak;
      if (typeof s.muted === 'boolean') G.muted = s.muted;
      if (s.paint) G.paint = s.paint;
      if (s.tune) G.tune = s.tune;
      if (typeof s.distIdx === 'number') G.distIdx = Math.min(DISTANCES.length - 1, s.distIdx);
      if (Array.isArray(s.unlockedPaints)) G.unlockedPaints = s.unlockedPaints;
      if (typeof s.pity === 'number') G.pity = s.pity;
      if (typeof s.packsOpened === 'number') G.packsOpened = s.packsOpened;
      if (typeof s.rp === 'number') G.rp = s.rp;
      if (typeof s.rankedW === 'number') G.rankedW = s.rankedW;
      if (typeof s.rankedL === 'number') G.rankedL = s.rankedL;
      if (typeof s.rankedMonth === 'string') G.rankedMonth = s.rankedMonth;
      // soft season reset: half your points each month
      const month = new Date().getFullYear() + '-' + new Date().getMonth();
      if (G.rankedMonth !== month) {
        G.rp = Math.floor(G.rp / 2);
        G.rankedW = 0; G.rankedL = 0;
        G.rankedMonth = month;
      }
    }
  } catch {}
  for (const id of G.owned) if (!G.garage[id]) G.garage[id] = freshParts();
}
function save() {
  try {
    localStorage.setItem('pdr_save', JSON.stringify({
      v: 2, cash: G.cash, carId: G.carId, owned: G.owned,
      garage: G.garage, best: G.best, career: G.career,
      duel: G.duel, pendingReferrer: G.pendingReferrer,
      ghosts: G.ghosts, streak: G.streak, muted: G.muted,
      paint: G.paint, tune: G.tune, distIdx: G.distIdx,
      rp: G.rp, rankedW: G.rankedW, rankedL: G.rankedL, rankedMonth: G.rankedMonth,
      unlockedPaints: G.unlockedPaints, pity: G.pity, packsOpened: G.packsOpened,
    }));
  } catch {}
}

// ------------------------------------------------------------
// Ranked mode — Elo-style matchmaking against the ladder
// ------------------------------------------------------------
const DIVISIONS = [
  { name: 'BRONZE', min: 0, color: '#c88a5a' },
  { name: 'SILVER', min: 200, color: '#b8c0cc' },
  { name: 'GOLD', min: 400, color: '#ffd166' },
  { name: 'PLATINUM', min: 650, color: '#8ce8e0' },
  { name: 'DIAMOND', min: 900, color: '#7ec8ff' },
  { name: 'LEGEND', min: 1200, color: '#ff5c7a' },
];

function divisionOf(rp) {
  let d = DIVISIONS[0];
  for (const div of DIVISIONS) if (rp >= div.min) d = div;
  return d;
}

// map rank points to the quarter-mile pace of that ladder tier
const RP_ET = [[0, 17.4], [200, 15.8], [400, 14.4], [650, 13.0], [900, 11.6], [1200, 10.2], [1500, 9.0]];
function etForRp(rp) {
  for (let i = 1; i < RP_ET.length; i++) {
    if (rp <= RP_ET[i][0]) {
      const [r0, e0] = RP_ET[i - 1], [r1, e1] = RP_ET[i];
      return e0 + (e1 - e0) * (rp - r0) / (r1 - r0);
    }
  }
  return RP_ET[RP_ET.length - 1][1];
}

function findRankedOpponent() {
  const oppRp = Math.max(0, G.rp + Math.round(Math.random() * 240 - 120));
  const et = etForRp(oppRp) + (Math.random() * 0.5 - 0.25);
  // real wallets from the on-chain board lend their names to the ladder
  let name;
  const boardNames = (G.board && G.board.entries.length)
    ? G.board.entries.map(e => e.wallet.slice(0, 4) + '..' + e.wallet.slice(-4)) : [];
  if (boardNames.length && Math.random() < 0.4) {
    name = boardNames[Math.floor(Math.random() * boardNames.length)];
  } else {
    name = QUICK_RIVALS[Math.floor(Math.random() * QUICK_RIVALS.length)];
  }
  return { name, et, rp: oppRp, car: rivalCarFor(et) };
}

function startRankedRace() {
  if (!G.rankedOpp) return;
  G.mode = 'ranked';
  G.distanceM = QUARTER_MILE;
  G.aiEt = G.rankedOpp.et;
  G.oppName = G.rankedOpp.name;
  G.oppCar = G.rankedOpp.car;
  G.theme = Math.floor(Math.random() * THEMES.length);
  beginStaging();
}

function bestKey() {
  return G.carId + (G.distanceM === QUARTER_MILE ? '' : '@' + Math.round(G.distanceM));
}

function carTune() {
  return G.tune[G.carId] || { fd: 100, nos: 2 };
}

// haptic feedback (Android; silently unavailable elsewhere)
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

// ============================================================
// Effective stats S — current car + installed parts
// ============================================================
const S = {};
function recalcStats() {
  const car = CAR_BY_ID[G.carId];
  const p = G.garage[G.carId];
  S.car = car;
  const t = G.tune[G.carId] || { fd: 100, nos: 2 };
  S.mass = car.mass * UPG_BY_ID.weight.mult[p.weight];
  S.peakTorque = car.torque * UPG_BY_ID.engine.mult[p.engine];
  S.turbo = UPG_BY_ID.turbo.mult[p.turbo];
  S.exhaust = UPG_BY_ID.exhaust.mult[p.exhaust];
  S.traction = car.traction * UPG_BY_ID.tires.mult[p.tires];
  S.shiftTime = 0.30 * UPG_BY_ID.gearbox.mult[p.gearbox];
  S.perfectShiftTime = 0.12 * UPG_BY_ID.gearbox.mult[p.gearbox];
  // dyno setup: NOS balance trades duration for punch
  const nosLvl = p.nitro;
  S.nosPower = UPG_BY_ID.nitro.power[nosLvl] + (nosLvl > 0 ? (t.nos - 2) * 0.02 : 0);
  S.nosDuration = nosLvl > 0 ? Math.max(0.8, UPG_BY_ID.nitro.duration[nosLvl] - (t.nos - 2) * 0.35) : 0;
  S.gears = car.gears;
  // dyno setup: final drive 90-110% (shorter = harder launch, longer = top end)
  S.finalDrive = car.finalDrive * (t.fd / 100);
  S.wheelRadius = car.wheelRadius;
  S.drag = car.drag;
  S.redline = car.redline;
  S.limiter = car.limiter;
  S.maxRpm = Math.ceil((car.limiter + 200) / 1000) * 1000;
  S.idle = 1000;
  S.launchLo = Math.round(0.58 * car.redline / 100) * 100;
  S.launchHi = Math.round(0.80 * car.redline / 100) * 100;
  S.perfectLo = car.limiter - 1100;
  S.perfectHi = car.limiter - 200;
  S.revUp = 0.9 * car.redline;
  S.revDown = 0.58 * car.redline;
}
loadSave();
recalcStats();

// ============================================================
// Audio — tiny synth engine tied to RPM
// ============================================================
const AU = { ctx: null, osc: null, osc2: null, gain: null, ok: false };

function initAudio() {
  if (AU.ok) return;
  try {
    AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const lp = AU.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    AU.gain = AU.ctx.createGain(); AU.gain.gain.value = 0;
    AU.osc = AU.ctx.createOscillator(); AU.osc.type = 'sawtooth';
    AU.osc2 = AU.ctx.createOscillator(); AU.osc2.type = 'square';
    const g2 = AU.ctx.createGain(); g2.gain.value = 0.35;
    AU.osc.connect(lp); AU.osc2.connect(g2); g2.connect(lp);
    lp.connect(AU.gain); AU.gain.connect(AU.ctx.destination);
    AU.osc.start(); AU.osc2.start();
    AU.ok = true;
  } catch { /* audio unavailable — game still works */ }
}

function updateAudio() {
  if (!AU.ok) return;
  const running = G.screen === 'staging' || G.screen === 'race';
  const f = 28 + (G.rpm / S.maxRpm) * 150;
  AU.osc.frequency.setTargetAtTime(f, AU.ctx.currentTime, 0.03);
  AU.osc2.frequency.setTargetAtTime(f * 0.5, AU.ctx.currentTime, 0.03);
  let vol = 0;
  if (running && !G.muted) {
    vol = 0.05 + (G.rpm / S.maxRpm) * 0.10 + (G.throttle ? 0.04 : 0);
    if (G.nosTimer > 0) vol += 0.05;
    if (G.shiftTimer > 0) vol *= 0.3;
  }
  AU.gain.gain.setTargetAtTime(vol, AU.ctx.currentTime, 0.05);
}

// ============================================================
// Input
// ============================================================
const controls = document.getElementById('controls');
const btnGas = document.getElementById('gas');
const btnUp = document.getElementById('shiftUp');
const btnDown = document.getElementById('shiftDown');
const btnNos = document.getElementById('nos');

function bindHold(el, on, off) {
  const down = (e) => { e.preventDefault(); initAudio(); el.classList.add('pressed'); on(); };
  const up = (e) => { e.preventDefault(); el.classList.remove('pressed'); off && off(); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up);
  el.addEventListener('touchcancel', up);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

bindHold(btnGas, () => { G.throttle = true; }, () => { G.throttle = false; });
bindHold(btnUp, () => shiftUp());
bindHold(btnDown, () => shiftDown());
bindHold(btnNos, () => fireNos());

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  initAudio();
  if (e.code === 'Space') { G.throttle = true; e.preventDefault(); }
  if (e.code === 'ArrowUp' || e.code === 'KeyW') shiftUp();
  if (e.code === 'ArrowDown' || e.code === 'KeyS') shiftDown();
  if (e.code === 'KeyN') fireNos();
  if (e.code === 'Enter') tapAnywhere(0, 0, true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') G.throttle = false;
});

canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W;
  const y = (e.clientY - r.top) / r.height * H;
  tapAnywhere(x, y, false);
});

const hits = []; // {x,y,w,h,action,idx} — rebuilt by whichever screen is drawn

function hitAt(x, y) {
  for (const h of hits) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}

function tapAnywhere(x, y, isKey) {
  if (G.screen === 'results') {
    const h = hitAt(x, y);
    if (h && h.action === 'postrecord') { postRaceRecord(); return; }
    if (h && h.action === 'duelsubmit') { doDuelSubmit(); return; }
    if (h && h.action === 'chainsubmit') { doChainSubmitRanked(); return; }
    if (G.time > 0.6) {
      if (G.mode === 'career') gotoScreen('career');
      else if (G.mode === 'duel') { gotoScreen('wallet'); G.chainTab = 'duel'; refreshChain(); }
      else if (G.mode === 'ranked' || G.mode === 'chainrank') gotoScreen('ranked');
      else gotoScreen('menu');
    }
    return;
  }
  if (G.screen === 'staging' || G.screen === 'race') return;
  if (isKey) {
    if (G.screen === 'menu') gotoScreen('career');
    else if (G.screen === 'career') startCareerRace();
    return;
  }
  const h = hitAt(x, y);
  if (!h) return;
  switch (h.action) {
    case 'goto': gotoScreen(h.idx); break;
    case 'quickrace': startQuickRace(h.idx); break;
    case 'careerrace': startCareerRace(); break;
    case 'buypart': buyPart(h.idx); break;
    case 'dealerprev': G.dealerIdx = (G.dealerIdx + CARS.length - 1) % CARS.length; break;
    case 'dealernext': G.dealerIdx = (G.dealerIdx + 1) % CARS.length; break;
    case 'dealeraction': dealerAction(); break;
    case 'connect': doConnect(); break;
    case 'disconnect': disconnectWallet(); G.chainPlayer = null; G.fuel = 0; setFlash('WALLET DISCONNECTED', PAL.dim); break;
    case 'postbest': postBestRecord(); break;
    case 'chaintab': G.chainTab = h.idx; refreshChain(); break;
    case 'chainrefresh': refreshChain(true); break;
    case 'claimfuel': doClaim(); break;
    case 'submitboard': doSubmitBoard(); break;
    case 'duelstake': G.duelStakeIdx = (G.duelStakeIdx + 1) % DUEL_STAKES.length; break;
    case 'duelcreate': doDuelCreate(); break;
    case 'dueljoin': doDuelJoin(); break;
    case 'duelrace': startDuelRace(); break;
    case 'duelsettle': doDuelSettle(); break;
    case 'duelcancel': doDuelCancel(); break;
    case 'duelclear': G.duel = null; G.duelInfo = null; save(); break;
    case 'copyaddr': copyMyAddress(); break;
    case 'copyduel': copyDuelCode(); break;
    case 'setref': doSetReferrer(); break;
    case 'togglesound': G.muted = !G.muted; save(); break;
    case 'quickdist': G.distIdx = h.idx; save(); break;
    case 'paintcycle': {
      const car = CARS[G.dealerIdx];
      let idx = G.paint[car.id] ?? -1;
      // premium paints only cycle in when unlocked from packs
      do { idx = (idx + 1) % PAINTS.length; }
      while (idx >= PREMIUM_PAINT_START && !G.unlockedPaints.includes(idx));
      G.paint[car.id] = idx;
      save();
      break;
    }
    case 'buypack': openPack(h.idx); break;
    case 'packclose': G.packReveal = null; break;
    case 'marketbuy': doMarketBuy(h.idx); break;
    case 'marketcancel': doMarketCancel(h.idx); break;
    case 'marketlist': doMarketList(); break;
    case 'marketprice': G.listPriceIdx = (G.listPriceIdx + 1) % LIST_PRICES.length; break;
    case 'tunefd': adjustTune('fd', h.idx); break;
    case 'tunenos': adjustTune('nos', h.idx); break;
    case 'rankedsearch':
      G.rankedSearchT = 1.2;
      G.rankedOpp = null;
      break;
    case 'rankedrace': startRankedRace(); break;
    case 'mintnft': doMintCarNft(); break;
    case 'chainqueue': doChainQueue(); break;
    case 'chainleave': doChainLeave(); break;
    case 'chainrace': startChainRankedRace(); break;
    case 'chainsettle': doChainSettle(); break;
  }
}

// ------------------------------------------------------------
// On-chain ranked queue actions
// ------------------------------------------------------------
async function doChainQueue() {
  if (sol.busy) return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) { setFlash(sol.error, PAL.red); return; } }
  setFlash('CHECKING THE QUEUE...', PAL.nos);
  const res = await enterRankedQueue();
  if (!res.sig) { setFlash(sol.error, PAL.red); return; }
  setFlash(res.matched ? 'MATCHED! RACE YOUR RIVAL!' : 'IN QUEUE - WAITING FOR A RIVAL', PAL.green);
  refreshChain(true);
}

async function doChainLeave() {
  if (sol.busy) return;
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await leaveRankedQueue();
  setFlash(sig ? 'LEFT THE QUEUE - STAKE BACK' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

function startChainRankedRace() {
  if (!G.chainMatch || G.chainMatch.settled) return;
  G.mode = 'chainrank';
  G.distanceM = QUARTER_MILE;
  G.aiEt = 9999;
  const me = sol.address;
  const rival = G.chainMatch.a.toBase58() === me ? G.chainMatch.b : G.chainMatch.a;
  G.oppName = rival.toBase58().slice(0, 4) + '..' + rival.toBase58().slice(-4);
  G.oppCar = S.car;
  G.theme = Math.floor(Math.random() * THEMES.length);
  beginStaging();
}

async function doChainSubmitRanked() {
  if (!G.chainMatch || sol.busy) return;
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([
    submitRankedTimeIx(getPublicKey(), G.chainMatch.address, Math.round(G.et * 1000)),
  ]);
  setFlash(sig ? 'RANKED TIME SUBMITTED!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doChainSettle() {
  if (!G.chainMatch || sol.busy) return;
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([settleRankedIx(getPublicKey(), G.chainMatch)]);
  setFlash(sig ? 'MATCH SETTLED - GG!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) { G.chainMatch = null; refreshChain(true); }
}

// ------------------------------------------------------------
// Marketplace actions (buy/list/cancel car NFTs, fee burned)
// ------------------------------------------------------------
const LIST_PRICES = [1000, 5000, 10000, 25000, 50000, 100000]; // FUEL

async function doMarketBuy(idx) {
  const listing = G.listings[idx];
  if (!listing || sol.busy) return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([buyNftIx(getPublicKey(), listing)]);
  setFlash(sig ? 'NFT BOUGHT - CAR UNLOCKED!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doMarketList() {
  const mine = G.listings.filter(l => l.seller.toBase58() === sol.address).map(l => l.mint.toBase58());
  const nft = G.nftInstances.find(n => !mine.includes(n.mint.toBase58()));
  if (!nft || sol.busy) return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([listNftIx(getPublicKey(), nft.model, nft.index, LIST_PRICES[G.listPriceIdx])]);
  setFlash(sig ? 'LISTED ON THE MARKET!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doMarketCancel(idx) {
  const listing = G.listings[idx];
  if (!listing || sol.busy) return;
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([cancelListingIx(getPublicKey(), listing.mint)]);
  setFlash(sig ? 'LISTING CANCELLED' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doMintCarNft() {
  const model = G.dealerIdx;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) { setFlash(sol.error, PAL.red); return; } }
  setFlash('SIGNING MINT TX...', PAL.nos);
  const sig = await mintCarNft(model);
  setFlash(sig ? 'CAR NFT MINTED!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

function adjustTune(k, delta) {
  const t = Object.assign({ fd: 100, nos: 2 }, G.tune[G.carId]);
  if (k === 'fd') t.fd = Math.max(90, Math.min(110, t.fd + delta * 2));
  else t.nos = Math.max(0, Math.min(4, t.nos + delta));
  G.tune[G.carId] = t;
  recalcStats();
  save();
}

// ------------------------------------------------------------
// On-chain hub actions (leaderboard / $FUEL / duels / referrals)
// ------------------------------------------------------------
async function refreshChain(force) {
  if (G.chainLoading) return;
  G.chainLoading = true;
  G.chainMsg = '';
  try {
    if (force || !G.chainCfg) G.chainCfg = await getConfig();
    if (!G.chainCfg) { G.chainMsg = 'PROGRAM NOT LIVE YET'; return; }
    if (G.chainTab === 'board' || force) {
      G.board = await getBoard(G.chainCfg.season);
    }
    const me = getPublicKey();
    if (me) {
      G.chainPlayer = await getPlayer(me);
      G.fuel = await getFuelBalance(me);
      G.chainQueue = await getQueue();
      G.chainMatch = G.chainPlayer && G.chainPlayer.activeMatch
        ? await getMatch(G.chainPlayer.activeMatch) : null;
      G.nftInstances = await getOwnedCarNfts(me, G.chainCfg);
      G.nftModels = [...new Set(G.nftInstances.map(n => n.model))];
      G.listings = await getListings(G.chainCfg);
      // NFTs held in the wallet unlock their car model in-game
      for (const m of G.nftModels) {
        const car = CARS[m];
        if (car && !G.owned.includes(car.id)) {
          G.owned.push(car.id);
          if (!G.garage[car.id]) G.garage[car.id] = freshParts();
          save();
        }
      }
    }
    if (G.duel) {
      G.duelInfo = await getDuel(new PublicKey(G.duel.creator), G.duel.seed);
    }
  } catch {
    G.chainMsg = 'RPC ERROR - TRY AGAIN';
  } finally {
    G.chainLoading = false;
  }
}

async function doSubmitBoard() {
  const best = G.best[G.carId];
  if (!best) { setFlash('SET A TIME FIRST', '#ff9a5c'); return; }
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) { setFlash(sol.error, PAL.red); return; } }
  setFlash('SIGNING TX...', PAL.nos);
  const carIdx = CARS.findIndex(c => c.id === G.carId);
  const sig = await submitTimeOnChain(Math.round(best * 1000), Math.max(0, carIdx), G.pendingReferrer);
  setFlash(sig ? 'TIME ON THE BOARD!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doClaim() {
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await claimFuel();
  setFlash(sig ? 'FUEL CLAIMED!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) refreshChain(true);
}

async function doDuelCreate() {
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  const me = getPublicKey();
  const seed = 1000 + Math.floor(Math.random() * 9000);
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([createDuelIx(me, seed, DUEL_STAKES[G.duelStakeIdx])]);
  if (!sig) { setFlash(sol.error, PAL.red); return; }
  G.duel = { creator: me.toBase58(), seed, role: 'creator', submitted: false };
  save();
  copyDuelCode();
  refreshChain(true);
}

async function doDuelJoin() {
  let code = '';
  try { code = (await navigator.clipboard.readText()).trim(); } catch {}
  const m = code.match(/^([1-9A-HJ-NP-Za-km-z]{32,44})\.(\d{4})$/);
  if (!m) { setFlash('COPY A DUEL CODE FIRST', '#ff9a5c'); return; }
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  const creator = new PublicKey(m[1]);
  const seed = parseInt(m[2], 10);
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([joinDuelIx(getPublicKey(), creator, seed)]);
  if (!sig) { setFlash(sol.error, PAL.red); return; }
  G.duel = { creator: m[1], seed, role: 'opponent', submitted: false };
  save();
  setFlash('DUEL JOINED - RACE!', PAL.green);
  refreshChain(true);
}

async function doDuelSubmit() {
  if (!G.duel || G.duel.submitted) return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([
    submitDuelTimeIx(getPublicKey(), new PublicKey(G.duel.creator), G.duel.seed, Math.round(G.et * 1000)),
  ]);
  if (!sig) { setFlash(sol.error, PAL.red); return; }
  G.duel.submitted = true;
  save();
  setFlash('DUEL TIME SUBMITTED!', PAL.green);
  refreshChain(true);
}

async function doDuelSettle() {
  if (!G.duelInfo) return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([settleDuelIx(getPublicKey(), G.duelInfo)]);
  setFlash(sig ? 'DUEL SETTLED!' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) { G.duel = null; G.duelInfo = null; save(); refreshChain(true); }
}

async function doDuelCancel() {
  if (!G.duel || G.duel.role !== 'creator') return;
  if (!sol.connected) { const ok = await connectWallet(); if (!ok) return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await sendIxs([cancelDuelIx(getPublicKey(), G.duel.seed)]);
  setFlash(sig ? 'STAKE REFUNDED' : sol.error, sig ? PAL.green : PAL.red);
  if (sig) { G.duel = null; G.duelInfo = null; save(); }
}

function copyDuelCode() {
  if (!G.duel) return;
  const code = G.duel.creator + '.' + G.duel.seed;
  try { navigator.clipboard.writeText(code); setFlash('DUEL CODE COPIED - SEND IT!', PAL.green); }
  catch { setFlash('COPY FAILED', PAL.red); }
}

function copyMyAddress() {
  if (!sol.address) return;
  try { navigator.clipboard.writeText(sol.address); setFlash('ADDRESS COPIED', PAL.green); }
  catch { setFlash('COPY FAILED', PAL.red); }
}

async function doSetReferrer() {
  if (G.chainPlayer) { setFlash('ALREADY REGISTERED ON-CHAIN', '#ff9a5c'); return; }
  let addr = '';
  try { addr = (await navigator.clipboard.readText()).trim(); } catch {}
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { setFlash('COPY A WALLET ADDRESS FIRST', '#ff9a5c'); return; }
  if (addr === sol.address) { setFlash('NOT YOURSELF ;)', '#ff9a5c'); return; }
  G.pendingReferrer = addr;
  save();
  if (sol.connected) {
    setFlash('SIGNING TX...', PAL.nos);
    const sig = await registerWithReferrer(addr);
    setFlash(sig ? 'REFERRER SET ON-CHAIN!' : sol.error || 'SAVED - APPLIES ON FIRST TX', sig ? PAL.green : PAL.dim);
    if (sig) refreshChain(true);
  } else {
    setFlash('REFERRER SAVED - APPLIES ON FIRST TX', PAL.green);
  }
}

// ------------------------------------------------------------
// Solana on-chain actions (Seeker / Android via Mobile Wallet
// Adapter) — fire-and-forget; sol.* state drives the UI
// ------------------------------------------------------------
async function doConnect() {
  if (sol.busy) return;
  setFlash('OPENING WALLET...', PAL.nos);
  const ok = await connectWallet();
  setFlash(ok ? 'WALLET CONNECTED' : sol.error, ok ? '#5cff8a' : '#ff5c7a');
}

async function postBestRecord() {
  if (sol.busy || !sol.connected) return;
  const best = G.best[G.carId];
  if (!best) { setFlash('SET A TIME FIRST', '#ff9a5c'); return; }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await postRecord({
    g: 'PIXEL-DRAG-RACER', v: 1, kind: 'best',
    car: G.carId, et: Number(best.toFixed(3)), career: G.career,
  });
  setFlash(sig ? 'RECORD ON-CHAIN!' : sol.error, sig ? '#5cff8a' : '#ff5c7a');
}

async function postRaceRecord() {
  if (sol.busy) return;
  if (!sol.connected) {
    const ok = await connectWallet();
    if (!ok) { setFlash(sol.error, '#ff5c7a'); return; }
  }
  setFlash('SIGNING TX...', PAL.nos);
  const sig = await postRecord({
    g: 'PIXEL-DRAG-RACER', v: 1, kind: 'race',
    car: G.carId, et: Number(G.et.toFixed(3)), trap: Math.round(G.trap),
    vs: G.oppName, career: G.career,
  });
  setFlash(sig ? 'RECORD ON-CHAIN!' : sol.error, sig ? '#5cff8a' : '#ff5c7a');
}

function gotoScreen(name) {
  G.screen = name;
  G.time = 0;
  controls.classList.add('hidden');
  if (name === 'wallet' || name === 'ranked') refreshChain();
}

// ============================================================
// Garage / dealer actions
// ============================================================
function buyPart(idx) {
  const upg = UPGRADES[idx];
  const parts = G.garage[G.carId];
  const lvl = parts[upg.id];
  if (lvl >= MAX_LEVEL) { setFlash('MAXED OUT', '#8a8aa8'); return; }
  const cost = upg.prices[lvl];
  if (G.cash < cost) { setFlash('NOT ENOUGH CASH', '#ff5c7a'); return; }
  G.cash -= cost;
  parts[upg.id]++;
  recalcStats();
  save();
  setFlash(upg.stages[lvl] + ' INSTALLED!', '#5cff8a');
}

function dealerAction() {
  const car = CARS[G.dealerIdx];
  if (car.packOnly && !G.owned.includes(car.id)) { setFlash('ONLY FROM SHOP PACKS', '#ff9a5c'); return; }
  if (G.owned.includes(car.id)) {
    G.carId = car.id;
    recalcStats();
    save();
    setFlash(car.name + ' SELECTED', '#5cff8a');
    return;
  }
  if (G.cash < car.price) { setFlash('NOT ENOUGH CASH', '#ff5c7a'); return; }
  G.cash -= car.price;
  G.owned.push(car.id);
  G.garage[car.id] = freshParts();
  G.carId = car.id;
  recalcStats();
  save();
  setFlash(car.name + ' PURCHASED!', '#5cff8a');
}

// ============================================================
// Race flow
// ============================================================
function beginStaging() {
  G.screen = 'staging';
  G.time = 0;
  G.raceT = 0;
  G.pos = 0; G.speed = 0; G.rpm = S.idle; G.gear = 1;
  G.shiftTimer = 0; G.clutchTimer = 0;
  G.launchRpm = 0; G.launchKind = '';
  G.bogTimer = 0; G.spinTimer = 0;
  G.perfectShifts = 0;
  G.nosUsed = false; G.nosTimer = 0;
  G.finished = false; G.et = 0; G.trap = 0; G.newBest = false;
  G.aiPos = 0; G.aiSpeed = 0; G.aiFinished = false;
  G.earned = null;
  G.flash = null;
  G.particles = [];
  G.trace = [];
  G.stage = 'burnout';
  G.burnT = 0; G.treeT = 0;
  G.tireTemp = 0; G.tireBonus = 1;
  G.rt = null;
  G.slowmo = false; G.finishFlash = 0;
  controls.classList.remove('hidden');
  const hasNos = G.garage[G.carId].nitro > 0;
  btnNos.classList.toggle('hidden', !hasNos);
  btnNos.classList.remove('used');
}

function startQuickRace(idx) {
  const d = DIFFICULTIES[idx];
  const dist = DISTANCES[G.distIdx];
  G.mode = 'quick';
  G.difficulty = idx;
  G.distanceM = dist.m;
  G.aiEt = (d.et + (Math.random() * 2 - 1) * d.jitter) * dist.aiScale;
  G.oppName = QUICK_RIVALS[Math.floor(Math.random() * QUICK_RIVALS.length)];
  G.oppCar = rivalCarFor(d.et);
  G.theme = Math.floor(Math.random() * THEMES.length);
  beginStaging();
}

function startCareerRace() {
  if (G.career >= CAREER.length) return;
  const stage = CAREER[G.career];
  G.mode = 'career';
  G.distanceM = QUARTER_MILE;
  G.aiEt = stage.et + (Math.random() * 2 - 1) * 0.15;
  G.oppName = stage.name;
  G.oppCar = rivalCarFor(stage.et);
  G.theme = Math.min(THEMES.length - 1, Math.floor(G.career / 7));
  beginStaging();
}

// PvP duel: a solo run against the clock — the rival's time comes
// from their own on-chain submission, settle picks the lower ET
function startDuelRace() {
  if (!G.duel || G.duel.submitted) return;
  G.mode = 'duel';
  G.distanceM = QUARTER_MILE;
  G.aiEt = 9999;
  G.oppName = 'DUEL RUN';
  G.oppCar = S.car;
  G.theme = Math.floor(Math.random() * THEMES.length);
  beginStaging();
}

const TREE = { amber1: 1.2, amber2: 1.8, amber3: 2.4, green: 3.0 };

function launch() {
  G.screen = 'race';
  G.raceT = 0;
  G.launchRpm = G.rpm;
  G.clutchTimer = 0.65;
  G.rt = G.throttle ? 0 : null;
  // burnout payoff: hot tires grip, overheated tires don't
  G.tireBonus = G.tireTemp >= 0.55 && G.tireTemp < 1.0 ? 1.06 : G.tireTemp >= 1.0 ? 0.97 : 1;
  if (G.launchRpm >= S.launchLo && G.launchRpm <= S.launchHi) {
    G.launchKind = 'perfect';
    setFlash('PERFECT LAUNCH!', '#5cff8a');
    buzz(60);
  } else if (G.launchRpm < 0.38 * S.redline) {
    G.launchKind = 'bog';
    G.bogTimer = 1.1;
    setFlash('BOGGED DOWN...', '#ff9a5c');
  } else if (G.launchRpm > 0.88 * S.limiter) {
    G.launchKind = 'spin';
    G.spinTimer = 1.3;
    setFlash('WHEELSPIN!', '#ffd15c');
  } else {
    G.launchKind = 'ok';
  }
}

function shiftUp() {
  if (G.screen !== 'race') return;
  if (G.gear >= S.gears.length || G.shiftTimer > 0) return;
  const perfect = G.rpm >= S.perfectLo && G.rpm <= S.perfectHi;
  const early = G.rpm < 0.78 * S.redline;
  G.gear++;
  G.shiftTimer = perfect ? S.perfectShiftTime : S.shiftTime;
  if (perfect) {
    G.perfectShifts++;
    setFlash('PERFECT SHIFT!', '#5cff8a');
    spawnFlame(false);
    buzz(30);
  } else if (early) {
    setFlash('EARLY SHIFT', '#ff9a5c');
  }
}

function shiftDown() {
  if (G.screen !== 'race') return;
  if (G.gear <= 1 || G.shiftTimer > 0) return;
  const matched = matchedRpm(G.speed, G.gear - 1);
  if (matched > S.limiter + 400) {
    setFlash('TOO FAST!', '#ff5c7a');
    return;
  }
  G.gear--;
  G.shiftTimer = S.shiftTime * 0.7;
}

function fireNos() {
  if (G.screen !== 'race') return;
  if (G.nosUsed || S.nosDuration <= 0) return;
  G.nosUsed = true;
  G.nosTimer = S.nosDuration;
  btnNos.classList.add('used');
  setFlash('NOS!', '#c9a8ff');
  G.shake = 0.3;
  buzz(80);
}

function setFlash(text, color) {
  G.flash = { text, color, t: 1.1 };
}

function applyRewards() {
  const won = G.et < G.aiEt;
  const lines = [];
  let total;
  if (G.mode === 'duel') {
    G.earned = { total: 0, lines: ['DUEL RUN - SUBMIT YOUR TIME ON-CHAIN'] };
    return;
  }
  if (G.mode === 'chainrank') {
    G.earned = { total: 0, lines: ['RANKED MATCH - SUBMIT YOUR TIME ON-CHAIN'] };
    return;
  }
  if (G.mode === 'ranked') {
    // Elo-style points vs the matched opponent
    const opp = G.rankedOpp || { rp: G.rp };
    const expected = 1 / (1 + Math.pow(10, (opp.rp - G.rp) / 400));
    const div = divisionOf(G.rp);
    const divIdx = DIVISIONS.indexOf(div);
    if (won) {
      G.lastRpDelta = Math.round(28 * (1 - expected)) + 4;
      G.rankedW++;
      total = 150 + divIdx * 125;
      lines.push('RANKED WIN $' + total);
    } else {
      G.lastRpDelta = -(Math.round(28 * expected) + 4);
      G.rankedL++;
      total = 50;
      lines.push('CONSOLATION $50');
    }
    G.rp = Math.max(0, G.rp + G.lastRpDelta);
    G.rankedOpp = null;
    if (G.launchKind === 'perfect') { total += 100; lines.push('LAUNCH $100'); }
    if (G.perfectShifts > 0) { const b = G.perfectShifts * 50; total += b; lines.push('SHIFTS $' + b); }
    if (G.newBest) { total += 100; lines.push('BEST $100'); }
    G.cash += total;
    G.earned = { total, lines };
    save();
    return;
  }
  if (G.mode === 'career') {
    const stage = CAREER[G.career];
    if (won) {
      total = stage.reward;
      lines.push('STAGE $' + total);
      G.career++;
    } else {
      total = 50;
      lines.push('CONSOLATION $50');
    }
  } else {
    const d = DIFFICULTIES[G.difficulty];
    const pay = DISTANCES[G.distIdx].payScale;
    if (won) {
      G.streak++;
      const mult = 1 + Math.min(1, (G.streak - 1) * 0.1);
      total = Math.round(d.win * mult * pay);
      lines.push('RACE $' + total + (G.streak > 1 ? ' · STREAK x' + G.streak : ''));
    } else {
      G.streak = 0;
      total = Math.round(d.lose * pay);
      lines.push('CONSOLATION $' + total);
    }
  }
  if (G.launchKind === 'perfect') { total += 100; lines.push('LAUNCH $100'); }
  if (G.perfectShifts > 0) {
    const b = G.perfectShifts * 50;
    total += b;
    lines.push('SHIFTS $' + b);
  }
  if (G.newBest) { total += 100; lines.push('BEST $100'); }
  G.cash += total;
  G.earned = { total, lines };
  save();
}

// ============================================================
// Physics
// ============================================================
function matchedRpm(speed, gear) {
  const ratio = S.gears[gear - 1] * S.finalDrive;
  return speed * 60 * ratio / (2 * Math.PI * S.wheelRadius);
}

function torqueAt(rpm) {
  // normalized torque curve: weak low, peak near 85% of redline
  const x = rpm / S.redline;
  let t;
  if (x < 0.25) t = 0.55;
  else if (x < 0.85) t = 0.55 + 0.45 * (x - 0.25) / 0.60;
  else {
    const span = S.limiter / S.redline - 0.85;
    t = Math.max(0.6, 1.0 - 0.35 * (x - 0.85) / span);
  }
  let tq = S.peakTorque * t;
  if (rpm > 0.55 * S.redline) tq *= S.turbo;
  if (rpm < 0.60 * S.redline) tq *= S.exhaust;
  return tq;
}

function updatePlayer(dt) {
  const inShift = G.shiftTimer > 0;
  if (inShift) G.shiftTimer -= dt;

  const matched = matchedRpm(G.speed, G.gear);
  const slipping = G.clutchTimer > 0;
  if (slipping) G.clutchTimer -= dt;

  if (G.screen === 'staging') {
    if (G.throttle) G.rpm += S.revUp * dt;
    else G.rpm -= S.revDown * dt;
    G.rpm = Math.max(S.idle, Math.min(S.limiter, G.rpm));
    if (G.stage === 'burnout') {
      // spinning the tires heats them up; idling cools them down
      if (G.throttle && G.rpm > 0.5 * S.redline) {
        G.tireTemp = Math.min(1.15, G.tireTemp + dt * 0.42 * (G.rpm / S.redline));
        if (Math.random() < 0.5) spawnSmoke();
      } else {
        G.tireTemp = Math.max(0, G.tireTemp - dt * 0.08);
      }
    }
    return;
  }

  if (inShift) {
    G.rpm += (Math.max(matched, S.idle) - G.rpm) * Math.min(1, dt * 9);
  } else if (slipping) {
    const k = 1 - Math.max(0, G.clutchTimer) / 0.65;
    G.rpm = G.launchRpm + (Math.max(matched, S.idle * 1.4) - G.launchRpm) * k;
  } else {
    G.rpm = Math.max(matched, S.idle);
  }
  G.rpm = Math.min(G.rpm, S.limiter);

  let force = 0;
  if (G.throttle && !inShift) {
    const ratio = S.gears[G.gear - 1] * S.finalDrive;
    let tq = torqueAt(G.rpm);
    if (G.rpm >= S.limiter - 50) tq *= 0.15;
    if (G.bogTimer > 0) tq *= 0.45;
    if (G.nosTimer > 0) tq *= S.nosPower;
    force = tq * ratio * 0.90 / S.wheelRadius;
    let grip = S.traction * G.tireBonus;
    if (G.spinTimer > 0) grip *= 0.55;
    if (G.launchKind === 'perfect' && G.raceT < 2.5) grip *= 1.12;
    if (force > grip) {
      if (G.speed < 30 && G.spinTimer <= 0 && Math.random() < 0.3) spawnSmoke();
      force = grip;
    }
  }
  if (G.nosTimer > 0) {
    G.nosTimer -= dt;
    if (Math.random() < 0.6) spawnFlame(true);
  }
  if (G.bogTimer > 0) G.bogTimer -= dt;
  if (G.spinTimer > 0) { G.spinTimer -= dt; if (Math.random() < 0.5) spawnSmoke(); }

  const drag = S.drag * G.speed * G.speed;
  const accel = (force - drag - 220) / S.mass;
  G.speed = Math.max(0, G.speed + accel * dt);
  G.pos += G.speed * dt;

  if (G.rt === null && G.throttle) G.rt = G.raceT;

  // record the run for the ghost replay (10 samples/s)
  while (G.trace.length < Math.floor(G.raceT * 10) && G.trace.length < 400) {
    G.trace.push(Math.round(G.pos * 10) / 10);
  }

  if (!G.finished && G.pos >= G.distanceM) {
    G.finished = true;
    G.et = G.raceT;
    G.trap = G.speed * 3.6;
    G.finishFlash = 0.18;
    buzz([40, 60, 40]);
    const key = bestKey();
    if (!G.best[key] || G.et < G.best[key]) {
      G.best[key] = G.et;
      G.newBest = true;
      G.ghosts[key] = G.trace.slice();
      save();
    }
  }
}

function updateAI(dt) {
  if (G.mode === 'duel' || G.mode === 'chainrank') return; // rival races on their own device
  const t = G.raceT;
  const p = G.distanceM * Math.pow(Math.min(t, G.aiEt) / G.aiEt, 1.55);
  if (t <= G.aiEt) {
    G.aiSpeed = (p - G.aiPos) / dt || G.aiSpeed;
    G.aiPos = p;
  } else {
    G.aiFinished = true;
    G.aiPos += G.aiSpeed * dt;
  }
  if (G.aiPos >= G.distanceM) G.aiFinished = true;
}

// ============================================================
// Particles
// ============================================================
const PLAYER_X = 76;
const PLAYER_BOTTOM = 147; // lane floor for player car
const AI_BOTTOM = 112;

function playerRearWheel() {
  const car = S.car;
  return { x: PLAYER_X + car.wheels[0].x + car.wheels[0].s / 2, y: PLAYER_BOTTOM - 2 };
}

function spawnSmoke() {
  const rw = playerRearWheel();
  G.particles.push({
    kind: 'smoke',
    x: rw.x + Math.random() * 6 - 3, y: rw.y + Math.random() * 2,
    vx: -25 - Math.random() * 20, vy: -8 - Math.random() * 10,
    life: 0.7 + Math.random() * 0.4,
  });
}
function spawnFlame(nos) {
  const car = S.car;
  const n = nos ? 2 : 5;
  for (let i = 0; i < n; i++) {
    G.particles.push({
      kind: nos ? 'nosflame' : 'flame',
      x: PLAYER_X - 1, y: PLAYER_BOTTOM - 5 + Math.random() * 3 - (car.id === 'dragster' ? 4 : 0),
      vx: -70 - Math.random() * 50, vy: (Math.random() - 0.5) * 20,
      life: 0.22 + Math.random() * 0.15,
    });
  }
  if (!nos) G.shake = 0.2;
}
function updateParticles(dt) {
  for (const p of G.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
  }
  G.particles = G.particles.filter(p => p.life > 0);
}

// ============================================================
// Main update
// ============================================================
function update(dt) {
  G.time += dt;
  if (G.flash) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
  if (G.shake > 0) G.shake -= dt;
  if (G.rankedSearchT > 0) {
    G.rankedSearchT -= dt;
    if (G.rankedSearchT <= 0) G.rankedOpp = findRankedOpponent();
  }
  updateParticles(dt);

  if (G.screen === 'staging') {
    updatePlayer(dt);
    if (G.stage === 'burnout') {
      G.burnT += dt;
      if (G.burnT >= 3.0) {
        G.stage = 'tree';
        G.treeT = 0;
        if (G.tireTemp >= 0.55 && G.tireTemp < 1.0) setFlash('TIRES HOT!', PAL.green);
        else if (G.tireTemp >= 1.0) setFlash('OVERHEATED!', '#ff9a5c');
      }
    } else {
      G.treeT += dt;
      if (G.treeT >= TREE.green) launch();
    }
  } else if (G.screen === 'race') {
    // photo-finish slow motion when it's neck and neck near the stripe
    G.slowmo = G.mode !== 'duel' && !G.finished &&
      G.distanceM - G.pos < 30 && Math.abs(G.pos - G.aiPos) < 8;
    const rdt = G.slowmo ? dt * 0.35 : dt;
    G.raceT += rdt;
    updatePlayer(rdt);
    updateAI(rdt);
    if (G.finishFlash > 0) G.finishFlash -= dt;
    G.wheelFrame += G.speed * rdt * 3;
    if (G.finished && G.raceT >= G.et + 1.6) {
      gotoScreen('results');
      G.throttle = false;
      applyRewards();
    }
  }
  updateAudio();
}

// ============================================================
// RENDERING
// ============================================================
const PAL = {
  sky1: '#0a0a1e', sky2: '#141433',
  city: '#1b1b3a', cityLit: '#e8c85a',
  road: '#2a2a34', roadLine: '#c8c840',
  fence: '#3a3a4a',
  tire: '#111', hub: '#999',
  text: '#e8e8f4', dim: '#8a8aa8',
  green: '#5cff8a', amber: '#ffd15c', red: '#ff5c7a',
  cash: '#ffd166', nos: '#c9a8ff',
  panel: '#14142a', border: '#3a3a5c',
};

const PX_PER_M = 6;
const TRACK_TOP = 88, TRACK_BOT = 152;
const PLAYER_SCREEN = PLAYER_X + 18;

function carHeight(car) {
  return Math.max(car.sprite.length, car.wheelY + car.wheels[0].s);
}

function drawCarSprite(car, x, y, pal, frame, scale) {
  const s = scale || 1;
  for (let r = 0; r < car.sprite.length; r++) {
    const row = car.sprite[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      ctx.fillStyle =
        ch === 'b' ? pal.b :
        ch === 'h' ? pal.h :
        ch === 'w' ? pal.w :
        ch === 'x' ? '#181820' : pal.d;
      ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
  for (const wh of car.wheels) {
    drawWheel(x + wh.x * s, y + car.wheelY * s, wh.s * s, frame, s);
  }
  // headlight + taillight
  const lastRow = car.sprite.length - 2;
  ctx.fillStyle = '#fff7ae';
  ctx.fillRect(x + (car.sprite[lastRow].length - 1) * s, y + (lastRow - 1) * s, s, s);
  ctx.fillStyle = '#ff4040';
  ctx.fillRect(x, y + (lastRow - 1) * s, s, s);
}

function drawWheel(x, y, size, frame, scale) {
  ctx.fillStyle = PAL.tire;
  ctx.fillRect(x, y, size, size);
  const hub = Math.max(scale, Math.floor(size / 3));
  const off = (size - hub) / 2;
  ctx.fillStyle = PAL.hub;
  const f = Math.floor(frame) % 2;
  if (f === 0) ctx.fillRect(x + off, y + off, hub, hub);
  else {
    ctx.fillRect(x + off, y + off + hub / 2, hub, hub / 2);
    ctx.fillRect(x + off + hub / 2, y + off, hub / 2, hub);
  }
}

function drawRaceView() {
  const camX = G.pos * PX_PER_M - PLAYER_SCREEN;
  const T = THEMES[G.theme];

  const grad = ctx.createLinearGradient(0, 0, 0, 80);
  grad.addColorStop(0, T.sky1); grad.addColorStop(1, T.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 80);

  if (T.night) {
    ctx.fillStyle = '#ffffff44';
    for (let i = 0; i < 36; i++) {
      ctx.fillRect((i * 97 + 31) % W, (i * 53 + 11) % 42, 1, 1);
    }
    // moon
    ctx.fillStyle = T.moon;
    ctx.fillRect(414, 10, 10, 10);
    ctx.fillRect(412, 12, 14, 6);
    ctx.fillStyle = T.sky1;
    ctx.fillRect(416, 12, 4, 4);
  } else if (T.sun) {
    // low sun with glow bands
    ctx.fillStyle = T.sun + '33';
    ctx.fillRect(0, 44, W, 10);
    ctx.fillStyle = T.sun;
    ctx.fillRect(206, 40, 28, 14);
    ctx.fillRect(210, 36, 20, 22);
    ctx.fillStyle = T.sky2;
    ctx.fillRect(0, 47, W, 2);
    ctx.fillRect(0, 52, W, 1);
  }

  const cityOff = Math.floor(camX * 0.15) % 60;
  for (let i = -1; i < 10; i++) {
    const bx = i * 60 - cityOff;
    const h = 16 + ((i * 37 + 100) % 22);
    ctx.fillStyle = T.bld;
    ctx.fillRect(bx, 70 - h, 26, h);
    ctx.fillRect(bx + 30, 70 - (h * 0.7 | 0), 20, h * 0.7 | 0);
    if (T.night) {
      ctx.fillStyle = T.lit;
      for (let wy = 0; wy < h - 6; wy += 7) {
        if ((i * 13 + wy) % 3 === 0) ctx.fillRect(bx + 4, 70 - h + 3 + wy, 2, 2);
        if ((i * 7 + wy) % 4 === 0) ctx.fillRect(bx + 12, 70 - h + 3 + wy, 2, 2);
      }
    }
  }
  ctx.fillStyle = T.ground;
  ctx.fillRect(0, 70, W, 8);

  const fenceOff = Math.floor(camX * 0.5) % 12;
  ctx.fillStyle = T.fence;
  ctx.fillRect(0, 78, W, 3);
  for (let x = -fenceOff; x < W; x += 12) ctx.fillRect(x, 81, 2, 7);

  ctx.fillStyle = T.road;
  ctx.fillRect(0, TRACK_TOP, W, TRACK_BOT - TRACK_TOP);
  const dashOff = Math.floor(camX) % 24;
  ctx.fillStyle = PAL.roadLine;
  for (let x = -dashOff; x < W; x += 24) ctx.fillRect(x, 118, 12, 2);
  ctx.fillStyle = '#40404e';
  ctx.fillRect(0, TRACK_TOP, W, 2);
  ctx.fillRect(0, TRACK_BOT - 2, W, 2);

  const lastMark = Math.ceil(G.distanceM / 100) * 100;
  for (let m = 100; m <= lastMark; m += 100) {
    const sx = m * PX_PER_M - camX;
    if (sx > -20 && sx < W + 20) {
      ctx.fillStyle = '#55556a';
      ctx.fillRect(sx, TRACK_TOP, 2, TRACK_BOT - TRACK_TOP);
      ctx.fillStyle = PAL.dim;
      pixText(m + 'm', sx + 4, TRACK_TOP + 3, 6);
    }
  }
  const fx = G.distanceM * PX_PER_M - camX;
  if (fx > -30 && fx < W + 30) {
    for (let y = TRACK_TOP; y < TRACK_BOT; y += 4) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = ((y / 4 + i) % 2 === 0) ? '#fff' : '#111';
        ctx.fillRect(fx + i * 4, y, 4, 4);
      }
    }
  }

  // speed lines at high velocity
  if (G.screen === 'race' && G.speed > 42) {
    ctx.fillStyle = 'rgba(220,220,240,0.25)';
    for (let i = 0; i < 5; i++) {
      const ly = 92 + ((i * 37 + Math.floor(G.raceT * 60) * 13) % 56);
      const lx = (i * 131 + Math.floor(G.raceT * 900)) % (W + 60) - 30;
      ctx.fillRect(W - lx, ly, 14 + G.speed / 6, 1);
    }
  }

  // opponent car (upper lane)
  const oppH = carHeight(G.oppCar);
  const aiX = PLAYER_SCREEN + (G.aiPos - G.pos) * PX_PER_M;
  if (aiX > -60 && aiX < W + 60) {
    drawCarSprite(G.oppCar, aiX - 16, AI_BOTTOM - oppH, RIVAL_PAL, G.wheelFrame * 0.9, 1);
  }
  // ghost of your best run (player lane, translucent)
  const ghost = G.ghosts[bestKey()];
  if (ghost && ghost.length > 1 && G.screen === 'race') {
    const gi = Math.min(G.raceT * 10, ghost.length - 1);
    const i0 = Math.floor(gi);
    const gp = ghost[i0] + (ghost[Math.min(i0 + 1, ghost.length - 1)] - ghost[i0]) * (gi - i0);
    const gx = PLAYER_SCREEN + (gp - G.pos) * PX_PER_M;
    if (gx > -60 && gx < W + 60) {
      ctx.globalAlpha = 0.3;
      drawCarSprite(S.car, gx - 16, PLAYER_BOTTOM - carHeight(S.car), carPal(S.car), G.wheelFrame, 1);
      ctx.globalAlpha = 1;
    }
  }
  // player car (lower lane)
  const myCar = S.car;
  const myH = carHeight(myCar);
  const shakeY = G.shake > 0 ? (Math.random() * 2 - 1) : 0;
  const carX = PLAYER_X, carY = PLAYER_BOTTOM - myH + shakeY;
  // headlight cone at night
  if (T.night) {
    const nose = carX + myCar.sprite[0].length;
    ctx.fillStyle = 'rgba(255,247,174,0.10)';
    ctx.beginPath();
    ctx.moveTo(nose, PLAYER_BOTTOM - 6);
    ctx.lineTo(nose + 60, PLAYER_BOTTOM - 12);
    ctx.lineTo(nose + 60, PLAYER_BOTTOM + 2);
    ctx.closePath();
    ctx.fill();
  }
  drawCarSprite(myCar, carX, carY, carPal(myCar), G.wheelFrame, 1);

  for (const p of G.particles) {
    if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(200,200,210,${Math.min(0.6, p.life)})`;
      const s = 2 + (0.9 - p.life) * 4;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    } else if (p.kind === 'nosflame') {
      ctx.fillStyle = p.life > 0.15 ? '#9a5cff' : '#5c8aff';
      ctx.fillRect(p.x, p.y, 4, 2);
    } else {
      ctx.fillStyle = p.life > 0.15 ? '#ffd15c' : '#ff7a3c';
      ctx.fillRect(p.x, p.y, 3, 2);
    }
  }

  // NOS tint + finish flash overlays
  if (G.nosTimer > 0) {
    ctx.fillStyle = 'rgba(130,90,255,0.08)';
    ctx.fillRect(0, 0, W, TRACK_BOT);
  }
  if (G.finishFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${G.finishFlash * 2.5})`;
    ctx.fillRect(0, 0, W, TRACK_BOT);
  }

  if ((G.screen === 'staging' && G.stage === 'tree') || (G.screen === 'race' && G.raceT < 1.2)) {
    drawTree();
  }
}

function drawTree() {
  const tx = 240, ty = 6;
  ctx.fillStyle = '#18181f';
  ctx.fillRect(tx - 8, ty - 3, 16, 56);
  ctx.strokeStyle = '#44445a';
  ctx.strokeRect(tx - 8.5, ty - 3.5, 17, 57);
  const t = G.screen === 'race' ? TREE.green : G.treeT;
  const lamps = [
    { on: t >= TREE.amber1, c: PAL.amber },
    { on: t >= TREE.amber2, c: PAL.amber },
    { on: t >= TREE.amber3, c: PAL.amber },
    { on: t >= TREE.green, c: PAL.green },
  ];
  lamps.forEach((l, i) => {
    ctx.fillStyle = l.on ? l.c : '#26262e';
    ctx.fillRect(tx - 4, ty + i * 13, 8, 8);
    if (l.on) {
      ctx.fillStyle = l.c + '44';
      ctx.fillRect(tx - 6, ty + i * 13 - 2, 12, 12);
    }
  });
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------
function drawDashboard() {
  ctx.fillStyle = '#0d0d18';
  ctx.fillRect(0, 152, W, H - 152);
  ctx.fillStyle = '#22223a';
  ctx.fillRect(0, 152, W, 2);

  ctx.fillStyle = PAL.dim;
  pixText('TIME', 14, 158, 7);
  ctx.fillStyle = PAL.text;
  pixText(G.raceT.toFixed(2) + 's', 44, 156, 9);
  ctx.fillStyle = PAL.dim;
  pixText('DIST', 292, 158, 7);
  ctx.fillStyle = PAL.text;
  pixText(Math.min(402, Math.round(G.pos)) + 'm', 324, 156, 9);

  const bx = 116, bw = 168;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(bx, 157, bw, 8);
  ctx.fillStyle = RIVAL_PAL.b;
  ctx.fillRect(bx + Math.min(1, G.aiPos / G.distanceM) * (bw - 4), 157, 4, 3);
  ctx.fillStyle = carPal(S.car).b;
  ctx.fillRect(bx + Math.min(1, G.pos / G.distanceM) * (bw - 4), 162, 4, 3);
  ctx.fillStyle = '#55556a';
  ctx.fillRect(bx + bw - 1, 155, 1, 12);

  // tire temperature bar (staging: aim for the green band)
  if (G.screen === 'staging') {
    ctx.fillStyle = PAL.dim;
    pixText('TIRES', 300, 166, 6);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(334, 166, 60, 6);
    ctx.fillStyle = '#2e5c3a';
    ctx.fillRect(334 + 60 * 0.55 / 1.15, 166, 60 * 0.45 / 1.15, 6);
    const tw = Math.min(1, G.tireTemp / 1.15) * 60;
    ctx.fillStyle = G.tireTemp >= 1.0 ? PAL.red : G.tireTemp >= 0.55 ? PAL.green : PAL.amber;
    ctx.fillRect(334, 167, tw, 4);
  }

  drawTacho(240, 218, 48);

  // gear box
  ctx.fillStyle = PAL.panel;
  ctx.fillRect(118, 172, 72, 50);
  ctx.strokeStyle = PAL.border;
  ctx.strokeRect(118.5, 172.5, 71, 49);
  ctx.fillStyle = PAL.dim;
  pixText('GEAR', 126, 177, 7);
  ctx.fillStyle = G.shiftTimer > 0 ? PAL.dim : PAL.text;
  pixText(G.shiftTimer > 0 ? '-' : String(G.gear), 146, 188, 28);

  // speed box
  ctx.fillStyle = PAL.panel;
  ctx.fillRect(290, 172, 72, 50);
  ctx.strokeStyle = PAL.border;
  ctx.strokeRect(290.5, 172.5, 71, 49);
  ctx.fillStyle = PAL.dim;
  pixText('KM/H', 298, 177, 7);
  ctx.fillStyle = G.nosTimer > 0 ? PAL.nos : PAL.text;
  pixText(String(Math.round(G.speed * 3.6)), 306, 194, 18);

  // boost gauge for turbo'd cars
  if (S.turbo > 1) {
    const spool = Math.min(1, Math.max(0, (G.rpm / S.redline - 0.4) / 0.5)) * (G.throttle ? 1 : 0.2);
    ctx.fillStyle = PAL.dim;
    pixText('BOOST', 298, 212, 6);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(330, 212, 30, 5);
    ctx.fillStyle = PAL.nos;
    ctx.fillRect(330, 213, 30 * spool, 3);
  }
}

function drawTacho(cx, cy, r) {
  ctx.fillStyle = PAL.panel;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAL.border; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;

  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const rpmToAngle = (rpm) => a0 + (rpm / S.maxRpm) * (a1 - a0);

  ctx.strokeStyle = PAL.red; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, rpmToAngle(S.redline), rpmToAngle(S.maxRpm));
  ctx.stroke();
  // launch sweet spot (staging only): green arc
  if (G.screen === 'staging') {
    ctx.strokeStyle = PAL.green;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, rpmToAngle(S.launchLo), rpmToAngle(S.launchHi));
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  const maxK = S.maxRpm / 1000;
  for (let k = 0; k <= maxK; k++) {
    const a = rpmToAngle(k * 1000);
    const c1 = Math.cos(a), s1 = Math.sin(a);
    ctx.strokeStyle = k * 1000 >= S.redline ? PAL.red : PAL.text;
    ctx.beginPath();
    ctx.moveTo(cx + c1 * (r - 4), cy + s1 * (r - 4));
    ctx.lineTo(cx + c1 * (r - 12), cy + s1 * (r - 12));
    ctx.stroke();
    ctx.fillStyle = k * 1000 >= S.redline ? PAL.red : PAL.dim;
    pixText(String(k), cx + c1 * (r - 19) - 2, cy + s1 * (r - 19) - 4, 8);
  }

  // shift light: launch window while staging, shift window in the race
  const inWindow = G.screen === 'staging'
    ? G.rpm >= S.launchLo && G.rpm <= S.launchHi
    : G.rpm >= S.perfectLo;
  const blink = G.screen === 'staging' || Math.floor(G.time * 10) % 2 === 0;
  ctx.fillStyle = inWindow && blink ? PAL.green : '#1e2e1e';
  ctx.fillRect(cx - 5, cy - r + 13, 10, 6);

  const a = rpmToAngle(Math.max(0, G.rpm));
  // needle flashes white at the limiter
  ctx.strokeStyle = G.rpm >= S.redline && Math.floor(G.time * 14) % 2 === 0 ? '#ffffff' : '#ff5c3c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8);
  ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#d8d8f0';
  ctx.fillRect(cx - 2, cy - 2, 4, 4);

  ctx.fillStyle = PAL.dim;
  pixText('RPM', cx - 10, cy + r - 22, 7);
  pixText('x1000', cx - 14, cy + r - 14, 6);
}

// ------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------
function pixText(str, x, y, size) {
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(str, Math.round(x), Math.round(y));
}
function pixTextCenter(str, y, size, atX) {
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  const w = ctx.measureText(str).width;
  ctx.fillText(str, Math.round((atX === undefined ? W / 2 : atX) - w / 2), Math.round(y));
}
function pixTextParts(parts, y, size) {
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  let total = 0;
  for (const p of parts) total += ctx.measureText(p.t).width;
  let x = Math.round((W - total) / 2);
  for (const p of parts) {
    ctx.fillStyle = p.c;
    ctx.fillText(p.t, x, Math.round(y));
    x += ctx.measureText(p.t).width;
  }
}

function panel(x, y, w, h, borderColor) {
  ctx.fillStyle = PAL.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = borderColor || PAL.border;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function starBg() {
  ctx.fillStyle = PAL.sky1;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff22';
  for (let i = 0; i < 50; i++) {
    ctx.fillRect((i * 97 + 31) % W, (i * 53 + 11) % H, 1, 1);
  }
}

function cashTag() {
  ctx.fillStyle = PAL.cash;
  const str = 'CASH $' + G.cash;
  ctx.font = 'bold 11px "Courier New", monospace';
  pixText(str, W - 20 - ctx.measureText(str).width, 12, 11);
}

// ------------------------------------------------------------
// Menu screen
// ------------------------------------------------------------
function drawMenu() {
  starBg();
  hits.length = 0;

  pixTextParts([
    { t: 'PIXEL ', c: PAL.red },
    { t: 'DRAG RACER', c: PAL.text },
  ], 12, 24);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('1/4 MILE · MANUAL GEARBOX', 40, 8);
  cashTag();

  // nav buttons (left column)
  const div = divisionOf(G.rp);
  const items = [
    { label: G.career >= CAREER.length ? 'CAREER  DONE!' : 'CAREER  ' + (G.career + 1) + '/' + CAREER.length, idx: 'career', color: PAL.red },
    { label: 'RANKED  ' + div.name + ' ' + G.rp, idx: 'ranked', color: div.color },
    { label: 'QUICK RACE', idx: 'quick', color: '#7ec8ff' },
    { label: 'GARAGE', idx: 'garage', color: PAL.cash },
    { label: 'DEALER', idx: 'dealer', color: PAL.green },
    { label: 'SHOP · PACKS', idx: 'shop', color: '#ff9a5c' },
    { label: sol.connected ? 'WALLET ' + sol.shortAddress : 'WALLET', idx: 'wallet', color: PAL.nos },
  ];
  items.forEach((it, i) => {
    const bx = 24, by = 44 + i * 29, bw = 190, bh = 25;
    panel(bx, by, bw, bh, it.color);
    ctx.fillStyle = it.color;
    pixText(it.label, bx + 12, by + 8, 10);
    hits.push({ x: bx, y: by, w: bw, h: bh, action: 'goto', idx: it.idx });
  });

  // current car preview (right)
  const car = S.car;
  const sc = 2;
  const cw = car.sprite[0].length * sc;
  const cx = 345 - cw / 2;
  drawCarSprite(car, cx, 120 - carHeight(car) * sc, carPal(car), G.time * 8, sc);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(240, 124, 210, 3);
  ctx.fillStyle = PAL.text;
  pixTextCenter(car.name, 136, 12, 345);
  ctx.fillStyle = PAL.dim;
  const best = G.best[G.carId];
  pixTextCenter(best ? 'BEST ' + best.toFixed(2) + 's' : 'NO TIME SET', 154, 8, 345);
  pixTextCenter(Math.round(S.peakTorque) + 'NM · ' + Math.round(S.mass) + 'KG', 168, 8, 345);

  // sound toggle
  const sx = 380, sy = 232, sw = 86, sh = 18;
  panel(sx, sy, sw, sh);
  ctx.fillStyle = G.muted ? PAL.dim : PAL.green;
  pixTextCenter(G.muted ? 'SOUND OFF' : 'SOUND ON', sy + 5, 8, sx + sw / 2);
  hits.push({ x: sx, y: sy, w: sw, h: sh, action: 'togglesound' });

  ctx.fillStyle = PAL.dim;
  pixTextCenter('3DAGI · v0.9 · SOLANA ' + CLUSTER.toUpperCase(), 254, 7);
  drawHUDFlash();
}

// ------------------------------------------------------------
// Quick race screen
// ------------------------------------------------------------
function drawQuick() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('QUICK RACE', 14, 10, 16);
  cashTag();

  DIFFICULTIES.forEach((d, i) => {
    const bw = 128, bh = 60, bx = 36 + i * 140, by = 70;
    panel(bx, by, bw, bh, d.color);
    ctx.fillStyle = d.color;
    pixTextCenter(d.name, by + 10, 15, bx + bw / 2);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('~' + (d.et * DISTANCES[G.distIdx].aiScale).toFixed(1) + 's CAR', by + 30, 8, bx + bw / 2);
    ctx.fillStyle = PAL.cash;
    pixTextCenter('WIN $' + Math.round(d.win * DISTANCES[G.distIdx].payScale), by + 44, 8, bx + bw / 2);
    hits.push({ x: bx, y: by, w: bw, h: bh, action: 'quickrace', idx: i });
  });

  // distance selector
  DISTANCES.forEach((d, i) => {
    const bw = 84, bh = 24, bx = 108 + i * 92, by = 148;
    const active = G.distIdx === i;
    panel(bx, by, bw, bh, active ? PAL.green : PAL.border);
    ctx.fillStyle = active ? PAL.green : PAL.dim;
    pixTextCenter(d.label, by + 8, 9, bx + bw / 2);
    hits.push({ x: bx, y: by, w: bw, h: bh, action: 'quickdist', idx: i });
  });

  ctx.fillStyle = PAL.dim;
  pixTextCenter('WIN STREAK PAYS UP TO 2X · PICK YOUR DISTANCE', 186, 8);

  backButton();
  drawHUDFlash();
}

function backButton() {
  const bx = 180, by = 232, bw = 120, bh = 26;
  panel(bx, by, bw, bh);
  ctx.fillStyle = PAL.text;
  pixTextCenter('< BACK', by + 8, 10);
  hits.push({ x: bx, y: by, w: bw, h: bh, action: 'goto', idx: 'menu' });
}

// ------------------------------------------------------------
// Shop screen — packs with premium cars, parts and paints
// ------------------------------------------------------------
function drawShop() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('SHOP', 14, 10, 16);
  ctx.fillStyle = PAL.dim;
  pixText('PACKS · ' + G.packsOpened + ' OPENED', 90, 15, 8);
  cashTag();

  PACKS.forEach((p, i) => {
    const bw = 136, bh = 96, bx = 24 + i * 148, by = 40;
    const afford = G.cash >= p.price;
    panel(bx, by, bw, bh, afford ? p.color : PAL.border);
    ctx.fillStyle = p.color;
    pixTextCenter(p.name, by + 10, 11, bx + bw / 2);
    // pack art: little crate
    ctx.fillStyle = p.color;
    ctx.fillRect(bx + bw / 2 - 10, by + 28, 20, 14);
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(bx + bw / 2 - 10, by + 33, 20, 3);
    ctx.fillStyle = PAL.dim;
    pixTextCenter(p.desc, by + 50, 6, bx + bw / 2);
    ctx.fillStyle = afford ? PAL.cash : PAL.red;
    pixTextCenter('BUY $' + p.price, by + 66, 10, bx + bw / 2);
    if (i === 2) {
      ctx.fillStyle = PAL.dim;
      pixTextCenter('PITY ' + G.pity + '/5', by + 82, 7, bx + bw / 2);
    }
    hits.push({ x: bx, y: by, w: bw, h: bh, action: 'buypack', idx: i });
  });

  // premium teaser row
  ctx.fillStyle = PAL.dim;
  pixText('PACK EXCLUSIVES:', 24, 152, 8);
  const wolf = CAR_BY_ID.wolf, bullet = CAR_BY_ID.bullet;
  drawCarSprite(wolf, 170, 168 - carHeight(wolf), G.owned.includes('wolf') ? carPal(wolf) : { b: '#22242c', h: '#33363e', d: '#16181e', w: '#33363e' }, G.time * 8, 1);
  drawCarSprite(bullet, 250, 168 - carHeight(bullet), G.owned.includes('bullet') ? carPal(bullet) : { b: '#22242c', h: '#33363e', d: '#16181e', w: '#33363e' }, G.time * 8, 1);
  ctx.fillStyle = G.owned.includes('wolf') ? PAL.green : PAL.dim;
  pixText('NIGHT WOLF' + (G.owned.includes('wolf') ? ' *' : ''), 150, 172, 7);
  ctx.fillStyle = G.owned.includes('bullet') ? PAL.green : PAL.dim;
  pixText('GOLDEN BULLET' + (G.owned.includes('bullet') ? ' *' : ''), 240, 172, 7);
  // premium paints
  for (let i = PREMIUM_PAINT_START; i < PAINTS.length; i++) {
    const owned = G.unlockedPaints.includes(i);
    ctx.fillStyle = owned ? PAINTS[i] : '#22242c';
    ctx.fillRect(350 + (i - PREMIUM_PAINT_START) * 22, 152, 16, 16);
    ctx.strokeStyle = owned ? PAINTS[i] : PAL.border;
    ctx.strokeRect(350.5 + (i - PREMIUM_PAINT_START) * 22, 152.5, 15, 15);
  }
  ctx.fillStyle = PAL.dim;
  pixText('PAINTS', 350, 172, 7);
  pixTextCenter('DROPS APPLY TO YOUR CURRENT CAR · PAINTS UNLOCK IN THE DEALER', 196, 7);

  backButton();

  // reveal overlay
  if (G.packReveal) {
    ctx.fillStyle = 'rgba(5,5,12,0.9)';
    ctx.fillRect(0, 0, W, H);
    const rv = G.packReveal;
    ctx.fillStyle = rv.color;
    pixTextCenter(rv.label, 96, 22);
    ctx.fillStyle = PAL.text;
    pixTextCenter(rv.sub, 132, 10);
    if (rv.car) {
      const c = CAR_BY_ID[rv.car];
      drawCarSprite(c, 240 - c.sprite[0].length, 88 - carHeight(c) * 2, c.pal, G.time * 8, 2);
    }
    ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
    pixTextCenter('TAP TO CONTINUE', 176, 10);
    hits.length = 0;
    hits.push({ x: 0, y: 0, w: W, h: H, action: 'packclose' });
  }

  drawHUDFlash();
}

// ------------------------------------------------------------
// Ranked screen — division ladder + matchmaking
// ------------------------------------------------------------
function drawRanked() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('RANKED', 14, 10, 16);
  ctx.fillStyle = PAL.dim;
  pixText('MONTHLY SEASON · 1/4 MILE', 130, 15, 8);
  cashTag();

  const div = divisionOf(G.rp);
  const divIdx = DIVISIONS.indexOf(div);
  const next = DIVISIONS[divIdx + 1];

  // division card
  panel(24, 40, 200, 96, div.color);
  ctx.fillStyle = div.color;
  pixText(div.name, 38, 52, 16);
  ctx.fillStyle = PAL.text;
  pixText(G.rp + ' RP', 38, 74, 12);
  ctx.fillStyle = PAL.dim;
  pixText(G.rankedW + 'W - ' + G.rankedL + 'L THIS SEASON', 38, 92, 8);
  // progress to next division
  if (next) {
    const p = (G.rp - div.min) / (next.min - div.min);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(38, 108, 160, 7);
    ctx.fillStyle = div.color;
    ctx.fillRect(38, 108, 160 * Math.max(0.02, Math.min(1, p)), 7);
    ctx.fillStyle = PAL.dim;
    pixText(next.min - G.rp + ' RP TO ' + next.name, 38, 120, 7);
  } else {
    ctx.fillStyle = div.color;
    pixText('TOP OF THE LADDER!', 38, 110, 8);
  }

  // matchmaking panel
  panel(244, 40, 222, 96, PAL.border);
  if (G.rankedSearchT > 0) {
    const dots = '.'.repeat(1 + Math.floor(G.time * 4) % 3);
    ctx.fillStyle = PAL.amber;
    pixTextCenter('SEARCHING' + dots, 74, 12, 355);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('MATCHING BY RP ' + G.rp, 94, 8, 355);
  } else if (G.rankedOpp) {
    const o = G.rankedOpp;
    ctx.fillStyle = PAL.text;
    pixTextCenter('VS ' + o.name, 50, 11, 355);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('~RP ' + o.rp + ' · RUNS ~' + o.et.toFixed(1) + 's', 66, 8, 355);
    drawCarSprite(o.car, 355 - o.car.sprite[0].length, 108 - carHeight(o.car), RIVAL_PAL, G.time * 8, 1);
    chainButton(258, 108, 92, 22, 'RE-SEARCH', PAL.dim, 'rankedsearch');
    chainButton(360, 108, 92, 22, 'RACE!', PAL.green, 'rankedrace');
  } else {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('WIN VS STRONGER RIVALS', 58, 8, 355);
    pixTextCenter('FOR BIGGER RP GAINS', 70, 8, 355);
    chainButton(280, 90, 150, 30, 'FIND OPPONENT', PAL.green, 'rankedsearch');
  }

  // division ladder strip
  DIVISIONS.forEach((d, i) => {
    const bx = 24 + i * 74, by = 152, bw = 68, bh = 34;
    const active = d === div;
    panel(bx, by, bw, bh, active ? d.color : PAL.border);
    ctx.fillStyle = active ? d.color : PAL.dim;
    pixTextCenter(d.name, by + 6, 7, bx + bw / 2);
    pixTextCenter(d.min + '+', by + 18, 7, bx + bw / 2);
  });

  // on-chain ladder row (Seeker / Android): real rivals, FUEL stakes,
  // RP lives on your player profile on Solana
  if (mwaSupported) {
    const live = !!G.chainCfg;
    ctx.fillStyle = PAL.nos;
    pixText('ON-CHAIN LADDER', 24, 196, 8);
    const m = G.chainMatch;
    const me = sol.address;
    const queued = G.chainQueue && me &&
      G.chainQueue.slots.some(s => s.player.toBase58() === me);
    if (!live) {
      ctx.fillStyle = PAL.dim;
      pixText('PROGRAM NOT LIVE YET', 150, 196, 8);
    } else if (m && !m.settled) {
      const myEt = m.a.toBase58() === me ? m.aEtMs : m.bEtMs;
      const theirEt = m.a.toBase58() === me ? m.bEtMs : m.aEtMs;
      ctx.fillStyle = PAL.text;
      pixText('MATCHED · POT ' + (2 * m.stake / 10 ** FUEL_DECIMALS).toFixed(0) + ' FUEL', 150, 196, 8);
      if (!myEt) {
        chainButton(330, 190, 136, 22, 'RACE RIVAL!', PAL.green, 'chainrace');
      } else if (theirEt || Date.now() / 1000 > m.deadline) {
        chainButton(330, 190, 136, 22, sol.busy ? 'SIGNING...' : 'SETTLE MATCH', PAL.cash, 'chainsettle');
      } else {
        ctx.fillStyle = PAL.amber;
        pixText('WAITING FOR RIVAL RUN...', 330, 196, 7);
      }
    } else if (queued) {
      ctx.fillStyle = PAL.amber;
      pixText('IN QUEUE · CHAIN RP ' + (G.chainPlayer ? G.chainPlayer.rp : '-'), 150, 196, 8);
      chainButton(330, 190, 136, 22, sol.busy ? '...' : 'LEAVE QUEUE', PAL.red, 'chainleave');
    } else {
      ctx.fillStyle = PAL.dim;
      pixText('STAKE ' + RANKED_STAKE + ' FUEL · RP ON-CHAIN', 150, 196, 8);
      chainButton(330, 190, 136, 22, sol.busy ? '...' : 'JOIN QUEUE', PAL.green, 'chainqueue');
    }
  } else {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('SEASON RESETS MONTHLY (RP HALVED) · WIN CASH BY DIVISION', 198, 7);
  }

  backButton();
  drawHUDFlash();
}

// ------------------------------------------------------------
// Career screen
// ------------------------------------------------------------
function drawCareer() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('CAREER', 14, 10, 16);
  cashTag();

  if (G.career >= CAREER.length) {
    ctx.fillStyle = PAL.cash;
    pixTextCenter('* CHAMPION *', 70, 26);
    ctx.fillStyle = PAL.text;
    pixTextCenter('YOU BEAT EVERY RIVAL ON THE STRIP', 120, 10);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('QUICK RACE STAYS OPEN FOR GRINDING', 145, 8);
    backButton();
    drawHUDFlash();
    return;
  }

  const stage = CAREER[G.career];
  const boss = !!stage.boss;

  // progress dots
  for (let i = 0; i < CAREER.length; i++) {
    const px = 40 + i * 21;
    ctx.fillStyle = i < G.career ? PAL.green : i === G.career ? PAL.amber : '#26263a';
    ctx.fillRect(px, 36, CAREER[i].boss ? 12 : 8, 6);
  }

  panel(60, 56, 360, 128, boss ? PAL.red : PAL.border);
  ctx.fillStyle = PAL.dim;
  pixText('STAGE ' + (G.career + 1) + '/' + CAREER.length, 76, 66, 8);
  if (boss) {
    ctx.fillStyle = PAL.red;
    pixText('!! BOSS !!', 340, 66, 9);
  }
  ctx.fillStyle = boss ? PAL.red : PAL.text;
  pixText(stage.name, 76, 80, 18);
  ctx.fillStyle = PAL.dim;
  pixText('RUNS THE 1/4 IN ~' + stage.et.toFixed(1) + 's', 76, 104, 9);
  ctx.fillStyle = PAL.cash;
  pixText('REWARD $' + stage.reward, 76, 120, 10);

  // rival car preview
  const rc = rivalCarFor(stage.et);
  const sc = 2;
  drawCarSprite(rc, 390 - rc.sprite[0].length, 170 - carHeight(rc) * sc, RIVAL_PAL, G.time * 8, sc);

  // your car hint
  ctx.fillStyle = PAL.dim;
  pixText('YOUR CAR: ' + S.car.name, 76, 140, 8);
  const best = G.best[G.carId];
  if (best) pixText('YOUR BEST: ' + best.toFixed(2) + 's', 76, 154, 8);

  const bx = 60, by = 196, bw = 360, bh = 30;
  panel(bx, by, bw, bh, PAL.green);
  ctx.fillStyle = PAL.green;
  pixTextCenter(Math.floor(G.time * 2) % 2 === 0 ? '> RACE ' + stage.name + ' <' : 'RACE ' + stage.name, by + 10, 11);
  hits.push({ x: bx, y: by, w: bw, h: bh, action: 'careerrace' });

  backButton();
  drawHUDFlash();
}

// ------------------------------------------------------------
// Garage screen
// ------------------------------------------------------------
function drawGarage() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('GARAGE', 14, 10, 16);
  ctx.fillStyle = PAL.dim;
  pixText(S.car.name, 120, 15, 10);
  cashTag();

  // dyno tune shortcut
  panel(250, 8, 96, 20, PAL.nos);
  ctx.fillStyle = PAL.nos;
  pixTextCenter('DYNO TUNE', 14, 8, 298);
  hits.push({ x: 250, y: 8, w: 96, h: 20, action: 'goto', idx: 'tune' });

  const parts = G.garage[G.carId];
  UPGRADES.forEach((upg, i) => {
    const col = i % 4, row = (i / 4) | 0;
    const tx = 14 + col * 116, ty = 34 + row * 84, tw = 110, th = 78;
    const lvl = parts[upg.id];
    const maxed = lvl >= MAX_LEVEL;
    const cost = maxed ? 0 : upg.prices[lvl];
    const afford = !maxed && G.cash >= cost;

    panel(tx, ty, tw, th, maxed ? PAL.green : afford ? PAL.cash : PAL.border);
    ctx.fillStyle = PAL.text;
    pixText(upg.name, tx + 7, ty + 6, 9);
    ctx.fillStyle = PAL.dim;
    pixText(maxed ? upg.stages[MAX_LEVEL - 1] : 'NEXT: ' + upg.stages[lvl], tx + 7, ty + 19, 6);

    for (let k = 0; k < MAX_LEVEL; k++) {
      ctx.fillStyle = k < lvl ? PAL.green : '#26263a';
      ctx.fillRect(tx + 7 + k * 13, ty + 30, 9, 6);
    }

    ctx.fillStyle = maxed ? PAL.green : afford ? PAL.cash : PAL.red;
    pixText(maxed ? 'MAX' : '$' + cost, tx + 7, ty + 43, 10);
    ctx.fillStyle = PAL.dim;
    pixText(maxed ? 'FULLY BUILT' : 'LV' + lvl + ' > LV' + (lvl + 1), tx + 7, ty + 60, 7);
    hits.push({ x: tx, y: ty, w: tw, h: th, action: 'buypart', idx: i });
  });

  // stats tile (8th slot)
  const tx = 14 + 3 * 116, ty = 34 + 84, tw = 110, th = 78;
  panel(tx, ty, tw, th);
  ctx.fillStyle = PAL.text;
  pixText('CAR SPECS', tx + 7, ty + 6, 8);
  ctx.fillStyle = PAL.dim;
  pixText('PWR ' + Math.round(S.peakTorque) + 'NM', tx + 7, ty + 20, 7);
  pixText('KG  ' + Math.round(S.mass), tx + 7, ty + 32, 7);
  pixText('GRIP ' + (S.traction / 1000).toFixed(1) + 'K', tx + 7, ty + 44, 7);
  pixText('NOS ' + (S.nosDuration ? S.nosDuration.toFixed(1) + 's' : '--'), tx + 7, ty + 56, 7);

  backButton();
  drawHUDFlash();
}

// ------------------------------------------------------------
// Dyno tune screen — gearing + NOS balance (Pixel Car Racer style)
// ------------------------------------------------------------
function drawTune() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('DYNO TUNE', 14, 10, 16);
  ctx.fillStyle = PAL.dim;
  pixText(S.car.name, 150, 15, 10);
  cashTag();

  const t = carTune();

  // car on the dyno
  drawCarSprite(S.car, 60, 66 - carHeight(S.car) * 2, carPal(S.car), G.time * 16, 2);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(40, 70, 140, 4);
  ctx.fillStyle = '#181820';
  ctx.fillRect(64, 74, 24, 6);
  ctx.fillRect(120, 74, 24, 6);

  // final drive row
  ctx.fillStyle = PAL.text;
  pixText('FINAL DRIVE', 220, 52, 10);
  ctx.fillStyle = PAL.cash;
  pixText(S.finalDrive.toFixed(2) + '  (' + t.fd + '%)', 220, 68, 11);
  panel(360, 52, 40, 30, PAL.border);
  ctx.fillStyle = PAL.text; pixTextCenter('-', 60, 14, 380);
  hits.push({ x: 360, y: 52, w: 40, h: 30, action: 'tunefd', idx: -1 });
  panel(408, 52, 40, 30, PAL.border);
  ctx.fillStyle = PAL.text; pixTextCenter('+', 60, 14, 428);
  hits.push({ x: 408, y: 52, w: 40, h: 30, action: 'tunefd', idx: 1 });
  ctx.fillStyle = PAL.dim;
  pixText('SHORT = HARDER LAUNCH · LONG = MORE TOP END', 220, 88, 7);

  // NOS mix row
  const hasNos = G.garage[G.carId].nitro > 0;
  ctx.fillStyle = PAL.text;
  pixText('NOS MIX', 220, 112, 10);
  if (hasNos) {
    ctx.fillStyle = PAL.nos;
    pixText('+' + Math.round((S.nosPower - 1) * 100) + '% FOR ' + S.nosDuration.toFixed(1) + 's', 220, 128, 11);
    panel(360, 112, 40, 30, PAL.border);
    ctx.fillStyle = PAL.text; pixTextCenter('-', 120, 14, 380);
    hits.push({ x: 360, y: 112, w: 40, h: 30, action: 'tunenos', idx: -1 });
    panel(408, 112, 40, 30, PAL.border);
    ctx.fillStyle = PAL.text; pixTextCenter('+', 120, 14, 428);
    hits.push({ x: 408, y: 112, w: 40, h: 30, action: 'tunenos', idx: 1 });
    ctx.fillStyle = PAL.dim;
    pixText('- LONG SOFT SPRAY · + SHORT HARD PUNCH', 220, 148, 7);
  } else {
    ctx.fillStyle = PAL.dim;
    pixText('INSTALL A NOS KIT IN THE GARAGE FIRST', 220, 128, 8);
  }

  // current stats
  ctx.fillStyle = PAL.dim;
  pixText('PWR ' + Math.round(S.peakTorque) + 'NM', 40, 108, 8);
  pixText('KG ' + Math.round(S.mass), 40, 122, 8);
  pixText('GRIP ' + (S.traction / 1000).toFixed(1) + 'K', 40, 136, 8);
  const best = G.best[G.carId];
  pixText('BEST ' + (best ? best.toFixed(3) + 's' : '--'), 40, 150, 8);

  ctx.fillStyle = PAL.dim;
  pixTextCenter('SETUP SAVED PER CAR · TEST IT ON THE STRIP', 190, 7);

  const bx = 180, by = 214, bw = 120, bh = 26;
  panel(bx, by, bw, bh);
  ctx.fillStyle = PAL.text;
  pixTextCenter('< GARAGE', by + 8, 10);
  hits.push({ x: bx, y: by, w: bw, h: bh, action: 'goto', idx: 'garage' });

  drawHUDFlash();
}

// ------------------------------------------------------------
// Dealer screen
// ------------------------------------------------------------
function drawDealer() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('DEALER', 14, 10, 16);
  cashTag();

  const car = CARS[G.dealerIdx];
  const owned = G.owned.includes(car.id);
  const selected = G.carId === car.id;

  // arrows
  panel(20, 100, 36, 44);
  ctx.fillStyle = PAL.text;
  pixText('<', 32, 112, 18);
  hits.push({ x: 10, y: 80, w: 60, h: 90, action: 'dealerprev' });
  panel(424, 100, 36, 44);
  ctx.fillStyle = PAL.text;
  pixText('>', 436, 112, 18);
  hits.push({ x: 410, y: 80, w: 60, h: 90, action: 'dealernext' });

  // car sprite big (owned cars show their paint)
  const sc = 3;
  const cw = car.sprite[0].length * sc;
  drawCarSprite(car, 240 - cw / 2, 118 - carHeight(car) * sc, owned ? carPal(car) : car.pal, G.time * 8, sc);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(90, 126, 300, 3);

  ctx.fillStyle = PAL.text;
  pixTextCenter(car.name, 36, 16);
  ctx.fillStyle = PAL.dim;
  pixTextCenter((G.dealerIdx + 1) + '/' + CARS.length + ' · STOCK 1/4: ~' + car.etHint.toFixed(1) + 's', 58, 8);

  // stat bars
  const stats = [
    { label: 'POWER',  v: car.torque / 1025 },
    { label: 'GRIP',   v: car.traction / 22000 },
    { label: 'WEIGHT', v: 1 - (car.mass - 880) / (1480 - 880) },
  ];
  stats.forEach((st, i) => {
    const sx = 110 + i * 96;
    ctx.fillStyle = PAL.dim;
    pixText(st.label, sx, 140, 7);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(sx, 150, 80, 7);
    ctx.fillStyle = car.pal.b;
    ctx.fillRect(sx, 150, Math.max(4, 80 * st.v), 7);
  });

  // action button
  const bx = 140, by = 174, bw = 200, bh = 34;
  let label, color, tappable = !selected;
  if (selected) { label = 'SELECTED'; color = PAL.dim; }
  else if (owned) { label = 'SELECT'; color = PAL.green; }
  else if (car.packOnly) { label = 'PACK EXCLUSIVE'; color = '#ff9a5c'; tappable = false; }
  else { label = 'BUY $' + car.price; color = G.cash >= car.price ? PAL.cash : PAL.red; }
  panel(bx, by, bw, bh, color);
  ctx.fillStyle = color;
  pixTextCenter(label, by + 11, 12);
  if (tappable) hits.push({ x: bx, y: by, w: bw, h: bh, action: 'dealeraction' });

  // paint shop for owned cars
  if (owned) {
    const px = 352, pw = 110;
    panel(px, by, pw, bh, carPal(car).b);
    ctx.fillStyle = carPal(car).b;
    pixTextCenter('PAINT >', by + 11, 11, px + pw / 2);
    hits.push({ x: px, y: by, w: pw, h: bh, action: 'paintcycle' });
  }

  // car NFTs: mint with FUEL (burned), tradeable on any marketplace
  // (pack exclusives are not mintable on-chain in v1)
  if (mwaSupported && G.dealerIdx < CAR_MODELS) {
    const isNft = G.nftModels.includes(G.dealerIdx);
    const nx = 20, ny = 214, nw = 110, nh = 40;
    if (isNft) {
      panel(nx, ny, nw, nh, PAL.nos);
      ctx.fillStyle = PAL.nos;
      pixTextCenter('NFT OWNED', ny + 8, 9, nx + nw / 2);
      ctx.fillStyle = PAL.dim;
      pixTextCenter('IN YOUR WALLET', ny + 22, 6, nx + nw / 2);
    } else {
      const live = !!G.chainCfg;
      panel(nx, ny, nw, nh, live ? PAL.nos : PAL.border);
      ctx.fillStyle = live ? PAL.nos : PAL.dim;
      pixTextCenter('MINT NFT', ny + 8, 9, nx + nw / 2);
      ctx.fillStyle = PAL.dim;
      pixTextCenter(CAR_PRICES_FUEL[G.dealerIdx] + ' FUEL', ny + 22, 7, nx + nw / 2);
      if (live) hits.push({ x: nx, y: ny, w: nw, h: nh, action: 'mintnft' });
    }
  }

  backButton();
  drawHUDFlash();
}

// ------------------------------------------------------------
// On-chain hub: wallet / season leaderboard / PvP duels / referrals
// ------------------------------------------------------------
function fmtDur(sec) {
  if (sec <= 0) return 'ENDED';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? d + 'D ' + h + 'H' : h > 0 ? h + 'H ' + m + 'M' : m + 'M';
}

function chainButton(bx, by, bw, bh, label, color, action, idx) {
  panel(bx, by, bw, bh, color);
  ctx.fillStyle = color;
  pixTextCenter(label, by + (bh - 9) / 2, 9, bx + bw / 2);
  hits.push({ x: bx, y: by, w: bw, h: bh, action, idx });
}

function drawWallet() {
  starBg();
  hits.length = 0;
  ctx.fillStyle = PAL.text;
  pixText('ON-CHAIN', 14, 10, 15);
  ctx.fillStyle = PAL.nos;
  pixText('SOLANA · ' + CLUSTER.toUpperCase(), 128, 14, 8);
  ctx.fillStyle = PAL.cash;
  const fuelStr = 'FUEL ' + Math.floor(G.fuel);
  ctx.font = 'bold 11px "Courier New", monospace';
  pixText(fuelStr, W - 20 - ctx.measureText(fuelStr).width, 12, 11);

  // tabs
  const tabs = [
    { id: 'wallet', label: 'WALLET' },
    { id: 'board', label: 'BOARD' },
    { id: 'duel', label: 'DUEL' },
    { id: 'market', label: 'MARKET' },
    { id: 'ref', label: 'REFER' },
  ];
  tabs.forEach((t, i) => {
    const bx = 14 + i * 82, by = 30, bw = 78, bh = 20;
    const active = G.chainTab === t.id;
    panel(bx, by, bw, bh, active ? PAL.nos : PAL.border);
    ctx.fillStyle = active ? PAL.nos : PAL.dim;
    pixTextCenter(t.label, by + 6, 8, bx + bw / 2);
    hits.push({ x: bx, y: by, w: bw, h: bh, action: 'chaintab', idx: t.id });
  });
  chainButton(424, 30, 42, 20, G.chainLoading ? '...' : 'SYNC', PAL.dim, 'chainrefresh');

  const tab = G.chainTab;
  if (tab === 'wallet') drawChainWallet();
  else if (tab === 'board') drawChainBoard();
  else if (tab === 'duel') drawChainDuel();
  else if (tab === 'market') drawChainMarket();
  else drawChainRef();

  if (G.chainMsg) {
    ctx.fillStyle = PAL.amber;
    pixTextCenter(G.chainMsg, 200, 8);
  } else if (sol.error) {
    ctx.fillStyle = PAL.red;
    pixTextCenter(sol.error, 200, 8);
  }

  backButton();
  drawHUDFlash();
}

function drawChainWallet() {
  if (!mwaSupported) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('WALLET ACTIONS RUN ON THE', 80, 10);
    pixTextCenter('ANDROID / SOLANA SEEKER BUILD', 96, 10);
    ctx.fillStyle = PAL.text;
    pixTextCenter('LEADERBOARD IS LIVE ON EVERY PLATFORM', 124, 8);
    return;
  }
  if (!sol.connected) {
    ctx.fillStyle = PAL.text;
    pixTextCenter('CONNECT YOUR SOLANA WALLET', 70, 11);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('EARN $FUEL FOR RECORDS · STAKE IT IN DUELS', 90, 8);
    chainButton(140, 112, 200, 32, sol.busy ? 'OPENING...' : 'CONNECT WALLET', sol.busy ? PAL.dim : PAL.green, 'connect');
    return;
  }
  ctx.fillStyle = PAL.green;
  pixText('CONNECTED', 24, 62, 9);
  ctx.fillStyle = PAL.text;
  pixText(sol.shortAddress, 110, 60, 12);
  chainButton(320, 58, 70, 16, 'COPY', PAL.dim, 'copyaddr');
  chainButton(398, 58, 68, 16, 'LOG OUT', PAL.dim, 'disconnect');

  const p = G.chainPlayer;
  ctx.fillStyle = PAL.dim;
  pixText('FUEL BALANCE', 24, 88, 8);
  ctx.fillStyle = PAL.cash;
  pixText(G.fuel.toFixed(2), 130, 86, 12);
  ctx.fillStyle = PAL.dim;
  pixText('CLAIMABLE', 24, 108, 8);
  const claimable = p ? p.claimable / 10 ** FUEL_DECIMALS : 0;
  ctx.fillStyle = claimable > 0 ? PAL.green : PAL.dim;
  pixText(claimable.toFixed(2), 130, 106, 12);
  if (p) {
    ctx.fillStyle = PAL.dim;
    pixText('SEASON RACES ' + p.races + ' · SEASON BEST ' +
      (p.bestEtMs === 0xffffffff ? '--' : (p.bestEtMs / 1000).toFixed(3) + 's'), 24, 128, 8);
  } else {
    ctx.fillStyle = PAL.dim;
    pixText('NOT REGISTERED YET - SUBMIT A TIME TO START', 24, 128, 8);
  }
  if (claimable > 0) {
    chainButton(280, 96, 186, 30, sol.busy ? 'SIGNING...' : 'CLAIM $FUEL', PAL.cash, 'claimfuel');
  }
  if (sol.lastSig) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('TX ' + sol.lastSig.slice(0, 8) + '..' + sol.lastSig.slice(-8), 152, 7);
  }
}

function drawChainBoard() {
  const cfg = G.chainCfg;
  if (!cfg) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter(G.chainLoading ? 'LOADING...' : 'TAP SYNC TO LOAD THE BOARD', 110, 10);
    return;
  }
  const now = Date.now() / 1000;
  ctx.fillStyle = PAL.text;
  pixText('SEASON ' + cfg.season, 24, 58, 11);
  ctx.fillStyle = PAL.amber;
  pixText('ENDS IN ' + fmtDur(cfg.seasonEnd - now), 130, 60, 8);
  ctx.fillStyle = PAL.dim;
  pixText('TOP PRIZE ' + (cfg.baseReward * 500 / 10 ** FUEL_DECIMALS).toFixed(0) + ' FUEL', 300, 60, 8);

  const entries = G.board ? G.board.entries : [];
  if (entries.length === 0) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('NO TIMES YET - BE THE FIRST', 120, 9);
  }
  entries.slice(0, 8).forEach((e, i) => {
    const y = 76 + i * 15;
    const mine = sol.address && e.wallet === sol.address;
    ctx.fillStyle = i === 0 ? PAL.cash : mine ? PAL.green : PAL.dim;
    pixText(String(i + 1).padStart(2), 24, y, 9);
    ctx.fillStyle = mine ? PAL.green : PAL.text;
    pixText(e.wallet.slice(0, 4) + '..' + e.wallet.slice(-4), 48, y, 9);
    ctx.fillStyle = mine ? PAL.green : PAL.text;
    pixText((e.etMs / 1000).toFixed(3) + 's', 170, y, 9);
    ctx.fillStyle = PAL.dim;
    pixText((CARS[e.car] ? CARS[e.car].name : '?'), 250, y, 8);
  });

  const best = G.best[G.carId];
  ctx.fillStyle = PAL.dim;
  pixText('YOUR BEST', 360, 80, 8);
  ctx.fillStyle = PAL.text;
  pixText(best ? best.toFixed(3) + 's' : '--', 360, 92, 10);
  if (mwaSupported && best) {
    chainButton(352, 112, 114, 28, sol.busy ? 'SIGNING...' : 'SUBMIT', PAL.green, 'submitboard');
  }
}

function drawChainDuel() {
  if (!mwaSupported) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('PVP DUELS RUN ON THE ANDROID / SEEKER BUILD', 110, 9);
    return;
  }
  const d = G.duel;
  if (!d) {
    ctx.fillStyle = PAL.text;
    pixTextCenter('STAKE $FUEL · BEST 1/4 MILE TAKES THE POT', 62, 9);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('3% RAKE GETS BURNED', 76, 7);
    chainButton(60, 96, 110, 32, 'STAKE: ' + DUEL_STAKES[G.duelStakeIdx], PAL.cash, 'duelstake');
    chainButton(185, 96, 130, 32, sol.busy ? 'SIGNING...' : 'CREATE DUEL', PAL.green, 'duelcreate');
    chainButton(330, 96, 130, 32, 'JOIN (PASTE)', PAL.nos, 'dueljoin');
    ctx.fillStyle = PAL.dim;
    pixTextCenter('CREATE COPIES A CODE - SEND IT TO YOUR RIVAL', 142, 7);
    pixTextCenter('JOIN READS THE CODE FROM YOUR CLIPBOARD', 154, 7);
    return;
  }
  const info = G.duelInfo;
  ctx.fillStyle = PAL.text;
  pixText('DUEL #' + d.seed + ' · ' + (d.role === 'creator' ? 'YOU CREATED' : 'YOU JOINED'), 24, 60, 9);
  chainButton(370, 56, 96, 18, 'COPY CODE', PAL.dim, 'copyduel');
  if (!info) {
    ctx.fillStyle = PAL.dim;
    pixText(G.chainLoading ? 'LOADING DUEL...' : 'TAP SYNC TO UPDATE', 24, 80, 8);
  } else {
    ctx.fillStyle = PAL.cash;
    pixText('POT ' + (2 * info.stake / 10 ** FUEL_DECIMALS).toFixed(0) + ' FUEL', 24, 78, 9);
    const oppJoined = info.opponent.toBase58() !== '11111111111111111111111111111111';
    ctx.fillStyle = oppJoined ? PAL.green : PAL.amber;
    pixText(oppJoined ? 'RIVAL JOINED' : 'WAITING FOR RIVAL...', 130, 78, 9);
    const meCreator = d.role === 'creator';
    const myEt = meCreator ? info.creatorEtMs : info.opponentEtMs;
    const theirEt = meCreator ? info.opponentEtMs : info.creatorEtMs;
    ctx.fillStyle = PAL.dim;
    pixText('YOU:   ' + (myEt ? (myEt / 1000).toFixed(3) + 's' : 'NO RUN YET'), 24, 96, 9);
    pixText('RIVAL: ' + (theirEt ? (theirEt / 1000).toFixed(3) + 's' : 'NO RUN YET'), 24, 110, 9);
    if (info.settled) {
      ctx.fillStyle = PAL.green;
      pixText('SETTLED - GG!', 24, 128, 10);
      chainButton(330, 124, 136, 24, 'NEW DUEL', PAL.green, 'duelclear');
    } else {
      const both = info.creatorEtMs > 0 && info.opponentEtMs > 0;
      const expired = Date.now() / 1000 > info.deadline;
      if (!G.duel.submitted && !myEt) {
        chainButton(330, 92, 136, 28, 'RACE NOW!', PAL.green, 'duelrace');
      }
      if (both || (oppJoined && expired)) {
        chainButton(330, 126, 136, 26, sol.busy ? 'SIGNING...' : 'SETTLE DUEL', PAL.cash, 'duelsettle');
      } else if (!oppJoined && expired && meCreator) {
        chainButton(330, 126, 136, 26, 'CANCEL+REFUND', PAL.red, 'duelcancel');
      }
      ctx.fillStyle = PAL.dim;
      pixText('DEADLINE IN ' + fmtDur(info.deadline - Date.now() / 1000), 24, 146, 7);
    }
  }
  ctx.fillStyle = PAL.dim;
  pixText('FORGET THIS DUEL', 24, 166, 7);
  hits.push({ x: 24, y: 162, w: 110, h: 14, action: 'duelclear' });
}

// player-to-player car NFT market (3% fee burned)
function drawChainMarket() {
  if (!mwaSupported) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('THE NFT MARKET RUNS ON THE ANDROID / SEEKER BUILD', 110, 9);
    return;
  }
  if (!G.chainCfg) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter(G.chainLoading ? 'LOADING...' : 'PROGRAM NOT LIVE YET', 110, 9);
    return;
  }
  ctx.fillStyle = PAL.dim;
  pixText('OPEN LISTINGS · 3% FEE BURNED', 24, 56, 7);

  const me = sol.address;
  if (G.listings.length === 0) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('NO CARS ON THE MARKET - LIST YOURS!', 92, 8);
  }
  G.listings.slice(0, 5).forEach((l, i) => {
    const y = 68 + i * 18;
    const mine = me && l.seller.toBase58() === me;
    const car = CARS[l.model];
    ctx.fillStyle = mine ? PAL.green : PAL.text;
    pixText((car ? car.name : '?') + ' #' + (l.index + 1), 24, y, 8);
    ctx.fillStyle = PAL.cash;
    pixText((l.price / 10 ** FUEL_DECIMALS).toFixed(0) + ' FUEL', 160, y, 8);
    ctx.fillStyle = PAL.dim;
    pixText(mine ? 'YOU' : l.seller.toBase58().slice(0, 4) + '..', 246, y, 8);
    if (mine) {
      chainButton(310, y - 3, 70, 14, 'CANCEL', PAL.red, 'marketcancel', i);
    } else {
      chainButton(310, y - 3, 70, 14, sol.busy ? '...' : 'BUY', PAL.green, 'marketbuy', i);
    }
  });

  // list one of my NFTs
  const listedMints = G.listings.filter(l => me && l.seller.toBase58() === me).map(l => l.mint.toBase58());
  const unlisted = G.nftInstances.find(n => !listedMints.includes(n.mint.toBase58()));
  if (unlisted) {
    const car = CARS[unlisted.model];
    ctx.fillStyle = PAL.dim;
    pixText('SELL: ' + (car ? car.name : '?') + ' #' + (unlisted.index + 1), 24, 166, 8);
    chainButton(200, 160, 110, 20, LIST_PRICES[G.listPriceIdx] + ' FUEL >', PAL.cash, 'marketprice');
    chainButton(320, 160, 110, 20, sol.busy ? '...' : 'LIST IT', PAL.green, 'marketlist');
  } else if (sol.connected) {
    ctx.fillStyle = PAL.dim;
    pixText('NO UNLISTED CAR NFTS IN YOUR WALLET', 24, 166, 8);
  }
}

function drawChainRef() {
  ctx.fillStyle = PAL.text;
  pixTextCenter('INVITE RACERS - EARN ' + (G.chainCfg ? G.chainCfg.referralBps / 100 : 5) + '% OF THEIR $FUEL', 60, 9);
  if (!mwaSupported) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('REFERRALS RUN ON THE ANDROID / SEEKER BUILD', 110, 9);
    return;
  }
  if (sol.connected) {
    ctx.fillStyle = PAL.dim;
    pixText('YOUR CODE (= YOUR WALLET)', 24, 84, 8);
    ctx.fillStyle = PAL.text;
    pixText(sol.shortAddress, 24, 96, 11);
    chainButton(200, 90, 120, 24, 'COPY CODE', PAL.green, 'copyaddr');
    const p = G.chainPlayer;
    ctx.fillStyle = PAL.dim;
    pixText('RECRUITS', 24, 126, 8);
    pixText('EARNED', 150, 126, 8);
    ctx.fillStyle = PAL.text;
    pixText(String(p ? p.referralCount : 0), 24, 138, 12);
    ctx.fillStyle = PAL.cash;
    pixText((p ? p.referralEarned / 10 ** FUEL_DECIMALS : 0).toFixed(2) + ' FUEL', 150, 138, 12);
  } else {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('CONNECT YOUR WALLET IN THE WALLET TAB', 96, 8);
  }
  ctx.fillStyle = PAL.dim;
  pixText('GOT INVITED? PASTE YOUR FRIEND\'S CODE:', 24, 164, 8);
  const refSet = G.chainPlayer && G.chainPlayer.referrer;
  if (refSet) {
    ctx.fillStyle = PAL.green;
    const r = G.chainPlayer.referrer.toBase58();
    pixText('REFERRER SET: ' + r.slice(0, 4) + '..' + r.slice(-4), 24, 178, 9);
  } else {
    chainButton(310, 158, 156, 24, 'SET REFERRER', PAL.nos, 'setref');
    if (G.pendingReferrer) {
      ctx.fillStyle = PAL.amber;
      pixText('PENDING: ' + G.pendingReferrer.slice(0, 4) + '..' + G.pendingReferrer.slice(-4), 24, 178, 8);
    }
  }
}

// ------------------------------------------------------------
// HUD overlays
// ------------------------------------------------------------
function drawHUDFlash() {
  if (!G.flash) return;
  const a = Math.min(1, G.flash.t * 2);
  ctx.globalAlpha = a;
  ctx.fillStyle = G.flash.color;
  pixTextCenter(G.flash.text, 58, 13);
  ctx.globalAlpha = 1;
}

function drawStagingHints() {
  if (G.screen !== 'staging') return;
  ctx.fillStyle = PAL.text;
  pixTextCenter('VS ' + G.oppName + ' · ' + THEMES[G.theme].name, 34, 10);
  if (G.stage === 'burnout') {
    ctx.fillStyle = Math.floor(G.time * 3) % 2 === 0 ? PAL.amber : PAL.dim;
    pixTextCenter('BURNOUT! REV TO HEAT THE TIRES', 48, 11);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('GET THE BAR INTO THE GREEN BAND', 62, 7);
  } else {
    ctx.fillStyle = Math.floor(G.time * 3) % 2 === 0 ? PAL.amber : PAL.dim;
    pixTextCenter('REV IT... HOLD GAS!', 48, 11);
    ctx.fillStyle = PAL.dim;
    pixTextCenter('LAUNCH SWEET SPOT: ' + (S.launchLo / 1000).toFixed(1) + '-' + (S.launchHi / 1000).toFixed(1) + 'K RPM', 62, 7);
  }
}

// ------------------------------------------------------------
// Results screen
// ------------------------------------------------------------
function drawResults() {
  drawRaceView();
  drawDashboard();
  ctx.fillStyle = 'rgba(5,5,12,0.85)';
  ctx.fillRect(0, 0, W, H);
  hits.length = 0;

  const won = G.et < G.aiEt;
  ctx.fillStyle = won ? PAL.green : PAL.red;
  if (G.mode === 'career') {
    pixTextCenter(won ? 'STAGE CLEARED!' : 'STAGE FAILED', 14, 22);
  } else if (G.mode === 'duel') {
    ctx.fillStyle = PAL.nos;
    pixTextCenter('DUEL RUN DONE', 14, 22);
  } else {
    pixTextCenter(won ? 'YOU WIN!' : 'YOU LOSE', 14, 24);
  }

  ctx.fillStyle = PAL.text;
  pixTextCenter('YOUR ET    ' + G.et.toFixed(3) + 's', 52, 11);
  pixTextCenter('TRAP SPEED ' + G.trap.toFixed(0) + ' KM/H', 68, 11);
  if (G.mode !== 'duel') {
    ctx.fillStyle = RIVAL_PAL.h;
    pixTextCenter(G.oppName + '  ' + G.aiEt.toFixed(3) + 's', 84, 11);
    const margin = Math.abs(G.et - G.aiEt);
    ctx.fillStyle = PAL.dim;
    pixTextCenter((won ? 'WON' : 'LOST') + ' BY ' + margin.toFixed(3) + 's', 104, 9);
  } else {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('LOWEST ET TAKES THE POT AT SETTLE', 88, 8);
  }

  const best = G.best[G.carId];
  if (best) {
    ctx.fillStyle = G.newBest ? PAL.green : PAL.dim;
    pixTextCenter(G.newBest ? 'NEW BEST!' : 'BEST ' + best.toFixed(3) + 's', 120, 9);
  }

  // photo finish banner
  if (G.mode !== 'duel' && Math.abs(G.et - G.aiEt) < 0.08) {
    ctx.fillStyle = Math.floor(G.time * 4) % 2 === 0 ? PAL.cash : PAL.text;
    pixTextCenter('* PHOTO FINISH *', 36, 12);
  }

  const launchTxt = { perfect: 'PERFECT LAUNCH', ok: 'CLEAN LAUNCH', bog: 'BOGGED LAUNCH', spin: 'WHEELSPIN LAUNCH' }[G.launchKind] || '';
  const rtTxt = 'RT ' + (G.rt === null ? '-' : G.rt.toFixed(3) + 's');
  const tireTxt = G.tireBonus > 1 ? 'HOT TIRES' : G.tireBonus < 1 ? 'COLD RUBBER' : '';
  ctx.fillStyle = PAL.dim;
  pixTextCenter([launchTxt, rtTxt, tireTxt, G.perfectShifts ? G.perfectShifts + ' PERFECT SHIFTS' : '']
    .filter(Boolean).join(' · '), 136, 8);

  if (G.earned) {
    ctx.fillStyle = PAL.cash;
    pixTextCenter('EARNED +$' + G.earned.total + '  (CASH $' + G.cash + ')', 158, 12);
    ctx.fillStyle = PAL.dim;
    pixTextCenter(G.earned.lines.join(' · '), 176, 8);
  }

  // ranked: show the RP swing and new division
  if (G.mode === 'ranked' && G.lastRpDelta !== 0) {
    const div = divisionOf(G.rp);
    ctx.fillStyle = G.lastRpDelta > 0 ? PAL.green : PAL.red;
    pixTextCenter((G.lastRpDelta > 0 ? '+' : '') + G.lastRpDelta + ' RP  >  ' + G.rp + ' ' + div.name, 192, 11);
  }

  if (G.mode === 'career' && !won) {
    ctx.fillStyle = PAL.dim;
    pixTextCenter('TUNE UP IN THE GARAGE AND RETRY', 192, 8);
  }

  // on-chain buttons (Seeker / Android with a Solana wallet)
  if (mwaSupported && G.mode === 'chainrank' && G.chainMatch && !G.chainMatch.settled) {
    const me = sol.address;
    const myEt = G.chainMatch.a.toBase58() === me ? G.chainMatch.aEtMs : G.chainMatch.bEtMs;
    if (!myEt) {
      const bx = 150, by = 228, bw = 180, bh = 24;
      const can = !sol.busy;
      panel(bx, by, bw, bh, can ? PAL.green : PAL.dim);
      ctx.fillStyle = can ? PAL.green : PAL.dim;
      pixTextCenter(sol.busy ? 'SIGNING...' : 'SUBMIT RANKED TIME', by + 8, 9);
      if (can) hits.push({ x: bx, y: by, w: bw, h: bh, action: 'chainsubmit' });
    }
  } else if (mwaSupported && G.mode === 'duel' && G.duel && !G.duel.submitted) {
    const bx = 150, by = 228, bw = 180, bh = 24;
    const can = !sol.busy;
    panel(bx, by, bw, bh, can ? PAL.green : PAL.dim);
    ctx.fillStyle = can ? PAL.green : PAL.dim;
    pixTextCenter(sol.busy ? 'SIGNING...' : 'SUBMIT DUEL TIME', by + 8, 9);
    if (can) hits.push({ x: bx, y: by, w: bw, h: bh, action: 'duelsubmit' });
  } else if (mwaSupported && G.newBest && G.distanceM === QUARTER_MILE) {
    const bx = 150, by = 228, bw = 180, bh = 24;
    const can = !sol.busy;
    panel(bx, by, bw, bh, can ? PAL.nos : PAL.dim);
    ctx.fillStyle = can ? PAL.nos : PAL.dim;
    pixTextCenter(sol.busy ? 'SIGNING...' : 'SAVE RECORD ON-CHAIN', by + 8, 9);
    if (can) hits.push({ x: bx, y: by, w: bw, h: bh, action: 'postrecord' });
  }

  if (G.time > 0.6) {
    ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
    pixTextCenter('TAP TO CONTINUE', 214, 11);
  }

  drawHUDFlash();
}

// ------------------------------------------------------------
// Render dispatch
// ------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, W, H);
  switch (G.screen) {
    case 'menu': drawMenu(); break;
    case 'quick': drawQuick(); break;
    case 'ranked': drawRanked(); break;
    case 'career': drawCareer(); break;
    case 'garage': drawGarage(); break;
    case 'tune': drawTune(); break;
    case 'dealer': drawDealer(); break;
    case 'shop': drawShop(); break;
    case 'wallet': drawWallet(); break;
    case 'results': drawResults(); break;
    default:
      drawRaceView();
      drawDashboard();
      drawStagingHints();
      drawHUDFlash();
  }
}

// ------------------------------------------------------------
// Canvas scaling
// ------------------------------------------------------------
const wrap = document.getElementById('wrap');
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / W, vh / H);
  const cw = Math.floor(W * scale), ch = Math.floor(H * scale);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  wrap.style.width = cw + 'px';
  wrap.style.height = ch + 'px';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// ------------------------------------------------------------
// Fixed-timestep game loop
// ------------------------------------------------------------
let last = performance.now();
let acc = 0;
const STEP = 1 / 120;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// exposed for debugging / automated playtests
window.PDR = { G, S };
