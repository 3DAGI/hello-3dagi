# 🍯 HONEY Tokenomics — SWARM Spin

HONEY is the SPL utility token of **SWARM Spin**, the arcade game of the SWARM
Protocol ecosystem. Every rule below that touches supply is **enforced by the
on-chain program** in [`programs/swarm-spin`](programs/swarm-spin/src/lib.rs) —
not by a promise in a document.

## Token

| | |
|---|---|
| Symbol | HONEY |
| Standard | SPL Token (Solana) |
| Decimals | 6 |
| Max supply | **1,000,000,000 HONEY** (hard cap) |
| Mint authority | `config` PDA of the swarm-spin program (no human can mint) |

## Allocation

| Bucket | % | Amount | Notes |
|---|---|---|---|
| 🎮 Play-to-earn emissions | 40% | 400,000,000 | Minted by the program only, per the emission schedule below |
| 💧 Liquidity | 20% | 200,000,000 | DEX pools, LP locked |
| 🏛 Treasury / ecosystem | 15% | 150,000,000 | 4-year linear vesting |
| 🪙 Staking rewards | 10% | 100,000,000 | Funds future staking APY programs |
| 🎁 Community / quests / airdrops | 10% | 100,000,000 | Seasonal events, tournaments |
| 👥 Team | 5% | 50,000,000 | 1-year cliff, then 2-year linear vesting |

The non-gameplay buckets are minted at genesis into vesting/multisig vaults;
afterwards the mint authority is handed to the program PDA, which can only mint
within the play-to-earn budget (`max_emission = 400M`, tracked in
`total_emitted`).

## Earning (faucet)

- **1 score point = 0.01 HONEY** base rate (`base_reward = 10_000` base units).
- **Halving every 180 days**: all emissions (rates *and* caps) halve, Bitcoin
  style. Emission budget therefore converges: 400M is never exceeded even in
  theory, and the program additionally enforces the hard cap.
- **Daily player cap**: 500 HONEY/day per wallet (halves with the schedule) —
  caps botting profitability.
- **Global daily cap**: ~1.1M HONEY/day in period 1 (halves with the schedule).
- **Cooldown**: minimum 90 seconds between score submissions per wallet.
- **Max score per run** sanity cap.
- **Score attestation**: `submit_score` optionally requires a co-signature from
  a `score_authority` backend key that verifies the run server-side. Set to
  `Pubkey::default()` for trustless dev mode on devnet.
- **Daily streak** (client-side retention hook): +10% earnings per consecutive
  play day, capped at 2x. Applied before the on-chain caps, so it can never
  break them.

### Emission schedule (period 1 daily cap ≈ 1.11M)

| Period | Days | Emission budget | Cumulative |
|---|---|---|---|
| 1 | 0–180 | 200M | 200M |
| 2 | 180–360 | 100M | 300M |
| 3 | 360–540 | 50M | 350M |
| 4 | 540–720 | 25M | 375M |
| 5+ | 720+ | halving continues | → 400M asymptote |

## Burning (sinks)

Sinks are what make an arcade economy sustainable — HONEY must be *worth
spending*:

| Sink | Mechanic | Split |
|---|---|---|
| 🔥 **Continues** | Keep a run alive after death; price doubles per continue within a run (25 → 50 → 100 …) | **100% burned** (on-chain `buy_continue`) |
| 🎨 Cosmetics (skins, trails) | Planned | 50% burn / 50% treasury |
| 🏆 Tournament entries | Planned | 70% prize pool / 20% burn / 10% treasury |

The continue mechanic is deliberately the core sink: it monetizes exactly the
"one more try" moment that makes the game addictive, and its exponential
pricing self-limits whales without hard caps.

## Staking (velocity sink + retention)

Lock HONEY in the program vault for a permanent earn multiplier
(enforced on-chain in `stake_multiplier_bps`):

| Tier | Staked | Multiplier | Min lock |
|---|---|---|---|
| 🐝 Worker | ≥ 1,000 | 1.10x | 7 days |
| 🛡 Guard | ≥ 10,000 | 1.25x | 7 days |
| 👑 Queen's Court | ≥ 100,000 | 1.50x | 7 days |
| 👸 Queen | ≥ 1,000,000 | 2.00x | 7 days |

Staking pulls circulating supply out of the market while increasing a player's
reason to come back daily — the multiplier only pays off if you play.

## Why this holds together

1. **Supply is provably scarce**: mint authority is a PDA; emissions are
   hard-capped and halving. No admin mint function exists.
2. **Faucet shrinks, sinks grow**: as the player base grows, continue/cosmetic
   burn scales with usage while emissions decay on a fixed schedule →
   structurally deflationary over time.
3. **Bot resistance in layers**: per-wallet daily caps + cooldowns + global
   caps bound the damage of any exploit; score attestation closes the loop for
   mainnet.
4. **Earning is bounded, spending is not**: a player can earn at most
   500/day but can burn unlimited amounts chasing a high score.
5. **Retention loops align with the token**: streaks (play daily), staking
   (hold to earn more), continues (spend at the emotional peak).

## Parameters at genesis (program `InitParams`)

| Param | Value | Base units |
|---|---|---|
| `base_reward` | 0.01 HONEY / point | `10_000` |
| `max_score_per_run` | 5,000 | — |
| `cooldown_secs` | 90 | — |
| `player_daily_cap` | 500 HONEY | `500_000_000` |
| `epoch_emission_cap` | 1,111,111 HONEY | `1_111_111_000_000` |
| `halving_period` | 180 days | `15_552_000` s |
| `max_emission` | 400M HONEY | `400_000_000_000_000` |
| `continue_cost` | 25 HONEY | `25_000_000` |
| `min_stake_lock_secs` | 7 days | `604_800` s |
