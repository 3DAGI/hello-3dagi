// ============================================================
// PIXEL DRAG RACER — simple mobile drag racing game
// Canvas pixel-art renderer, manual gearbox, tachometer,
// christmas-tree start, quarter-mile vs AI opponent.
// ============================================================

const W = 270;
const H = 480;
const QUARTER_MILE = 402.336; // meters

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ------------------------------------------------------------
// Car / engine configuration
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

const DIFFICULTIES = [
  { name: 'STREET', et: 15.4, jitter: 0.5, color: '#7ec8ff' },
  { name: 'PRO',    et: 13.9, jitter: 0.4, color: '#ffd166' },
  { name: 'BOSS',   et: 12.9, jitter: 0.3, color: '#ff5c7a' },
];

// ------------------------------------------------------------
// Game state
// ------------------------------------------------------------
const G = {
  screen: 'menu',        // menu | staging | race | results
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
  finished: false, et: 0, trap: 0,
  // opponent
  aiEt: 14, aiPos: 0, aiSpeed: 0, aiFinished: false,
  // fx
  flash: null,           // {text,color,t}
  particles: [],
  shake: 0,
  best: loadBest(),
  wheelFrame: 0,
};

function loadBest() {
  try { return JSON.parse(localStorage.getItem('pdr_best') || '{}'); }
  catch { return {}; }
}
function saveBest() {
  try { localStorage.setItem('pdr_best', JSON.stringify(G.best)); } catch {}
}

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

const menuHits = []; // {x,y,w,h,idx}

function tapAnywhere(x, y, isKey) {
  if (G.screen === 'menu') {
    if (isKey) { startRace(G.difficulty); return; }
    for (const h of menuHits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        startRace(h.idx);
        return;
      }
    }
  } else if (G.screen === 'results') {
    if (G.time > 0.6) toMenu();
  }
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
  G.finished = false; G.et = 0; G.trap = 0;
  G.aiEt = d.et + (Math.random() * 2 - 1) * d.jitter;
  G.aiPos = 0; G.aiSpeed = 0; G.aiFinished = false;
  G.flash = null;
  G.particles = [];
  controls.classList.remove('hidden');
}

const TREE = { amber1: 1.2, amber2: 1.8, amber3: 2.4, green: 3.0 };

function greenTime() { return G.screen === 'race' || (G.screen === 'staging' && G.time >= TREE.green); }

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
  if (G.screen !== 'race' && G.screen !== 'staging') return;
  if (G.screen === 'staging') return; // can't preselect
  if (G.gear >= CAR.gears.length || G.shiftTimer > 0) return;
  const perfect = G.rpm >= CAR.perfectLo && G.rpm <= CAR.perfectHi;
  const early = G.rpm < 5800;
  G.gear++;
  G.shiftTimer = perfect ? CAR.perfectShiftTime : CAR.shiftTime;
  if (perfect) {
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
  G.shiftTimer = CAR.shiftTime * 0.7;
}

