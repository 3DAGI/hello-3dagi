# Game Design — Benchmark Research & Feature Map

## Benchmarks (most-played mobile drag racers)

**CSR Racing 2** (NaturalMotion/Zynga) — the genre king. Core loop: rev the
needle into a *per-car* green zone before GO (too low = bog, too high =
wheelspin), then shift on the green shift light; story ladder of named bosses;
deep tuning (nitrous, tires, gear ratios); live multiplayer.

**Pixel Car Racer** (Studio Furukawa) — the pixel-art reference. Burnouts to
heat tires before the run, manual + clutch transmissions with higher payout
multipliers, dyno tuning with adjustable gear ratios ("land every shift back in
the power peak"), 1000+ parts, liveries/paint designer, multiple race modes
and distances.

**Nitro Nation** (Creative Mobile) — dyno graphs, gear tuning, 33 components,
explicitly *no fuel timers*, team wars.

## Feature map → this project

| Benchmark feature | Status |
|---|---|
| Rev-zone launch + green shift light (CSR2) | ✅ already in (per-car windows) |
| Boss/story ladder (CSR2) | ✅ career mode, 19 rivals |
| Nitrous with timing (CSR2) | ✅ NOS button |
| **Burnout / tire heat** (PCR) | ✅ this update — burnout phase, temp bar, grip bonus |
| **Dyno / gear tuning** (PCR, NN) | ✅ this update — final-drive + NOS balance sliders per car |
| **Paint / liveries** (PCR) | ✅ this update — 8 paints per car (full livery editor = later) |
| **Race distances** (PCR) | ✅ this update — 1/8, 1/4, 1/2 mile in quick race |
| Reaction time on the tree (Door Slammers) | ✅ this update |
| Photo finish drama | ✅ this update — slow-mo + banner under 0.08s |
| Multiple environments | ✅ this update — night city / sunset mesa / docklands |
| No fuel timer (NN) | ✅ by design |
| Licensed cars, 3D, livery designer, crews/teams | ❌ out of scope for pixel v1 |

## New race flow

`BURNOUT (3s, heat tires into the green band)` → `TREE (3 ambers, green)` →
`RACE (shift light, NOS, ghost)` → `slow-mo photo finish if close` → results
with RT, tire-temp grade and earnings.

Tire temp: 55–100% = +6% launch grip ("TIRES HOT!"), overheated ≥100% = −3%.
Reaction time: time from green to first throttle input (0.000 if pre-loaded).
Distances scale AI ET (×0.645 / ×1 / ×1.75) and payouts (×0.6 / ×1 / ×1.5);
career and duels stay 1/4-mile for comparability; the on-chain board only
accepts 1/4-mile bests.
