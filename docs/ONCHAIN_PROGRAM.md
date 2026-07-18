# On-Chain Program — Build, Deploy, Wire Up

Anchor workspace in `anchor/`: program `pixel_drag_racer`
(`anchor/programs/pixel-drag-racer/src/lib.rs`). `cargo check` passes; deploying
needs the Solana + Anchor toolchain.

## Accounts (PDAs)

| PDA | Seeds | Purpose |
|---|---|---|
| Config | `["config"]` | admin, mint, season index/end, base_reward, referral_bps |
| Fuel mint | `["fuel"]` | SPL mint, authority = config PDA, 6 decimals |
| SeasonBoard | `["season", u16 le]` | top-16 `{wallet, et_ms, car, ts}`, sorted |
| Player | `["player", wallet]` | referrer, season PB, races, claimable, referral stats |
| Duel | `["duel", creator, u32 le]` | PvP state incl. stakes + submitted ETs |
| Vault | `["vault", duel]` | token account escrowing both stakes |

## Instructions

- `initialize(season_duration, base_reward, referral_bps)` — admin, once
- `register(referrer: Option<Pubkey>)` — creates Player; referrer fixed forever
- `submit_time(et_ms, car)` — validates bounds, credits PB reward + referral cut,
  inserts into the top-16
- `end_season()` — permissionless after season_end; pays rank rewards (top-16
  Player PDAs passed as remaining accounts in board order), rolls the season
- `claim()` — mints `claimable` FUEL to the caller's ATA
- `create_duel(seed, stake)` / `join_duel()` / `submit_duel_time(et_ms)` /
  `settle_duel()` / `cancel_duel()` — PvP flow, 3% rake burned
- `mint_car(model)` — burns the FUEL price and mints the car as a Metaplex NFT
  (metadata + master edition, 5% royalty) to the buyer; mints are enumerable via
  `config.cars_minted` and PDA seeds `["carmint", model, index]`, so the client
  detects wallet-held car NFTs without an indexer. Host the metadata JSONs
  (name/image/attributes per model) at `NFT_BASE_URI` before mainnet.

## Deploy (on your machine)

```bash
# toolchain
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.31.1 && avm use 0.31.1

cd anchor
anchor keys sync            # writes YOUR program id into lib.rs + Anchor.toml
anchor build
solana-keygen new           # if you have no wallet yet
solana airdrop 2 -u devnet
anchor deploy --provider.cluster devnet

# bootstrap the game economy (season 14d, 10 FUEL base, 5% referral)
# e.g. in anchor/tests or a one-off script:
#   program.methods.initialize(new BN(14*86400), new BN(10_000_000), 500)
```

After deploy, put the new program id into `src/chain.js` (`PROGRAM_ID`) — it must
match `declare_id!` in lib.rs — rebuild the app, done. For mainnet: switch
`CLUSTER`/RPC in `src/solana.js`, deploy with a funded keypair.

## Client

`src/chain.js` talks to the program without the Anchor JS SDK: PDAs are derived
locally, instruction data is hand-encoded borsh with precomputed discriminators,
accounts are decoded from raw RPC data. Reads (leaderboard, duel state) work on
every platform; writes go through the Mobile Wallet Adapter (Android/Seeker).

## Game integration

- **ON-CHAIN → BOARD**: season top-8 view, countdown, "SUBMIT" posts your best
- **ON-CHAIN → WALLET**: connect, FUEL balance, claimable, CLAIM
- **ON-CHAIN → DUEL**: create (stake 25/100/500 FUEL, code lands in the
  clipboard), join (paste code), RACE NOW (solo run), submit, settle
- **ON-CHAIN → REFERRAL**: copy your code, paste a friend's, live stats

## Known limitations

- Race times are client-signed (see docs/TOKENOMICS.md, "trust model").
- `end_season` currently requires the top-16 Player PDAs in board order — the
  game/cron caller derives them from the board itself.
- Duel discovery is code-based (clipboard); an on-chain open-duel lobby is a
  nice v2 (single registry PDA with the last N open duels).
