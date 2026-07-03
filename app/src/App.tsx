import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { SpinEngine } from './game/engine';
import { buildClaimTransaction } from './chain/swarmSpin';
import {
  ONCHAIN_ENABLED,
  HONEY_PER_POINT,
  CONTINUE_BASE_COST,
  NETWORK,
} from './config';

type Screen = 'menu' | 'playing' | 'dead';

interface Persisted {
  best: number;
  pendingHoney: number;
  streak: number;
  lastPlayedDay: number;
}

const STORE_KEY = 'swarm-spin-v1';

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { best: 0, pendingHoney: 0, streak: 0, lastPlayedDay: 0, ...JSON.parse(raw) };
  } catch { /* fresh start */ }
  return { best: 0, pendingHoney: 0, streak: 0, lastPlayedDay: 0 };
}

function save(p: Persisted) {
  localStorage.setItem(STORE_KEY, JSON.stringify(p));
}

function today(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/** Daily streak boosts earnings: +10% per consecutive day, capped at 2x. */
function streakMultiplier(streak: number): number {
  return Math.min(1 + streak * 0.1, 2);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpinEngine | null>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [level, setLevel] = useState(1);
  const [store, setStore] = useState<Persisted>(load);
  const [continues, setContinues] = useState(0);
  const [runHoney, setRunHoney] = useState(0);
  const [muted, setMuted] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const screenRef = useRef(screen);
  screenRef.current = screen;
  const storeRef = useRef(store);
  storeRef.current = store;
  const continuesRef = useRef(continues);
  continuesRef.current = continues;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new SpinEngine(canvas, {
      onScore: (s, c) => { setScore(s); setCombo(c); },
      onLevel: (l) => setLevel(l),
      onLevelCleared: () => {},
      onDeath: (finalScore) => {
        const day = today();
        const prev = storeRef.current;
        // Streak: +1 if last play was yesterday, reset if older, keep if today.
        const streak =
          prev.lastPlayedDay === day ? prev.streak
          : prev.lastPlayedDay === day - 1 ? prev.streak + 1
          : 1;
        const earned = finalScore * HONEY_PER_POINT * streakMultiplier(streak);
        const next: Persisted = {
          best: Math.max(prev.best, finalScore),
          pendingHoney: prev.pendingHoney + earned,
          streak,
          lastPlayedDay: day,
        };
        setRunHoney(earned);
        setStore(next);
        save(next);
        setScreen('dead');
      },
    });
    engineRef.current = engine;
    engine.run();

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.stop();
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.muted = muted;
  }, [muted]);

  const tap = useCallback(() => {
    if (screenRef.current === 'playing') engineRef.current?.tap();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); tap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tap]);

  const startGame = () => {
    setContinues(0);
    setClaimMsg(null);
    engineRef.current?.start();
    setScreen('playing');
  };

  const continueCost = CONTINUE_BASE_COST * Math.pow(2, continues);
  const canContinue = store.pendingHoney >= continueCost;

  const buyContinue = () => {
    if (!canContinue) return;
    // Burn from the local pending balance (mirrors the on-chain buy_continue burn).
    const next = { ...store, pendingHoney: store.pendingHoney - continueCost };
    setStore(next);
    save(next);
    setContinues(continues + 1);
    engineRef.current?.continueRun();
    setScreen('playing');
  };

  const claim = async () => {
    if (!publicKey || claiming) return;
    setClaiming(true);
    setClaimMsg(null);
    try {
      const points = BigInt(Math.floor(store.pendingHoney / HONEY_PER_POINT));
      const tx = await buildClaimTransaction(connection, publicKey, points);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      const next = { ...store, pendingHoney: 0 };
      setStore(next);
      save(next);
      setClaimMsg(`Claimed! ${sig.slice(0, 8)}…`);
    } catch (e: any) {
      setClaimMsg(e?.message ?? 'Claim failed');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="shell" onPointerDown={tap}>
      <canvas ref={canvasRef} className="game-canvas" />

      {/* HUD */}
      <div className="hud">
        <div className="hud-left">
          <div className="score">{score}</div>
          {combo > 1 && <div className="combo">x{combo} combo</div>}
        </div>
        <div className="hud-right" onPointerDown={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => setMuted(!muted)}>
            {muted ? '🔇' : '🔊'}
          </button>
          <WalletMultiButton />
        </div>
      </div>
      {screen === 'playing' && <div className="level-tag">HIVE {level}</div>}

      {/* Menu */}
      {screen === 'menu' && (
        <div className="overlay" onPointerDown={(e) => e.stopPropagation()}>
          <h1 className="logo">SWARM<span>SPIN</span></h1>
          <p className="tagline">tap. sting. earn.</p>
          <div className="stats-row">
            <div className="stat"><b>{store.best}</b><span>best</span></div>
            <div className="stat">
              <b>{store.pendingHoney.toFixed(2)}</b><span>🍯 HONEY</span>
            </div>
            <div className="stat">
              <b>{store.streak || 0}🔥</b>
              <span>streak x{streakMultiplier(store.streak).toFixed(1)}</span>
            </div>
          </div>
          <button className="cta" onClick={startGame}>PLAY</button>
          {store.pendingHoney > 0 && (
            connected ? (
              <button className="secondary" onClick={claim} disabled={claiming || !ONCHAIN_ENABLED}>
                {claiming ? 'Claiming…'
                  : ONCHAIN_ENABLED
                    ? `Claim ${store.pendingHoney.toFixed(2)} HONEY on ${NETWORK}`
                    : 'On-chain claim: program not deployed yet'}
              </button>
            ) : (
              <p className="hint">Connect a wallet (Phantom / Solflare / Seed Vault) to claim HONEY on-chain</p>
            )
          )}
          {claimMsg && <p className="hint">{claimMsg}</p>}
          <p className="hint small">tap / space to shoot a drone into the hive — don't hit another drone</p>
        </div>
      )}

      {/* Game over */}
      {screen === 'dead' && (
        <div className="overlay" onPointerDown={(e) => e.stopPropagation()}>
          <h2 className="dead-title">SQUISHED!</h2>
          <div className="final-score">{score}</div>
          {score >= store.best && score > 0 && <div className="new-best">NEW BEST</div>}
          <p className="earn-line">
            +{runHoney.toFixed(2)} 🍯 HONEY
            {store.streak > 1 && <span className="streak-note"> (x{streakMultiplier(store.streak).toFixed(1)} streak)</span>}
          </p>
          <button className="cta" onClick={startGame}>PLAY AGAIN</button>
          <button className="secondary" onClick={buyContinue} disabled={!canContinue}>
            🔥 Continue — burn {continueCost} HONEY
          </button>
          <p className="hint small">balance: {store.pendingHoney.toFixed(2)} HONEY · continues double in price</p>
        </div>
      )}
    </div>
  );
}
