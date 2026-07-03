/**
 * SWARM Spin — an "aa"-style one-tap arcade game.
 *
 * A hive core rotates in the middle of the screen. The player taps to shoot
 * drone-bees (pins) into the hive. If a new pin lands too close to an existing
 * one, the run is over. Levels ramp up speed and add rotation patterns
 * (reverse, pulse, drunk). Fast consecutive hits build a combo multiplier.
 *
 * The engine is framework-agnostic: it renders into a canvas and reports
 * state changes through callbacks consumed by the React shell.
 */

export type GamePhase = 'menu' | 'playing' | 'dead' | 'levelup';

export interface EngineEvents {
  onScore(score: number, combo: number): void;
  onLevel(level: number): void;
  onDeath(finalScore: number, level: number): void;
  onLevelCleared(level: number, bonus: number): void;
}

interface Pin {
  /** angle relative to hive rotation, radians */
  angle: number;
  /** 0 = pre-placed obstacle, 1+ = player pin (stores combo at placement for color) */
  combo: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
  color: string; size: number;
}

interface Popup { x: number; y: number; text: string; life: number; color: string }

type Pattern = 'steady' | 'reverse' | 'pulse' | 'drunk';

const TAU = Math.PI * 2;
const MIN_GAP = 0.155;          // radians between pins before collision
const PIN_LEN = 46;             // stinger length from hive rim
const SHOT_SPEED = 2600;        // px/s
const COMBO_WINDOW = 1.15;      // seconds to keep the combo alive
const MAX_COMBO = 5;

function patternForLevel(level: number): Pattern {
  if (level <= 2) return 'steady';
  const cycle: Pattern[] = ['steady', 'reverse', 'pulse', 'drunk'];
  return cycle[(level + 1) % cycle.length];
}

export class SpinEngine {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;

  phase: GamePhase = 'menu';
  level = 1;
  score = 0;
  combo = 1;

  private rotation = 0;
  private omega = 1.2;
  private dir = 1;
  private patternT = 0;
  private nextFlip = 2;
  private pattern: Pattern = 'steady';

  private pins: Pin[] = [];
  private pinsLeft = 0;
  private shot: { y: number } | null = null;
  private comboTimer = 0;

  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private deadFlash = 0;
  private levelFlash = 0;

  private audio: AudioContext | null = null;
  muted = false;

  constructor(private canvas: HTMLCanvasElement, private events: EngineEvents) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  start() {
    this.level = 1;
    this.score = 0;
    this.combo = 1;
    this.beginLevel(1);
    this.phase = 'playing';
    this.events.onScore(0, 1);
    this.events.onLevel(1);
  }

  /** Resume after a paid continue: clears crowding around the crash site. */
  continueRun() {
    if (this.phase !== 'dead') return;
    // Remove a third of the pins to give the player room again.
    this.pins = this.pins.filter((_, i) => i % 3 !== 0);
    this.shot = null;
    this.deadFlash = 0;
    this.phase = 'playing';
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  run() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min((t - this.last) / 1000, 1 / 20);
      this.last = t;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tap() {
    if (this.phase !== 'playing' || this.shot) return;
    this.shot = { y: this.h - 90 };
    this.blip(340, 0.04);
  }

  private beginLevel(level: number) {
    this.pins = [];
    this.rotation = 0;
    this.patternT = 0;
    this.nextFlip = 1.5 + Math.random() * 2;
    this.pattern = patternForLevel(level);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.omega = 1.15 + level * 0.16 + Math.random() * 0.1;
    this.pinsLeft = Math.min(6 + level, 14);
    // Pre-placed obstacle pins, evenly-ish spread with jitter.
    const obstacles = Math.min(1 + Math.floor(level / 2), 6);
    for (let i = 0; i < obstacles; i++) {
      this.pins.push({ angle: (TAU / obstacles) * i + (Math.random() - 0.5) * 0.5, combo: 0 });
    }
    this.shot = null;
  }

  private update(dt: number) {
    // Rotation pattern
    this.patternT += dt;
    let omega = this.omega;
    switch (this.pattern) {
      case 'reverse':
        if (this.patternT > this.nextFlip) {
          this.dir *= -1;
          this.patternT = 0;
          this.nextFlip = 0.9 + Math.random() * 1.8;
        }
        break;
      case 'pulse':
        omega = this.omega * (0.35 + 0.75 * Math.abs(Math.sin(this.patternT * 1.7)));
        break;
      case 'drunk':
        omega = this.omega * Math.sin(this.patternT * 1.1) * 1.4;
        break;
    }
    if (this.phase === 'playing' || this.phase === 'dead') {
      this.rotation += (this.pattern === 'drunk' ? omega : omega * this.dir) * dt;
    }

    // Combo decay
    if (this.combo > 1) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.events.onScore(this.score, this.combo);
      }
    }

