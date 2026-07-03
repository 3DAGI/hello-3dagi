// ============================================================
// PIXEL DRAG RACER — simple mobile drag racing game (landscape)
// Canvas pixel-art renderer, manual gearbox, tachometer,
// christmas-tree start, quarter-mile vs AI, garage upgrades.
// ============================================================

const W = 480;
const H = 270;
const QUARTER_MILE = 402.336; // meters

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ------------------------------------------------------------
// Base car / engine configuration (stock, before upgrades)
// ------------------------------------------------------------
const CAR = {
  mass: 1180,               // kg
  wheelRadius: 0.31,        // m
  finalDrive: 3.9,
  gears: [3.35, 2.15, 1.56, 1.21, 1.0, 0.83],
  idle: 1000,
  redline: 7400,            // red zone starts
  limiter: 8300,
  maxRpm: 9000,             // gauge max
  peakTorque: 420,          // Nm
  dragCoef: 0.42,           // 0.5*rho*Cd*A
  rolling: 220,             // N
  traction: 8600,           // N max wheel force
  revUp: 6500,              // rpm/s free rev
  revDown: 4200,            // rpm/s decay
  shiftTime: 0.30,          // s (normal)
  perfectShiftTime: 0.12,   // s (perfect)
  perfectLo: 7200,          // perfect shift window
  perfectHi: 8100,
  launchLo: 4600,           // perfect launch window
  launchHi: 6400,
};

// ------------------------------------------------------------
// Upgrade parts — each 5 levels, bought with race cash
// ------------------------------------------------------------
const PARTS = [
  { id: 'engine',  name: 'ENGINE',  desc: '+TORQUE',       base: 500 },
  { id: 'turbo',   name: 'TURBO',   desc: '+TOP-END PWR',  base: 600 },
  { id: 'exhaust', name: 'EXHAUST', desc: '+LOW-END PWR',  base: 300 },
  { id: 'tires',   name: 'TIRES',   desc: '+GRIP',         base: 400 },
  { id: 'gearbox', name: 'GEARBOX', desc: 'FASTER SHIFTS', base: 450 },
  { id: 'weight',  name: 'WEIGHT',  desc: '-KG',           base: 400 },
];
const MAX_LEVEL = 5;
const COST_MULT = [1, 2, 3.5, 5.5, 8]; // cost of next level by current level

function partCost(part, curLevel) {
  return Math.round(part.base * COST_MULT[curLevel]);
}

// Effective stats derived from installed parts
const S = {};
function recalcStats() {
  const p = G.parts;
  S.mass = CAR.mass - 45 * p.weight;
  S.peakTorque = CAR.peakTorque + 32 * p.engine;
  S.traction = CAR.traction + 550 * p.tires;
  S.shiftTime = CAR.shiftTime - 0.032 * p.gearbox;
  S.perfectShiftTime = CAR.perfectShiftTime - 0.008 * p.gearbox;
  S.turbo = 1 + 0.06 * p.turbo;     // multiplier above 4000 rpm
  S.exhaust = 1 + 0.05 * p.exhaust; // multiplier below 4500 rpm
}

const DIFFICULTIES = [
  { name: 'STREET', et: 15.4, jitter: 0.5, color: '#7ec8ff', win: 300,  lose: 75 },
  { name: 'PRO',    et: 13.9, jitter: 0.4, color: '#ffd166', win: 700,  lose: 150 },
  { name: 'BOSS',   et: 12.9, jitter: 0.3, color: '#ff5c7a', win: 1500, lose: 300 },
];

// ------------------------------------------------------------
// Game state
// ------------------------------------------------------------
const G = {
  screen: 'menu',        // menu | garage | staging | race | results
  difficulty: 0,
  time: 0,               // in-state clock
  raceT: 0,              // seconds since green
  // player
  pos: 0, speed: 0, rpm: CAR.idle, gear: 1,
  throttle: false,
  shiftTimer: 0,
  clutchTimer: 0,        // launch clutch-slip blend
  launchRpm: 0,
  launchKind: '',        // perfect | bog | spin | ok
  bogTimer: 0, spinTimer: 0,
  perfectShifts: 0,
  finished: false, et: 0, trap: 0, newBest: false,
  // opponent
  aiEt: 14, aiPos: 0, aiSpeed: 0, aiFinished: false,
  // economy
  cash: 0,
  parts: { engine: 0, turbo: 0, exhaust: 0, tires: 0, gearbox: 0, weight: 0 },
  best: {},
  earned: null,          // {total, lines[]} for results screen
  // fx
  flash: null,           // {text,color,t}
  particles: [],
  shake: 0,
  wheelFrame: 0,
};

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('pdr_save') || '{}');
    if (typeof s.cash === 'number') G.cash = s.cash;
    if (s.best) G.best = s.best;
    if (s.parts) for (const k in G.parts) G.parts[k] = Math.min(MAX_LEVEL, s.parts[k] | 0);
  } catch {}
}
function save() {
  try {
    localStorage.setItem('pdr_save', JSON.stringify({ cash: G.cash, best: G.best, parts: G.parts }));
  } catch {}
}
loadSave();
recalcStats();

