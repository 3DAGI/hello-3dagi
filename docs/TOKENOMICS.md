# Pixel Drag Racer — Tokenomics (v2, three-asset economy)

The economy runs on four assets with clearly separated roles — the standard
web3-gaming split of *earned currency*, *payment rails* and *soft currency*:

| Asset | Role | Who issues it |
|---|---|---|
| **CASH** | soft currency, off-chain | the game (races) |
| **$FUEL** | earned reward token & unit of account | the program (emissions only) |
| **SOL** | hard payment rail | Solana |
| **SKR** | ecosystem payment rail (Seeker) | Solana Mobile |

Design principles (common economics):
1. **One unit of account.** Everything is priced in FUEL; SOL/SKR prices are
   derived from admin-set exchange rates (`sol_rate`, `skr_rate`, adjustable via
   `set_rates` — an oracle can replace this later). No item has three
   independent prices that can drift apart.
2. **Never emit what you cannot mint.** FUEL is emitted for play; SOL and SKR
   are only ever *redistributed* — they enter through purchases and leave
   through season prizes and marketplace sales. The program cannot go
   insolvent in SOL/SKR by construction (pools use a committed-funds ledger).
3. **Real yield, not inflation.** Hard-currency revenue is split
   **50% season prize pool / 50% treasury** at the moment of purchase.
   Spenders fund winners; the game earns the other half.
4. **Ecosystem alignment.** Paying with SKR is `skr_discount_bps` cheaper
   (default 10%) — classic take-rate discount to drive the Seeker rail.
5. **Every FUEL payment burns.** FUEL entering the shop, mints or fees is
   destroyed, making play-earned supply scarcer as the economy grows.

## Money flows

```
                 races / bests / referrals / bosses
                     (FUEL emissions, capped)
                              |
        +---------------------v----------------------+
        |                  PLAYER                     |
        +--+----------------+----------------+-------+
           | FUEL           | SOL            | SKR (-10%)
           v                v                v
        BURNED         50% / 50%        50% / 50%
                      /         \      /         \
              SEASON POOL   TREASURY  SEASON POOL  TREASURY
                   |                       |
                   +----- end_season ------+
                   |  (rank-weighted pro-rata)
                   v
             TOP-16 PLAYERS  --claim-->  wallets
```

## Earning FUEL (emissions)

| Source | Amount |
|---|---|
| New season personal best | `base_reward` (10 FUEL) |
| Season ranks 1/2/3 | 5,000 / 3,000 / 2,000 FUEL |
| Season ranks 4–8 / 9–16 | 1,000 / 500 FUEL |
| Career bosses (once each) | 25 / 50 / 100 / 250 FUEL |
| Referrals | 5% of every recruit reward, minted on top |

## Season prizes (SOL + SKR, real yield)

`end_season` snapshots the uncommitted SOL and SKR pool balances and credits
the top-16 pro-rata by rank weight (rank 1 gets 500/1900 of the pool, etc.).
Amounts sit as `claimable_sol` / `claimable_skr` on the player profile until
`claim` pays FUEL + SOL + SKR in one transaction. The `committed_*` ledger in
the config guarantees a season can never promise coins that a previous season
already promised.

## Spending (sinks & routing)

| Purchase | Price (FUEL terms) | FUEL path | SOL/SKR path |
|---|---|---|---|
| Car NFT mint | 2,000–110,000 | 100% burn | 50% pool / 50% treasury |
| Shop packs (on-chain) | 250 / 800 / 2,000 | 100% burn | 50% pool / 50% treasury |
| Marketplace fee (3%) | on every sale | burn | 50% pool / 50% treasury |
| Duel / ranked rake (3%) | FUEL stakes | burn | — |

The **marketplace** itself is currency-agnostic: sellers list car NFTs in
FUEL, SOL or SKR; the buyer pays in the listing currency, the seller receives
97%, the 3% fee follows the table above. Cash packs remain as the off-chain
soft-currency sink; on-chain packs grant the same drop tables via pack
credits stored on the player profile.

## Why this holds together

- **FUEL demand** comes from mints, packs and fees (all burn) while emissions
  are bounded by play; net supply tightens as spending grows.
- **SOL/SKR never inflate anything** — they cycle from spenders to the prize
  pool to competitive players, with the treasury as the game's revenue.
- **Season prizes scale with revenue**: a dead season pays little, a busy
  season pays a lot — no fixed liabilities.
- **SKR discount** makes the Seeker rail the rational default without
  excluding anyone.
- **No second reward token** (see the NOS decision below) — one thin earned
  asset is easier to keep healthy than two.

## Why NOS is NOT a second token (design decision)

A separate tradeable "NOS token" was considered and rejected:
- split liquidity, balance risk if it pumps/dumps, and pay-to-win pressure in
  ranked. NOS upgrades stay priced in FUEL (burned). If a tradeable NOS asset
  is ever wanted, mint it *only* by burning FUEL at a fixed rate (wrapped
  FUEL with utility) so it cannot decouple from the main economy.

## Parameters (initialize / set_rates)

| Param | Default | Meaning |
|---|---|---|
| `base_reward` | 10 FUEL | per personal best |
| `referral_bps` | 500 | 5% referral cut |
| `sol_rate` | e.g. 5,000 | lamports per whole FUEL |
| `skr_rate` | e.g. 10,000 | SKR base units per whole FUEL |
| `skr_discount_bps` | 1,000 | 10% cheaper in SKR |
| `season_duration` | 14 days | prize cadence |

Rates are the one knob that needs care at mainnet: set them from market
prices at launch and adjust via `set_rates` (or wire a Pyth/Switchboard
oracle in v3). On devnet, any SPL mint can stand in for SKR.

## Fairness / trust model

Race times are signed by the player's wallet (client-authoritative). Fine for
seasonal fun; a real-money league needs a telemetry oracle co-signer —
documented as the anti-cheat roadmap. Hard bounds (4.0–60.0s) are enforced
on-chain.