    // Shot pin travel + collision
    if (this.shot && this.phase === 'playing') {
      this.shot.y -= SHOT_SPEED * dt;
      const { cy, R } = this.geometry();
      const tipY = this.shot.y - PIN_LEN;
      if (tipY <= cy + R) {
        // The pin arrives from straight below: relative angle on the hive.
        const hitAngle = norm(Math.PI / 2 - this.rotation);
        const collided = this.pins.some((p) => angDist(p.angle, hitAngle) < MIN_GAP);
        if (collided) {
          this.die();
        } else {
          this.pins.push({ angle: hitAngle, combo: this.combo });
          this.pinsLeft--;
          const gained = this.combo;
          this.score += gained;
          this.comboTimer = COMBO_WINDOW;
          this.combo = Math.min(this.combo + 1, MAX_COMBO);
          this.burst(this.w / 2, cy + R + 10, this.comboColor(gained), 10);
          this.popups.push({
            x: this.w / 2, y: cy + R + 34,
            text: gained > 1 ? `+${gained} x${gained}` : '+1',
            life: 0.8, color: this.comboColor(gained),
          });
          this.blip(420 + gained * 60, 0.05);
          this.events.onScore(this.score, this.combo);
          if (this.pinsLeft <= 0) this.clearLevel();
        }
        this.shot = null;
      }
    }

    // FX
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      return p.life > 0;
    });
    this.popups = this.popups.filter((p) => {
      p.life -= dt;
      p.y -= 40 * dt;
      return p.life > 0;
    });
    this.shake = Math.max(0, this.shake - dt * 30);
    this.deadFlash = Math.max(0, this.deadFlash - dt * 2);
    this.levelFlash = Math.max(0, this.levelFlash - dt * 1.5);
  }

  private clearLevel() {
    const bonus = this.level * 10;
    this.score += bonus;
    this.events.onLevelCleared(this.level, bonus);
    this.level++;
    this.levelFlash = 1;
    this.blip(660, 0.12);
    this.blip(880, 0.12);
    this.beginLevel(this.level);
    this.events.onLevel(this.level);
    this.events.onScore(this.score, this.combo);
  }

  private die() {
    this.phase = 'dead';
    this.shake = 14;
    this.deadFlash = 1;
    const { cy, R } = this.geometry();
    this.burst(this.w / 2, cy + R + 10, '#ff5d5d', 26);
    this.blip(120, 0.25, 'sawtooth');
    this.events.onDeath(this.score, this.level);
  }

  private geometry() {
    const cy = Math.min(this.h * 0.36, 320);
    const R = Math.min(this.w, this.h) * 0.14;
    return { cy, R };
  }

  private comboColor(c: number): string {
    const colors = ['#ffd76a', '#ffd76a', '#ffb84d', '#ff9a3d', '#ff7a45', '#ff5d5d'];
    return colors[Math.min(c, colors.length - 1)];
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 80 + Math.random() * 260;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
        life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        color, size: 2 + Math.random() * 3,
      });
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType = 'square') {
    if (this.muted) return;
    try {
      this.audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audio;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      /* audio is best-effort */
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────

  private draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Background: deep space-hive gradient, hue drifts with level.
    const hue = (38 + this.level * 14) % 360;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b0d12');
    g.addColorStop(1, `hsl(${hue}, 30%, 8%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (this.deadFlash > 0) {
      ctx.fillStyle = `rgba(255, 60, 60, ${this.deadFlash * 0.18})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.levelFlash > 0) {
      ctx.fillStyle = `rgba(255, 215, 106, ${this.levelFlash * 0.12})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    const { cy, R } = this.geometry();
    const cx = w / 2;

    // Hive core: hexagon in a glow ring.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rotation);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (TAU / 6) * i;
      const x = Math.cos(a) * R;
      const y = Math.sin(a) * R;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#151a23';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffd76a';
    ctx.shadowColor = '#ffd76a';
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Cells
    ctx.strokeStyle = 'rgba(255,215,106,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.55, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Placed pins rotate with the hive.
    for (const pin of this.pins) {
      const a = pin.angle + this.rotation;
      const bx = cx + Math.cos(a) * R;
      const by = cy + Math.sin(a) * R;
      const tx = cx + Math.cos(a) * (R + PIN_LEN);
      const ty = cy + Math.sin(a) * (R + PIN_LEN);
      ctx.strokeStyle = pin.combo === 0 ? '#6b7280' : 'rgba(255,215,106,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, TAU);
      ctx.fillStyle = pin.combo === 0 ? '#6b7280' : this.comboColor(pin.combo);
      ctx.fill();
    }

    // In-flight shot
    if (this.shot) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, this.shot.y);
      ctx.lineTo(cx, this.shot.y - PIN_LEN);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, this.shot.y, 7, 0, TAU);
      ctx.fillStyle = '#ffd76a';
      ctx.fill();
    }

    // Waiting pins at the bottom (ammo)
    if (this.phase === 'playing') {
      for (let i = 0; i < Math.min(this.pinsLeft - (this.shot ? 0 : 1) + 1, 5); i++) {
        const y = h - 90 + i * 26;
        if (i === 0 && !this.shot) {
          ctx.beginPath();
          ctx.arc(cx, y, 7, 0, TAU);
          ctx.fillStyle = '#ffd76a';
          ctx.fill();
        } else if (i > 0) {
          ctx.beginPath();
          ctx.arc(cx, y, 4, 0, TAU);
          ctx.fillStyle = 'rgba(255,215,106,0.35)';
          ctx.fill();
        }
      }
      // Remaining count
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.pinsLeft}`, cx + 26, h - 84);
    }

    // Particles & popups
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(p.life / 0.4, 1);
      ctx.fillStyle = p.color;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }
}

function norm(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

function angDist(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, TAU - d);
}