// ------------------------------------------------------------
// Audio — tiny synth engine tied to RPM
// ------------------------------------------------------------
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
  const f = 28 + (G.rpm / CAR.maxRpm) * 150;
  AU.osc.frequency.setTargetAtTime(f, AU.ctx.currentTime, 0.03);
  AU.osc2.frequency.setTargetAtTime(f * 0.5, AU.ctx.currentTime, 0.03);
  let vol = 0;
  if (running) {
    vol = 0.05 + (G.rpm / CAR.maxRpm) * 0.10 + (G.throttle ? 0.04 : 0);
    if (G.shiftTimer > 0) vol *= 0.3;
  }
  AU.gain.gain.setTargetAtTime(vol, AU.ctx.currentTime, 0.05);
}

// ------------------------------------------------------------
// Input
// ------------------------------------------------------------
const controls = document.getElementById('controls');
const btnGas = document.getElementById('gas');
const btnUp = document.getElementById('shiftUp');
const btnDown = document.getElementById('shiftDown');

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

// keyboard for desktop testing
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  initAudio();
  if (e.code === 'Space') { G.throttle = true; e.preventDefault(); }
  if (e.code === 'ArrowUp' || e.code === 'KeyW') shiftUp();
  if (e.code === 'ArrowDown' || e.code === 'KeyS') shiftDown();
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

const menuHits = [];   // {x,y,w,h,action,idx}
const garageHits = []; // {x,y,w,h,action,idx}

function hitIn(list, x, y) {
  for (const h of list) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}

function tapAnywhere(x, y, isKey) {
  if (G.screen === 'menu') {
    if (isKey) { startRace(G.difficulty); return; }
    const h = hitIn(menuHits, x, y);
    if (!h) return;
    if (h.action === 'race') startRace(h.idx);
    else if (h.action === 'garage') { G.screen = 'garage'; G.time = 0; }
  } else if (G.screen === 'garage') {
    const h = hitIn(garageHits, x, y);
    if (!h) return;
    if (h.action === 'back') { toMenu(); return; }
    buyPart(h.idx);
  } else if (G.screen === 'results') {
    if (G.time > 0.6) toMenu();
  }
}

// ------------------------------------------------------------
// Garage
// ------------------------------------------------------------
function buyPart(idx) {
  const part = PARTS[idx];
  const lvl = G.parts[part.id];
  if (lvl >= MAX_LEVEL) { setFlash('MAXED OUT', '#8a8aa8'); return; }
  const cost = partCost(part, lvl);
  if (G.cash < cost) { setFlash('NOT ENOUGH CASH', '#ff5c7a'); return; }
  G.cash -= cost;
  G.parts[part.id]++;
  recalcStats();
  save();
  setFlash(part.name + ' LV' + G.parts[part.id] + ' INSTALLED!', '#5cff8a');
}

// ------------------------------------------------------------
// Race flow
// ------------------------------------------------------------
function toMenu() {
  G.screen = 'menu';
  G.time = 0;
  controls.classList.add('hidden');
}

function startRace(idx) {
  const d = DIFFICULTIES[idx];
  G.difficulty = idx;
  G.screen = 'staging';
  G.time = 0;
  G.raceT = 0;
  G.pos = 0; G.speed = 0; G.rpm = CAR.idle; G.gear = 1;
  G.shiftTimer = 0; G.clutchTimer = 0;
  G.launchRpm = 0; G.launchKind = '';
  G.bogTimer = 0; G.spinTimer = 0;
  G.perfectShifts = 0;
  G.finished = false; G.et = 0; G.trap = 0; G.newBest = false;
  G.aiEt = d.et + (Math.random() * 2 - 1) * d.jitter;
  G.aiPos = 0; G.aiSpeed = 0; G.aiFinished = false;
  G.earned = null;
  G.flash = null;
  G.particles = [];
  controls.classList.remove('hidden');
}

const TREE = { amber1: 1.2, amber2: 1.8, amber3: 2.4, green: 3.0 };

function launch() {
  // called once at green light
  G.screen = 'race';
  G.raceT = 0;
  G.launchRpm = G.rpm;
  G.clutchTimer = 0.65;
  if (G.launchRpm >= CAR.launchLo && G.launchRpm <= CAR.launchHi) {
    G.launchKind = 'perfect';
    setFlash('PERFECT LAUNCH!', '#5cff8a');
  } else if (G.launchRpm < 2800) {
    G.launchKind = 'bog';
    G.bogTimer = 1.1;
    setFlash('BOGGED DOWN...', '#ff9a5c');
  } else if (G.launchRpm > 7100) {
    G.launchKind = 'spin';
    G.spinTimer = 1.3;
    setFlash('WHEELSPIN!', '#ffd15c');
  } else {
    G.launchKind = 'ok';
  }
}

