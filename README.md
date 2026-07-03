# SWARM Protocol ⚡ — SWARM Spin 🐝

**Decentralized AI Compute Mining Marketplace** on Solana — now with
**SWARM Spin**, a one-tap arcade game that pays out 🍯 **HONEY**, the
game's hard-capped SPL token.

## SWARM Spin — tap. sting. earn.

An "aa"-style reflex game: a hive rotates, you shoot drone-bees into it.
Hit another drone → squished. Speed, reversals and drunk-wobble rotation
ramp up every hive; fast consecutive hits build up to a **x5 combo**.

- 🎮 **Addiction loops**: combos, escalating levels, daily streak bonus
  (+10%/day up to 2x), "one more try" continues
- 👛 **Wallet connect**: Phantom & Solflare (desktop + mobile), **Seed Vault
  on Solana Seeker/Saga** via the Mobile Wallet Adapter (auto-registered on
  Android)
- 🪙 **Real tokenomics**: emissions, halvings, caps, burns and staking are
  enforced by an Anchor program — see [TOKENOMICS.md](TOKENOMICS.md)

### Repo layout

```
app/                  React + Vite game client (wallet adapter, canvas engine)
programs/swarm-spin/  Anchor program: HONEY mint, emissions, burns, staking
tests/                Anchor integration tests (local validator)
TOKENOMICS.md         Full economic design
```

### Run the game

```bash
cd app
npm install
npm run dev      # http://localhost:5173
```

The game is fully playable in **demo mode** (HONEY accrues locally). To go
on-chain:

```bash
# prerequisites: solana CLI + anchor 0.30.x
anchor keys sync         # writes your real program id into lib.rs / Anchor.toml
anchor build
anchor deploy --provider.cluster devnet
# initialize the config with the genesis params from TOKENOMICS.md,
# then set PROGRAM_ID + ONCHAIN_ENABLED=true in app/src/config.ts
```

`submit_score` supports an optional `score_authority` co-signer so a backend
can attest scores before mainnet — leave it as `Pubkey::default()` on devnet
for trustless testing.

### Token in one paragraph

1B HONEY hard cap. 40% is play-to-earn, mintable **only** by the program PDA,
halving every 180 days with per-player and global daily caps. Continues burn
100% of their cost, staking locks supply for up to a 2x earn multiplier.
Details: [TOKENOMICS.md](TOKENOMICS.md).

---

*Follow for launch updates.*

[SWARM Protocol] · [Solana] · [@3DAGI]