function setFlash(text, color) {
  G.flash = { text, color, t: 1.1 };
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
  return CAR.peakTorque * t;
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
    let grip = CAR.traction;
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
  const accel = (force - drag - CAR.rolling) / CAR.mass;
  G.speed = Math.max(0, G.speed + accel * dt);
  G.pos += G.speed * dt;

  if (!G.finished && G.pos >= QUARTER_MILE) {
    G.finished = true;
    G.et = G.raceT;
    G.trap = G.speed * 3.6;
    const key = 'd' + G.difficulty;
    if (!G.best[key] || G.et < G.best[key]) { G.best[key] = G.et; saveBest(); }
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
    x: 60 + Math.random() * 8, y: 166 + Math.random() * 4,
    vx: -25 - Math.random() * 20, vy: -8 - Math.random() * 10,
    life: 0.7 + Math.random() * 0.4,
  });
}
function spawnFlame() {
  for (let i = 0; i < 5; i++) {
    G.particles.push({
      kind: 'flame',
      x: 40, y: 163,
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
  playerBody: '#e03a3a', playerDark: '#8c1f1f', playerWin: '#aee6ff',
  aiBody: '#3a7ae0', aiDark: '#1f458c', aiWin: '#ffe6ae',
  tire: '#111', hub: '#999',
  text: '#e8e8f4', dim: '#8a8aa8',
  green: '#5cff8a', amber: '#ffd15c', red: '#ff5c7a',
};

const PX_PER_M = 6;

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
  const camX = G.pos * PX_PER_M - 55;

  // sky
  const grad = ctx.createLinearGradient(0, 0, 0, 120);
  grad.addColorStop(0, PAL.sky1); grad.addColorStop(1, PAL.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 120);

  // stars (fixed pattern)
  ctx.fillStyle = '#ffffff44';
  for (let i = 0; i < 24; i++) {
    const sx = (i * 97 + 31) % W;
    const sy = (i * 53 + 11) % 70;
    ctx.fillRect(sx, sy, 1, 1);
  }

  // city silhouette (slow parallax)
  const cityOff = Math.floor(camX * 0.15) % 60;
  ctx.fillStyle = PAL.city;
  for (let i = -1; i < 7; i++) {
    const bx = i * 60 - cityOff;
    const h = 20 + ((i * 37 + 100) % 28);
    ctx.fillRect(bx, 100 - h, 26, h);
    ctx.fillRect(bx + 30, 100 - (h * 0.7 | 0), 20, h * 0.7 | 0);
    // lit windows
    ctx.fillStyle = PAL.cityLit;
    for (let wy = 0; wy < h - 6; wy += 7) {
      if ((i * 13 + wy) % 3 === 0) ctx.fillRect(bx + 4, 100 - h + 3 + wy, 2, 2);
      if ((i * 7 + wy) % 4 === 0) ctx.fillRect(bx + 12, 100 - h + 3 + wy, 2, 2);
    }
    ctx.fillStyle = PAL.city;
  }
  ctx.fillStyle = '#101024';
  ctx.fillRect(0, 100, W, 20);

  // grandstand fence (mid parallax)
  const fenceOff = Math.floor(camX * 0.5) % 12;
  ctx.fillStyle = PAL.fence;
  ctx.fillRect(0, 108, W, 3);
  for (let x = -fenceOff; x < W; x += 12) ctx.fillRect(x, 111, 2, 8);

  // track: two lanes
  ctx.fillStyle = PAL.road;
  ctx.fillRect(0, 120, W, 70);
  // lane divider dashes
  const dashOff = Math.floor(camX) % 24;
  ctx.fillStyle = PAL.roadLine;
  for (let x = -dashOff; x < W; x += 24) ctx.fillRect(x, 154, 12, 2);
  ctx.fillStyle = '#40404e';
  ctx.fillRect(0, 120, W, 2);
  ctx.fillRect(0, 188, W, 2);

  // distance markers every 100m + finish line
  for (let m = 100; m <= 400; m += 100) {
    const sx = m * PX_PER_M - camX;
    if (sx > -20 && sx < W + 20) {
      ctx.fillStyle = '#55556a';
      ctx.fillRect(sx, 120, 2, 70);
      ctx.fillStyle = PAL.dim;
      pixText(m + 'm', sx + 4, 124, 6);
    }
  }
  const fx = QUARTER_MILE * PX_PER_M - camX;
  if (fx > -30 && fx < W + 30) {
    // checkered finish line
    for (let y = 120; y < 190; y += 4) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = ((y / 4 + i) % 2 === 0) ? '#fff' : '#111';
        ctx.fillRect(fx + i * 4, y, 4, 4);
      }
    }
  }

  // opponent car (upper lane)
  const aiX = 55 + (G.aiPos - G.pos) * PX_PER_M;
  if (aiX > -40 && aiX < W + 40) {
    drawCar(aiX - 12, 128, PAL.aiBody, PAL.aiDark, PAL.aiWin, G.wheelFrame * 0.9);
  }
  // player car (lower lane) — camera-locked
  const shakeY = G.shake > 0 ? (Math.random() * 2 - 1) : 0;
  drawCar(43, 162 + shakeY, PAL.playerBody, PAL.playerDark, PAL.playerWin, G.wheelFrame);

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
  const tx = 128, ty = 18;
  ctx.fillStyle = '#18181f';
  ctx.fillRect(tx - 8, ty - 4, 16, 62);
  ctx.strokeStyle = '#44445a';
  ctx.strokeRect(tx - 8.5, ty - 4.5, 17, 63);
  const t = G.screen === 'race' ? TREE.green : G.time;
  const lamps = [
    { on: t >= TREE.amber1, c: PAL.amber },
    { on: t >= TREE.amber2, c: PAL.amber },
    { on: t >= TREE.amber3, c: PAL.amber },
    { on: t >= TREE.green, c: PAL.green },
  ];
  lamps.forEach((l, i) => {
    ctx.fillStyle = l.on ? l.c : '#26262e';
    ctx.fillRect(tx - 4, ty + i * 14, 8, 8);
    if (l.on) {
      ctx.fillStyle = l.c + '44';
      ctx.fillRect(tx - 6, ty + i * 14 - 2, 12, 12);
    }
  });
}

