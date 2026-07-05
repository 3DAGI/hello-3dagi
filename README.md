# Pixel Drag Racer 🏁

A simple **pixel-art drag racing game for mobile** (landscape) — tachometer, manual
gearbox, christmas-tree start, quarter-mile races against AI opponents, and a garage
full of upgrades.

- **Gameplay**: rev at the tree, launch in the sweet spot, shift at redline. Perfect
  launches and perfect shifts win races. Best times saved per car.
- **Career mode**: 19 rivals that get faster and faster (18.5s down to 9.2s), with a
  boss fight every 5 stages. Quick Race (STREET / PRO / BOSS) stays open for grinding.
- **5 cars**: from the HATCH 86 starter to the TOP FUEL X dragster — each with its own
  pixel look, gearing, power band, grip and price.
- **Garage**: 7 upgrade categories with named real-world stages (e.g. Engine:
  Sport Filter → Race Camshaft → Forged Pistons → Stroker Kit → Race Block), including
  a NITROUS system with its own NOS button in the race.
- **Tech**: HTML5 canvas + vanilla JS (Vite), wrapped with Capacitor for native builds.
- **iOS / TestFlight**: native Xcode project included — see [docs/IOS_BUILD.md](docs/IOS_BUILD.md).
- **Solana Seeker / Android**: APK build (`android/`) with on-chain race records —
  connect the phone's wallet via Mobile Wallet Adapter and sign your best quarter-mile
  times as Solana memo transactions. Build + dApp Store publishing guide in
  [docs/SOLANA_SEEKER.md](docs/SOLANA_SEEKER.md).

```bash
npm install
npm run dev        # play in the browser (Space = gas, ↑/↓ = shift)
npm run ios        # build + open in Xcode (macOS)
```

---

# SWARM Protocol ⚡

**Decentralized AI Compute Mining Marketplace** on Solana.

## What is SWARM?

SWARM is a peer-to-peer compute marketplace where **GPU providers** earn token rewards for serving AI inference workloads, and **AI developers** access decentralized compute at market rates — no cloud vendor lock-in.

### Key Features

- **Solo + Pool Mining** — Mine solo or stake SOL to join a mining pool
- **On-Chain Rewards** — Every compute contribution settled on Solana
- **Deflationary Tokenomics** — Buyback-and-burn mechanism
- **4-Tier Staking** — Stake to earn boosted rewards

### Network

- **Protocol**: Solana (Anchor 0.30)
- **Mining**: Dual-mode (solo and pooled)
- **Incentives**: Proof-of-Compute with staking bonuses

---

*Follow for launch updates. No code — just compute.*

[SWARM Protocol] · [Solana] · [@3DAGI]
