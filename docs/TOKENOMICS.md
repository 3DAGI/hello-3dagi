# $FUEL Tokenomics — Pixel Drag Racer

$FUEL is the SPL token behind all on-chain economics. It is minted **only** by the
game's program (mint authority = config PDA, seed `"fuel"`, 6 decimals) — there is
no premine and no admin mint path.

## Earning (emissions)

| Source | Amount | Notes |
|---|---|---|
| New season personal best | `base_reward` (default 10 FUEL) | once per improvement, capped naturally by physics |
| Season rank 1 | 500 × base = 5,000 FUEL | paid at `end_season` |
| Season rank 2 / 3 | 3,000 / 2,000 FUEL | |
| Season ranks 4–8 | 1,000 FUEL each | |
| Season ranks 9–16 | 500 FUEL each | |
| Referrals | 5% (`referral_bps` = 500) of every reward your recruits earn | forever, minted on top |

Rewards accrue as `claimable` on the player PDA and are minted on `claim` —
players pay their own claim fee, keeping spam low.

## Sinks (burns)

| Sink | Amount |
|---|---|
| PvP duel rake | 3% of every pot, burned at settle |
| Ranked match rake | 3% of every ranked pot (50 FUEL stakes), burned at settle |
| **Car NFT mints** | 100% of the mint price burned (2,000–110,000 FUEL per model) |

Planned sinks (roadmap): premium car skins for FUEL (100% burn), season entry
fees for a pro league, upgrade respec.

## Car NFTs

Every car model can be minted as a real Metaplex NFT (`mint_car`): metadata +
master edition, 5% secondary royalty, freely tradeable on any marketplace
(Tensor, Magic Eden, ...). The mint price in FUEL is burned entirely, making
cars the main deflationary sink. Holding a car NFT in the connected wallet
unlocks that model in-game — buy in-game with cash for casual play, or mint the
NFT for true ownership and trading. Mint prices: HATCH 86 2,000 / ROAD KING V8
6,500 / RX TURBO 18,000 / VIPER GT 42,000 / TOP FUEL X 110,000 FUEL.

## Why NOS is NOT a second token (design decision)

A separate tradeable "NOS token" was considered and rejected for v1:

- **Split liquidity**: two thin markets are worse than one healthy one.
- **Balance risk**: if a NOS token pumps, a core race mechanic becomes
  pay-walled for casual players; if it dumps, the sink stops mattering.
- **Ranked integrity**: consumable power bought on a market inside a ranked
  ladder is pay-to-win by definition.

Instead, the same economic effect (recurring demand + burn) comes from FUEL
itself: NOS bottle upgrades and future consumable refills are priced in FUEL
and burned. If a tradeable NOS asset is ever wanted, the clean design is a
"NOS CHARGE" SPL token mintable *only* by burning FUEL at a fixed rate —
effectively wrapped FUEL with utility, which cannot decouple from the main
economy. The program's burn helpers already support adding this later.

## PvP staking

Duels escrow both stakes in a program-owned vault. Lowest ET takes
`2 × stake × 97%`; ties and double no-shows refund. A missing submission after
the deadline counts as a loss — no hostage situations.

## Referral mechanics

- A referrer is set **once**, at on-chain registration, and must already be
  registered themself (no self-referrals, enforced by the program).
- The referrer earns `referral_bps` of every FUEL credit their recruit receives
  (personal bests **and** season rank rewards), minted additionally — the recruit
  never loses anything.
- Referral code = wallet address; the game copies/pastes it via clipboard.

## Season cadence

`season_duration` is set at initialization (recommended: 14 days). After
`season_end`, anyone can call `end_season` (the game does it opportunistically):
rank rewards are credited, the board resets, the next season starts immediately.

## Supply model

Supply is emission-driven (no hard cap in v1). Rough steady-state per season:
- Board rewards: 16,500 FUEL
- PB rewards: ~10 FUEL × active grinders
- Referral overhead: ≤ 5% of the above.

Duel rake burn scales with PvP volume and is the counterweight; if PvP volume is
healthy, net inflation trends to zero. A hard cap + emission halvings can be added
in v2 by gating `claim` against a global emission counter.

## Fairness / trust model

Race times are signed by the player's wallet — the client is authoritative. That
is fine for a fun season and duels between people who know each other, but a real
money league needs one of:
1. a telemetry oracle that co-signs plausible runs (input replay verification),
2. deterministic replay verification on a server that co-signs, or
3. zk-proof of the race simulation (research-grade).

The program already validates hard bounds (4.000s–60.000s) and the physics caps
what is reachable in-game (~6.2s fully maxed dragster).