// ------------------------------------------------------------
// Dashboard: tachometer, gear, speed, timer
// ------------------------------------------------------------
function drawDashboard() {
  ctx.fillStyle = '#0d0d18';
  ctx.fillRect(0, 190, W, H - 190);
  ctx.fillStyle = '#22223a';
  ctx.fillRect(0, 190, W, 2);

  drawTacho(78, 268, 56);

  // right cluster
  const rx = 168;
  // gear
  ctx.fillStyle = '#14142a';
  ctx.fillRect(rx, 214, 82, 46);
  ctx.strokeStyle = '#3a3a5c';
  ctx.strokeRect(rx + 0.5, 214.5, 81, 45);
  ctx.fillStyle = PAL.dim;
  pixText('GEAR', rx + 8, 219, 7);
  ctx.fillStyle = G.shiftTimer > 0 ? PAL.dim : PAL.text;
  pixText(G.shiftTimer > 0 ? '-' : String(G.gear), rx + 44, 226, 28);

  // speed
  ctx.fillStyle = '#14142a';
  ctx.fillRect(rx, 266, 82, 34);
  ctx.strokeStyle = '#3a3a5c';
  ctx.strokeRect(rx + 0.5, 266.5, 81, 33);
  ctx.fillStyle = PAL.dim;
  pixText('KM/H', rx + 8, 270, 7);
  ctx.fillStyle = PAL.text;
  pixText(String(Math.round(G.speed * 3.6)), rx + 26, 280, 16);

  // timer + distance
  ctx.fillStyle = PAL.dim;
  pixText('TIME', 20, 322, 7);
  ctx.fillStyle = PAL.text;
  pixText(G.raceT.toFixed(2) + 's', 55, 320, 10);
  ctx.fillStyle = PAL.dim;
  pixText('DIST', 140, 322, 7);
  ctx.fillStyle = PAL.text;
  pixText(Math.min(402, Math.round(G.pos)) + 'm', 175, 320, 10);

  // progress bar player vs AI
  const bx = 20, bw = W - 40;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(bx, 336, bw, 8);
  ctx.fillStyle = DIFFICULTIES[G.difficulty].color;
  ctx.fillRect(bx + Math.min(1, G.aiPos / QUARTER_MILE) * (bw - 4), 336, 4, 3);
  ctx.fillStyle = PAL.playerBody;
  ctx.fillRect(bx + Math.min(1, G.pos / QUARTER_MILE) * (bw - 4), 341, 4, 3);
  ctx.fillStyle = '#55556a';
  ctx.fillRect(bx + bw - 1, 334, 1, 12);
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
    pixText(String(k), cx + c1 * (r - 20) - 2, cy + s1 * (r - 20) - 4, 8);
  }

  // shift light — blinks in the perfect-shift window
  const inWindow = G.rpm >= CAR.perfectLo;
  const blink = Math.floor(G.time * 10) % 2 === 0;
  ctx.fillStyle = inWindow && blink ? PAL.green : '#1e2e1e';
  ctx.fillRect(cx - 5, cy - r + 14, 10, 6);

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
// Text helper (chunky monospace on the low-res canvas)
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