function shiftUp() {
  if (G.screen !== 'race') return;
  if (G.gear >= CAR.gears.length || G.shiftTimer > 0) return;
  const perfect = G.rpm >= CAR.perfectLo && G.rpm <= CAR.perfectHi;
  const early = G.rpm < 5800;
  G.gear++;
  G.shiftTimer = perfect ? S.perfectShiftTime : S.shiftTime;
  if (perfect) {
    G.perfectShifts++;
    setFlash('PERFECT SHIFT!', '#5cff8a');
    spawnFlame();
  } else if (early) {
    setFlash('EARLY SHIFT', '#ff9a5c');
  }
}

function shiftDown() {
  if (G.screen !== 'race') return;
  if (G.gear <= 1 || G.shiftTimer > 0) return;
  const matched = matchedRpm(G.speed, G.gear - 1);
  if (matched > CAR.limiter + 400) {
    setFlash('TOO FAST!', '#ff5c7a');
    return;
  }
  G.gear--;
  G.shiftTimer = S.shiftTime * 0.7;
}

function setFlash(text, color) {
  G.flash = { text, color, t: 1.1 };
}

function applyRewards() {
  const d = DIFFICULTIES[G.difficulty];
  const won = G.et < G.aiEt;
  const lines = [];
  let total = won ? d.win : d.lose;
  lines.push((won ? 'RACE $' : 'CONSOLATION $') + total);
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

// ------------------------------------------------------------
// Physics
// ------------------------------------------------------------
function matchedRpm(speed, gear) {
  const ratio = CAR.gears[gear - 1] * CAR.finalDrive;
  return speed * 60 * ratio / (2 * Math.PI * CAR.wheelRadius);
}

function torqueAt(rpm) {
  // simple torque curve: weak low, peak ~6200, tapers to redline
  const r = rpm / 1000;
  let t;
  if (r < 2) t = 0.50 + r * 0.06;
  else if (r < 6.2) t = 0.62 + 0.38 * (r - 2) / 4.2;
  else if (r < CAR.limiter / 1000) t = 1.0 - 0.25 * (r - 6.2) / 2.1;
  else t = 0.15;
  let tq = S.peakTorque * t;
  if (rpm > 4000) tq *= S.turbo;      // turbo: top-end boost
  if (rpm < 4500) tq *= S.exhaust;    // exhaust: low-end boost
  return tq;
}

function updatePlayer(dt) {
  const inShift = G.shiftTimer > 0;
  if (inShift) G.shiftTimer -= dt;

  const matched = matchedRpm(G.speed, G.gear);
  const slipping = G.clutchTimer > 0;
  if (slipping) G.clutchTimer -= dt;

  // --- RPM model ---
  if (G.screen === 'staging') {
    // free revving at the line
    if (G.throttle) G.rpm += CAR.revUp * dt;
    else G.rpm -= CAR.revDown * dt;
    G.rpm = Math.max(CAR.idle, Math.min(CAR.limiter, G.rpm));
    return;
  }

  if (inShift) {
    // clutch in: rpm falls toward new matched rpm
    G.rpm += (Math.max(matched, CAR.idle) - G.rpm) * Math.min(1, dt * 9);
  } else if (slipping) {
    // launch: blend from launch rpm down/up to matched
    const k = 1 - Math.max(0, G.clutchTimer) / 0.65;
    G.rpm = G.launchRpm + (Math.max(matched, CAR.idle * 1.4) - G.launchRpm) * k;
  } else {
    G.rpm = Math.max(matched, CAR.idle);
  }
  G.rpm = Math.min(G.rpm, CAR.limiter);

  // --- Drive force ---
  let force = 0;
  if (G.throttle && !inShift) {
    const ratio = CAR.gears[G.gear - 1] * CAR.finalDrive;
    let tq = torqueAt(G.rpm);
    if (G.rpm >= CAR.limiter - 50) tq *= 0.15;        // rev limiter cut
    if (G.bogTimer > 0) tq *= 0.45;                    // bogged launch
    force = tq * ratio * 0.90 / CAR.wheelRadius;       // 90% drivetrain eff.
    let grip = S.traction;
    if (G.spinTimer > 0) grip *= 0.55;                 // spinning tires
    if (G.launchKind === 'perfect' && G.raceT < 2.5) grip *= 1.12;
    if (force > grip) {
      if (G.speed < 30 && G.spinTimer <= 0 && Math.random() < 0.3) spawnSmoke();
      force = grip;
    }
  }
  if (G.bogTimer > 0) G.bogTimer -= dt;
  if (G.spinTimer > 0) { G.spinTimer -= dt; if (Math.random() < 0.5) spawnSmoke(); }

  // --- Longitudinal dynamics ---
  const drag = CAR.dragCoef * G.speed * G.speed;
  const accel = (force - drag - CAR.rolling) / S.mass;
  G.speed = Math.max(0, G.speed + accel * dt);
  G.pos += G.speed * dt;

  if (!G.finished && G.pos >= QUARTER_MILE) {
    G.finished = true;
    G.et = G.raceT;
    G.trap = G.speed * 3.6;
    const key = 'd' + G.difficulty;
    if (!G.best[key] || G.et < G.best[key]) {
      G.best[key] = G.et;
      G.newBest = true;
      save();
    }
  }
}

function updateAI(dt) {
  // position follows a plausible drag curve for the target ET
  const t = G.raceT;
  const p = QUARTER_MILE * Math.pow(Math.min(t, G.aiEt) / G.aiEt, 1.55);
  if (t <= G.aiEt) {
    G.aiSpeed = (p - G.aiPos) / dt || G.aiSpeed;
    G.aiPos = p;
  } else {
    G.aiFinished = true;
    G.aiPos += G.aiSpeed * dt; // coast past the line
  }
  if (G.aiPos >= QUARTER_MILE) G.aiFinished = true;
}

// ------------------------------------------------------------
// Particles (tire smoke / exhaust flames)
// ------------------------------------------------------------
function spawnSmoke() {
  G.particles.push({
    kind: 'smoke',
    x: 92 + Math.random() * 8, y: 136 + Math.random() * 3,
    vx: -25 - Math.random() * 20, vy: -8 - Math.random() * 10,
    life: 0.7 + Math.random() * 0.4,
  });
}
function spawnFlame() {
  for (let i = 0; i < 5; i++) {
    G.particles.push({
      kind: 'flame',
      x: 88, y: 135,
      vx: -60 - Math.random() * 40, vy: (Math.random() - 0.5) * 20,
      life: 0.25 + Math.random() * 0.15,
    });
  }
  G.shake = 0.2;
}
function updateParticles(dt) {
  for (const p of G.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
  }
  G.particles = G.particles.filter(p => p.life > 0);
}

// ------------------------------------------------------------
// Main update
// ------------------------------------------------------------
function update(dt) {
  G.time += dt;
  if (G.flash) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
  if (G.shake > 0) G.shake -= dt;
  updateParticles(dt);

  if (G.screen === 'staging') {
    updatePlayer(dt);
    if (G.time >= TREE.green) launch();
  } else if (G.screen === 'race') {
    G.raceT += dt;
    updatePlayer(dt);
    updateAI(dt);
    G.wheelFrame += G.speed * dt * 3;
    if (G.finished && G.raceT >= G.et + 1.6) {
      G.screen = 'results';
      G.time = 0;
      controls.classList.add('hidden');
      G.throttle = false;
      applyRewards();
    }
  }
  updateAudio();
}

// ============================================================
// RENDERING — landscape layout:
//   y 0..152  race view (full width)
//   y 152..270 dashboard (tacho center, gear/speed beside,
//              side areas left/right are covered by touch buttons)
// ============================================================
const PAL = {
  sky1: '#0a0a1e', sky2: '#141433',
  city: '#1b1b3a', cityLit: '#e8c85a',
  road: '#2a2a34', roadLine: '#c8c840',
  fence: '#3a3a4a',
  playerBody: '#e03a3a', playerDark: '#8c1f1f', playerWin: '#aee6ff',
  aiBody: '#3a7ae0', aiDark: '#1f458c', aiWin: '#ffe6ae',
  tire: '#111', hub: '#999',
  text: '#e8e8f4', dim: '#8a8aa8',
  green: '#5cff8a', amber: '#ffd15c', red: '#ff5c7a',
  cash: '#ffd166',
};

const PX_PER_M = 6;
const TRACK_TOP = 88, TRACK_BOT = 152;
const PLAYER_X = 90, PLAYER_Y = 130, AI_Y = 96;
const PLAYER_SCREEN = PLAYER_X + 12; // world anchor on screen

// pixel-art car body (each char = 1px). b body, d dark, w window, s spoiler
const CAR_BODY = [
  '.........sdd............',
  '.......dbwwwwbd.........',
  '....ddbbbwwwwbbbdd......',
  '.dbbbbbbbbbbbbbbbbbbd...',
  'dbbbbbbbbbbbbbbbbbbbbbd.',
  'ddbbbbbbbbbbbbbbbbbbbbdd',
];

function drawCar(x, y, body, dark, win, wheelFrame) {
  for (let r = 0; r < CAR_BODY.length; r++) {
    const row = CAR_BODY[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'b' ? body : ch === 'w' ? win : dark;
      ctx.fillRect(x + c, y + r, 1, 1);
    }
  }
  // wheels
  drawWheel(x + 4, y + 5, wheelFrame);
  drawWheel(x + 17, y + 5, wheelFrame);
  // headlight + taillight
  ctx.fillStyle = '#fff7ae'; ctx.fillRect(x + 23, y + 3, 1, 1);
  ctx.fillStyle = '#ff4040'; ctx.fillRect(x, y + 3, 1, 1);
}

function drawWheel(x, y, frame) {
  ctx.fillStyle = PAL.tire;
  ctx.fillRect(x, y, 4, 4);
  ctx.fillStyle = PAL.hub;
  const f = Math.floor(frame) % 2;
  if (f === 0) ctx.fillRect(x + 1, y + 1, 2, 2);
  else { ctx.fillRect(x + 1, y + 2, 2, 1); ctx.fillRect(x + 2, y + 1, 1, 2); }
}

function drawRaceView() {
  const camX = G.pos * PX_PER_M - PLAYER_SCREEN;

  // sky
  const grad = ctx.createLinearGradient(0, 0, 0, 80);
  grad.addColorStop(0, PAL.sky1); grad.addColorStop(1, PAL.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 80);

  // stars (fixed pattern)
  ctx.fillStyle = '#ffffff44';
  for (let i = 0; i < 36; i++) {
    const sx = (i * 97 + 31) % W;
    const sy = (i * 53 + 11) % 42;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // city silhouette (slow parallax)
  const cityOff = Math.floor(camX * 0.15) % 60;
  for (let i = -1; i < 10; i++) {
    const bx = i * 60 - cityOff;
    const h = 16 + ((i * 37 + 100) % 22);
    ctx.fillStyle = PAL.city;
    ctx.fillRect(bx, 70 - h, 26, h);
    ctx.fillRect(bx + 30, 70 - (h * 0.7 | 0), 20, h * 0.7 | 0);
    // lit windows
    ctx.fillStyle = PAL.cityLit;
    for (let wy = 0; wy < h - 6; wy += 7) {
      if ((i * 13 + wy) % 3 === 0) ctx.fillRect(bx + 4, 70 - h + 3 + wy, 2, 2);
      if ((i * 7 + wy) % 4 === 0) ctx.fillRect(bx + 12, 70 - h + 3 + wy, 2, 2);
    }
  }
  ctx.fillStyle = '#101024';
  ctx.fillRect(0, 70, W, 8);

  // grandstand fence (mid parallax)
  const fenceOff = Math.floor(camX * 0.5) % 12;
  ctx.fillStyle = PAL.fence;
  ctx.fillRect(0, 78, W, 3);
  for (let x = -fenceOff; x < W; x += 12) ctx.fillRect(x, 81, 2, 7);

  // track: two lanes
  ctx.fillStyle = PAL.road;
  ctx.fillRect(0, TRACK_TOP, W, TRACK_BOT - TRACK_TOP);
  // lane divider dashes
  const dashOff = Math.floor(camX) % 24;
  ctx.fillStyle = PAL.roadLine;
  for (let x = -dashOff; x < W; x += 24) ctx.fillRect(x, 118, 12, 2);
  ctx.fillStyle = '#40404e';
  ctx.fillRect(0, TRACK_TOP, W, 2);
  ctx.fillRect(0, TRACK_BOT - 2, W, 2);

  // distance markers every 100m + finish line
  for (let m = 100; m <= 400; m += 100) {
    const sx = m * PX_PER_M - camX;
    if (sx > -20 && sx < W + 20) {
      ctx.fillStyle = '#55556a';
      ctx.fillRect(sx, TRACK_TOP, 2, TRACK_BOT - TRACK_TOP);
      ctx.fillStyle = PAL.dim;
      pixText(m + 'm', sx + 4, TRACK_TOP + 3, 6);
    }
  }
  const fx = QUARTER_MILE * PX_PER_M - camX;
  if (fx > -30 && fx < W + 30) {
    // checkered finish line
    for (let y = TRACK_TOP; y < TRACK_BOT; y += 4) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = ((y / 4 + i) % 2 === 0) ? '#fff' : '#111';
        ctx.fillRect(fx + i * 4, y, 4, 4);
      }
    }
  }

  // opponent car (upper lane)
  const aiX = PLAYER_SCREEN + (G.aiPos - G.pos) * PX_PER_M;
  if (aiX > -40 && aiX < W + 40) {
    drawCar(aiX - 12, AI_Y, PAL.aiBody, PAL.aiDark, PAL.aiWin, G.wheelFrame * 0.9);
  }
  // player car (lower lane) — camera-locked
  const shakeY = G.shake > 0 ? (Math.random() * 2 - 1) : 0;
  drawCar(PLAYER_X, PLAYER_Y + shakeY, PAL.playerBody, PAL.playerDark, PAL.playerWin, G.wheelFrame);

  // particles
  for (const p of G.particles) {
    if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(200,200,210,${Math.min(0.6, p.life)})`;
      const s = 2 + (0.9 - p.life) * 4;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    } else {
      ctx.fillStyle = p.life > 0.15 ? '#ffd15c' : '#ff7a3c';
      ctx.fillRect(p.x, p.y, 3, 2);
    }
  }

  // christmas tree during staging & early race
  if (G.screen === 'staging' || (G.screen === 'race' && G.raceT < 1.2)) {
    drawTree();
  }
}

function drawTree() {
  const tx = 240, ty = 6;
  ctx.fillStyle = '#18181f';
  ctx.fillRect(tx - 8, ty - 3, 16, 56);
  ctx.strokeStyle = '#44445a';
  ctx.strokeRect(tx - 8.5, ty - 3.5, 17, 57);
  const t = G.screen === 'race' ? TREE.green : G.time;
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
// Dashboard: tachometer center, gear/speed boxes, timer strip
// ------------------------------------------------------------
function drawDashboard() {
  ctx.fillStyle = '#0d0d18';
  ctx.fillRect(0, 152, W, H - 152);
  ctx.fillStyle = '#22223a';
  ctx.fillRect(0, 152, W, 2);

  // top strip: time · progress bar · distance
  ctx.fillStyle = PAL.dim;
  pixText('TIME', 14, 158, 7);
  ctx.fillStyle = PAL.text;
  pixText(G.raceT.toFixed(2) + 's', 46, 156, 9);
  ctx.fillStyle = PAL.dim;
  pixText('DIST', 344, 158, 7);
  ctx.fillStyle = PAL.text;
  pixText(Math.min(402, Math.round(G.pos)) + 'm', 376, 156, 9);

  const bx = 136, bw = 200;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(bx, 157, bw, 8);
  ctx.fillStyle = DIFFICULTIES[G.difficulty].color;
  ctx.fillRect(bx + Math.min(1, G.aiPos / QUARTER_MILE) * (bw - 4), 157, 4, 3);
  ctx.fillStyle = PAL.playerBody;
  ctx.fillRect(bx + Math.min(1, G.pos / QUARTER_MILE) * (bw - 4), 162, 4, 3);
  ctx.fillStyle = '#55556a';
  ctx.fillRect(bx + bw - 1, 155, 1, 12);

  drawTacho(240, 218, 48);

  // gear box (left of tacho)
  ctx.fillStyle = '#14142a';
  ctx.fillRect(118, 172, 72, 50);
  ctx.strokeStyle = '#3a3a5c';
  ctx.strokeRect(118.5, 172.5, 71, 49);
  ctx.fillStyle = PAL.dim;
  pixText('GEAR', 126, 177, 7);
  ctx.fillStyle = G.shiftTimer > 0 ? PAL.dim : PAL.text;
  pixText(G.shiftTimer > 0 ? '-' : String(G.gear), 146, 188, 28);

  // speed box (right of tacho)
  ctx.fillStyle = '#14142a';
  ctx.fillRect(290, 172, 72, 50);
  ctx.strokeStyle = '#3a3a5c';
  ctx.strokeRect(290.5, 172.5, 71, 49);
  ctx.fillStyle = PAL.dim;
  pixText('KM/H', 298, 177, 7);
  ctx.fillStyle = PAL.text;
  pixText(String(Math.round(G.speed * 3.6)), 306, 194, 18);
}

function drawTacho(cx, cy, r) {
  // dial background
  ctx.fillStyle = '#14142a';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a3a5c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;

  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270° sweep
  const rpmToAngle = (rpm) => a0 + (rpm / CAR.maxRpm) * (a1 - a0);

  // red zone arc
  ctx.strokeStyle = PAL.red; ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, rpmToAngle(CAR.redline), rpmToAngle(CAR.maxRpm));
  ctx.stroke();
  ctx.lineWidth = 1;

  // ticks + numbers
  for (let k = 0; k <= 9; k++) {
    const a = rpmToAngle(k * 1000);
    const c1 = Math.cos(a), s1 = Math.sin(a);
    ctx.strokeStyle = k * 1000 >= CAR.redline ? PAL.red : PAL.text;
    ctx.beginPath();
    ctx.moveTo(cx + c1 * (r - 4), cy + s1 * (r - 4));
    ctx.lineTo(cx + c1 * (r - 12), cy + s1 * (r - 12));
    ctx.stroke();
    ctx.fillStyle = k * 1000 >= CAR.redline ? PAL.red : PAL.dim;
    pixText(String(k), cx + c1 * (r - 19) - 2, cy + s1 * (r - 19) - 4, 8);
  }

  // shift light — blinks in the perfect-shift window
  const inWindow = G.rpm >= CAR.perfectLo;
  const blink = Math.floor(G.time * 10) % 2 === 0;
  ctx.fillStyle = inWindow && blink ? PAL.green : '#1e2e1e';
  ctx.fillRect(cx - 5, cy - r + 13, 10, 6);

  // needle
  const a = rpmToAngle(Math.max(0, G.rpm));
  ctx.strokeStyle = '#ff5c3c'; ctx.lineWidth = 2;
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
// Text helpers (chunky monospace on the low-res canvas)
// ------------------------------------------------------------
function pixText(str, x, y, size) {
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(str, Math.round(x), Math.round(y));
}
function pixTextCenter(str, y, size) {
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.textBaseline = 'top';
  const w = ctx.measureText(str).width;
  ctx.fillText(str, Math.round((W - w) / 2), Math.round(y));
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

// ------------------------------------------------------------
// Menu screen
// ------------------------------------------------------------
function drawMenu() {
  ctx.fillStyle = PAL.sky1;
  ctx.fillRect(0, 0, W, H);

  // starfield
  ctx.fillStyle = '#ffffff33';
  for (let i = 0; i < 50; i++) {
    ctx.fillRect((i * 97 + 31) % W, (i * 53 + 11) % H, 1, 1);
  }

  pixTextParts([
    { t: 'PIXEL ', c: PAL.red },
    { t: 'DRAG RACER', c: PAL.text },
  ], 12, 26);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('1/4 MILE · MANUAL GEARBOX', 44, 9);

  // cash top-left
  ctx.fillStyle = PAL.cash;
  pixText('CASH $' + G.cash, 14, 10, 10);

  // demo car
  drawCar(228, 60, PAL.playerBody, PAL.playerDark, PAL.playerWin, G.time * 8);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(0, 80, W, 3);

  // difficulty buttons in a row
  menuHits.length = 0;
  DIFFICULTIES.forEach((d, i) => {
    const bw = 128, bh = 46, bx = 36 + i * 140, by = 96;
    ctx.fillStyle = '#14142a';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = d.color;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = d.color;
    ctx.font = 'bold 14px "Courier New", monospace';
    const nw = ctx.measureText(d.name).width;
    pixText(d.name, bx + (bw - nw) / 2, by + 8, 14);
    const best = G.best['d' + i];
    ctx.fillStyle = PAL.dim;
    const sub = best ? 'BEST ' + best.toFixed(2) + 's' : 'VS ' + d.et.toFixed(1) + 's CAR';
    ctx.font = 'bold 8px "Courier New", monospace';
    const sw = ctx.measureText(sub).width;
    pixText(sub, bx + (bw - sw) / 2, by + 28, 8);
    menuHits.push({ x: bx, y: by, w: bw, h: bh, action: 'race', idx: i });
  });

  // garage button
  const gx = 160, gy = 152, gw = 160, gh = 32;
  ctx.fillStyle = '#14142a';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.strokeStyle = PAL.cash;
  ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);
  ctx.fillStyle = PAL.cash;
  pixTextCenter('GARAGE · TUNE CAR', gy + 10, 11);
  menuHits.push({ x: gx, y: gy, w: gw, h: gh, action: 'garage' });

  ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
  pixTextCenter('TAP A CLASS TO RACE', 200, 10);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('REV AT THE TREE · SHIFT AT REDLINE', 222, 7);
  pixTextCenter('3DAGI · v0.2', 244, 7);

  drawHUDFlash();
}

// ------------------------------------------------------------
// Garage screen
// ------------------------------------------------------------
function drawGarage() {
  ctx.fillStyle = PAL.sky1;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff22';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 97 + 31) % W, (i * 53 + 11) % H, 1, 1);
  }

  ctx.fillStyle = PAL.text;
  pixText('GARAGE', 14, 10, 16);
  ctx.fillStyle = PAL.cash;
  const cashStr = 'CASH $' + G.cash;
  ctx.font = 'bold 12px "Courier New", monospace';
  pixText(cashStr, W - 14 - ctx.measureText(cashStr).width, 12, 12);

  garageHits.length = 0;
  PARTS.forEach((part, i) => {
    const col = i % 3, row = (i / 3) | 0;
    const tx = 14 + col * 156, ty = 38 + row * 84, tw = 140, th = 76;
    const lvl = G.parts[part.id];
    const maxed = lvl >= MAX_LEVEL;
    const cost = maxed ? 0 : partCost(part, lvl);
    const afford = !maxed && G.cash >= cost;

    ctx.fillStyle = '#14142a';
    ctx.fillRect(tx, ty, tw, th);
    ctx.strokeStyle = maxed ? PAL.green : afford ? PAL.cash : '#3a3a5c';
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);

    ctx.fillStyle = PAL.text;
    pixText(part.name, tx + 8, ty + 6, 11);
    ctx.fillStyle = PAL.dim;
    pixText(part.desc, tx + 8, ty + 20, 7);

    // level pips
    for (let k = 0; k < MAX_LEVEL; k++) {
      ctx.fillStyle = k < lvl ? PAL.green : '#26263a';
      ctx.fillRect(tx + 8 + k * 14, ty + 32, 10, 6);
    }

    ctx.fillStyle = maxed ? PAL.green : afford ? PAL.cash : PAL.red;
    pixText(maxed ? 'MAX LEVEL' : 'BUY $' + cost, tx + 8, ty + 46, 10);
    if (!maxed) {
      ctx.fillStyle = PAL.dim;
      pixText('LV' + lvl + ' > LV' + (lvl + 1), tx + 8, ty + 60, 7);
    }
    garageHits.push({ x: tx, y: ty, w: tw, h: th, action: 'buy', idx: i });
  });

  // back button
  const bx = 180, by = 236, bw = 120, bh = 26;
  ctx.fillStyle = '#14142a';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#3a3a5c';
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = PAL.text;
  pixTextCenter('< BACK', by + 8, 10);
  garageHits.push({ x: bx, y: by, w: bw, h: bh, action: 'back' });

  drawHUDFlash();
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
  ctx.fillStyle = Math.floor(G.time * 3) % 2 === 0 ? PAL.amber : PAL.dim;
  pixTextCenter('REV IT... HOLD GAS!', 46, 11);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('LAUNCH SWEET SPOT: 4.6-6.4K RPM', 60, 7);
}

// ------------------------------------------------------------
// Results screen
// ------------------------------------------------------------
function drawResults() {
  drawRaceView();
  drawDashboard();
  ctx.fillStyle = 'rgba(5,5,12,0.85)';
  ctx.fillRect(0, 0, W, H);

  const won = G.et < G.aiEt;
  ctx.fillStyle = won ? PAL.green : PAL.red;
  pixTextCenter(won ? 'YOU WIN!' : 'YOU LOSE', 14, 24);

  ctx.fillStyle = PAL.text;
  pixTextCenter('YOUR ET    ' + G.et.toFixed(3) + 's', 52, 11);
  pixTextCenter('TRAP SPEED ' + G.trap.toFixed(0) + ' KM/H', 68, 11);
  ctx.fillStyle = DIFFICULTIES[G.difficulty].color;
  pixTextCenter(DIFFICULTIES[G.difficulty].name + ' ET   ' + G.aiEt.toFixed(3) + 's', 84, 11);

  const margin = Math.abs(G.et - G.aiEt);
  ctx.fillStyle = PAL.dim;
  pixTextCenter((won ? 'WON' : 'LOST') + ' BY ' + margin.toFixed(3) + 's', 104, 9);

  const best = G.best['d' + G.difficulty];
  if (best) {
    ctx.fillStyle = G.newBest ? PAL.green : PAL.dim;
    pixTextCenter(G.newBest ? 'NEW BEST!' : 'BEST ' + best.toFixed(3) + 's', 120, 9);
  }

  const launchTxt = { perfect: 'PERFECT LAUNCH', ok: 'CLEAN LAUNCH', bog: 'BOGGED LAUNCH', spin: 'WHEELSPIN LAUNCH' }[G.launchKind] || '';
  ctx.fillStyle = PAL.dim;
  pixTextCenter(launchTxt + (G.perfectShifts ? ' · ' + G.perfectShifts + ' PERFECT SHIFTS' : ''), 136, 8);

  if (G.earned) {
    ctx.fillStyle = PAL.cash;
    pixTextCenter('EARNED +$' + G.earned.total + '  (CASH $' + G.cash + ')', 158, 12);
    ctx.fillStyle = PAL.dim;
    pixTextCenter(G.earned.lines.join(' · '), 176, 8);
  }

  if (G.time > 0.6) {
    ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
    pixTextCenter('TAP TO CONTINUE', 214, 11);
  }
}

// ------------------------------------------------------------
// Render dispatch
// ------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, W, H);
  if (G.screen === 'menu') {
    drawMenu();
  } else if (G.screen === 'garage') {
    drawGarage();
  } else if (G.screen === 'results') {
    drawResults();
  } else {
    drawRaceView();
    drawDashboard();
    drawStagingHints();
    drawHUDFlash();
  }
}

// ------------------------------------------------------------
// Canvas scaling — fit viewport, keep aspect, stay pixelated
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
  if (dt > 0.25) dt = 0.25; // tab was hidden
  acc += dt;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