// ------------------------------------------------------------
// Screens
// ------------------------------------------------------------
function drawMenu() {
  ctx.fillStyle = PAL.sky1;
  ctx.fillRect(0, 0, W, H);

  // starfield
  ctx.fillStyle = '#ffffff33';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 97 + 31) % W, (i * 53 + 11) % H, 1, 1);
  }

  ctx.fillStyle = PAL.red;
  pixTextCenter('PIXEL', 52, 34);
  ctx.fillStyle = PAL.text;
  pixTextCenter('DRAG RACER', 90, 26);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('1/4 MILE · MANUAL GEARBOX', 126, 9);

  // demo car
  drawCar(123, 158, PAL.playerBody, PAL.playerDark, PAL.playerWin, G.time * 8);
  ctx.fillStyle = '#2a2a34';
  ctx.fillRect(0, 178, W, 3);

  // difficulty buttons
  menuHits.length = 0;
  DIFFICULTIES.forEach((d, i) => {
    const bx = 45, bw = W - 90, bh = 40, by = 210 + i * 56;
    const blink = Math.floor(G.time * 2) % 2 === 0;
    ctx.fillStyle = '#14142a';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = d.color;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.fillStyle = d.color;
    pixTextCenter(d.name, by + 7, 15);
    const best = G.best['d' + i];
    ctx.fillStyle = PAL.dim;
    pixTextCenter(best ? 'BEST ' + best.toFixed(2) + 's' : 'VS ' + d.et.toFixed(1) + 's CAR', by + 26, 8);
    if (i === 0 && blink) {
      ctx.fillStyle = PAL.text;
    }
    menuHits.push({ x: bx, y: by, w: bw, h: bh, idx: i });
  });

  ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
  pixTextCenter('TAP A CLASS TO RACE', 396, 10);
  ctx.fillStyle = PAL.dim;
  pixTextCenter('REV AT THE TREE · SHIFT AT REDLINE', 430, 7);
  pixTextCenter('3DAGI · v0.1', 448, 7);
}

function drawHUDFlash() {
  if (!G.flash) return;
  const a = Math.min(1, G.flash.t * 2);
  ctx.globalAlpha = a;
  ctx.fillStyle = G.flash.color;
  pixTextCenter(G.flash.text, 96, 14);
  ctx.globalAlpha = 1;
}

function drawStagingHints() {
  if (G.screen !== 'staging') return;
  ctx.fillStyle = Math.floor(G.time * 3) % 2 === 0 ? PAL.amber : PAL.dim;
  pixTextCenter('REV IT... HOLD GAS!', 96, 12);
  // launch window hint on tacho side
  ctx.fillStyle = PAL.dim;
  pixTextCenter('LAUNCH SWEET SPOT: 4.6-6.4K RPM', 108, 7);
}

function drawResults() {
  drawRaceView();
  drawDashboard();
  ctx.fillStyle = 'rgba(5,5,12,0.82)';
  ctx.fillRect(0, 0, W, H);

  const won = G.et < G.aiEt;
  ctx.fillStyle = won ? PAL.green : PAL.red;
  pixTextCenter(won ? 'YOU WIN!' : 'YOU LOSE', 70, 28);

  ctx.fillStyle = PAL.text;
  pixTextCenter('YOUR ET    ' + G.et.toFixed(3) + 's', 140, 12);
  pixTextCenter('TRAP SPEED ' + G.trap.toFixed(0) + ' KM/H', 162, 12);
  ctx.fillStyle = DIFFICULTIES[G.difficulty].color;
  pixTextCenter(DIFFICULTIES[G.difficulty].name + ' ET   ' + G.aiEt.toFixed(3) + 's', 184, 12);

  const margin = Math.abs(G.et - G.aiEt);
  ctx.fillStyle = PAL.dim;
  pixTextCenter((won ? 'WON' : 'LOST') + ' BY ' + margin.toFixed(3) + 's', 212, 10);

  const best = G.best['d' + G.difficulty];
  if (best) {
    ctx.fillStyle = best === G.et ? PAL.green : PAL.dim;
    pixTextCenter((best === G.et ? 'NEW BEST!' : 'BEST ' + best.toFixed(3) + 's'), 240, 10);
  }

  const launchTxt = { perfect: 'PERFECT LAUNCH', ok: 'CLEAN LAUNCH', bog: 'BOGGED LAUNCH', spin: 'WHEELSPIN LAUNCH' }[G.launchKind] || '';
  ctx.fillStyle = PAL.dim;
  pixTextCenter(launchTxt, 262, 8);

  if (G.time > 0.6) {
    ctx.fillStyle = Math.floor(G.time * 2) % 2 === 0 ? PAL.text : PAL.dim;
    pixTextCenter('TAP TO CONTINUE', 330, 12);
  }
}

// ------------------------------------------------------------
// Render dispatch
// ------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, W, H);
  if (G.screen === 'menu') {
    drawMenu();
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
