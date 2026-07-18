// ============================================================
// PIXEL DRAG RACER — on-chain program (Anchor)
//
// - $FUEL SPL token minted by the program (config PDA authority)
// - Season leaderboard: top-16 quarter-mile times in a PDA
// - Personal-best rewards + season rank rewards in $FUEL
// - Referral system: referrer earns bps of every referee reward
// - PvP duels: stake $FUEL, best ET takes the pot, rake burned
//
// Trust model note: race times are signed by the player's wallet
// (client-authoritative). Good enough for season fun + duels among
// friends; a production esports mode should add a telemetry oracle
// co-signer (see docs/ONCHAIN_PROGRAM.md).
// ============================================================

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{
    create_master_edition_v3, create_metadata_accounts_v3,
    mpl_token_metadata::types::{Creator, DataV2},
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("DmnJq3fTKxCzBAW965MxBGa25H9SmKKgSZ2YVNqQQFrh");

pub const BOARD_SIZE: usize = 16;
pub const MIN_ET_MS: u32 = 4_000;    // < 4.000s is physically impossible in game
pub const MAX_ET_MS: u32 = 60_000;
pub const DUEL_TIMEOUT: i64 = 3_600; // 1h to join / submit
pub const RAKE_BPS: u64 = 300;       // 3% of every duel pot is burned

// Season rank rewards, multiplied by config.base_reward (rank 1..16)
pub const RANK_MULT: [u64; BOARD_SIZE] = [
    500, 300, 200, 100, 100, 100, 100, 100, 50, 50, 50, 50, 50, 50, 50, 50,
];

// Ranked on-chain queue
pub const QUEUE_SIZE: usize = 8;
pub const RANKED_START_RP: u16 = 300;
pub const BASE_BAND: i64 = 150;        // matchable RP distance at t=0
pub const BAND_PER_MIN: i64 = 50;      // band widens while waiting
pub const MATCH_TIMEOUT: i64 = 3_600;

// Car NFTs: models, mint prices in whole FUEL (burned = deflationary sink)
pub const CAR_MODELS: usize = 5;
pub const CAR_PRICES_FUEL: [u64; CAR_MODELS] = [2_000, 6_500, 18_000, 42_000, 110_000];
pub const CAR_NAMES: [&str; CAR_MODELS] =
    ["HATCH 86", "ROAD KING V8", "RX TURBO", "VIPER GT", "TOP FUEL X"];
pub const NFT_SYMBOL: &str = "PDRCAR";
pub const NFT_ROYALTY_BPS: u16 = 500; // 5% secondary-market royalty
// metadata JSON per model, served by the project (image + attributes)
pub const NFT_BASE_URI: &str = "https://raw.githubusercontent.com/3DAGI/hello-3dagi/main/nft/";

#[program]
pub mod pixel_drag_racer {
    use super::*;

    /// Admin bootstrap: creates config PDA + the $FUEL mint whose
    /// authority is the config PDA, and opens season 0.
    pub fn initialize(
        ctx: Context<Initialize>,
        season_duration: i64,
        base_reward: u64,
        referral_bps: u16,
    ) -> Result<()> {
        require!(season_duration > 0, PdrError::BadParams);
        require!(referral_bps <= 2_000, PdrError::BadParams); // max 20%
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.mint = ctx.accounts.mint.key();
        cfg.season = 0;
        cfg.season_duration = season_duration;
        cfg.season_end = Clock::get()?.unix_timestamp + season_duration;
        cfg.base_reward = base_reward;
        cfg.referral_bps = referral_bps;
        cfg.cars_minted = [0; CAR_MODELS];
        cfg.bump = ctx.bumps.config;

        let board = &mut ctx.accounts.board;
        board.season = 0;
        board.entries = [BoardEntry::default(); BOARD_SIZE];
        Ok(())
    }

    /// Creates the player profile. `referrer` can only be set here,
    /// once, and must not be the player themself.
    pub fn register(ctx: Context<Register>, referrer: Option<Pubkey>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        if let Some(r) = referrer {
            require!(r != ctx.accounts.authority.key(), PdrError::SelfReferral);
        }
        player.wallet = ctx.accounts.authority.key();
        player.referrer = referrer;
        player.season = ctx.accounts.config.season;
        player.best_et_ms = u32::MAX;
        player.races = 0;
        player.claimable = 0;
        player.referral_count = 0;
        player.referral_earned = 0;
        player.rp = RANKED_START_RP;
        player.active_match = Pubkey::default();
        player.bump = ctx.bumps.player;

        // count the referral on the referrer's profile (if provided)
        if let Some(referrer_key) = referrer {
            let acc = ctx
                .accounts
                .referrer_player
                .as_mut()
                .ok_or(PdrError::MissingReferrerAccount)?;
            require!(acc.wallet == referrer_key, PdrError::ReferrerMismatch);
            acc.referral_count += 1;
        }
        Ok(())
    }

    /// Submit a quarter-mile time. New season personal bests earn
    /// base_reward $FUEL (claimable) and a slot on the leaderboard;
    /// the referrer earns referral_bps of every reward credited.
    pub fn submit_time(ctx: Context<SubmitTime>, et_ms: u32, car: u8) -> Result<()> {
        require!((MIN_ET_MS..=MAX_ET_MS).contains(&et_ms), PdrError::ImplausibleTime);
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        require!(now <= cfg.season_end, PdrError::SeasonOver);

        let player = &mut ctx.accounts.player;
        // lazy reset when a new season started since the last run
        if player.season != cfg.season {
            player.season = cfg.season;
            player.best_et_ms = u32::MAX;
        }
        player.races += 1;

        if et_ms < player.best_et_ms {
            player.best_et_ms = et_ms;

            // credit PB reward + referral cut
            let reward = cfg.base_reward;
            player.claimable += reward;
            if let Some(referrer_key) = player.referrer {
                if let Some(acc) = ctx.accounts.referrer_player.as_mut() {
                    require!(acc.wallet == referrer_key, PdrError::ReferrerMismatch);
                    let cut = reward * cfg.referral_bps as u64 / 10_000;
                    acc.claimable += cut;
                    acc.referral_earned += cut;
                }
            }

            // insert into the season top-16 (sorted ascending by ET)
            let board = &mut ctx.accounts.board;
            require!(board.season == cfg.season, PdrError::WrongBoard);
            let wallet = player.wallet;
            // remove an existing (slower) entry of the same wallet first
            for e in board.entries.iter_mut() {
                if e.wallet == wallet {
                    *e = BoardEntry::default();
                }
            }
            board.entries.sort_by_key(|e| e.et_ms());
            let worst = board.entries[BOARD_SIZE - 1];
            if et_ms < worst.et_ms() {
                board.entries[BOARD_SIZE - 1] = BoardEntry {
                    wallet,
                    et_ms,
                    car,
                    ts: now,
                };
                board.entries.sort_by_key(|e| e.et_ms());
            }
        }
        Ok(())
    }

    /// Anyone can roll the season after season_end. Credits rank
    /// rewards to the top-16 players (their Player PDAs are passed in
    /// board order as remaining accounts), then resets the board.
    pub fn end_season<'info>(
        ctx: Context<'_, '_, 'info, 'info, EndSeason<'info>>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;
        require!(now > cfg.season_end, PdrError::SeasonRunning);
        let board = &mut ctx.accounts.board;
        require!(board.season == cfg.season, PdrError::WrongBoard);

        // pay ranks: remaining_accounts[i] must be the Player PDA of
        // board.entries[i] (skip empty slots)
        for (rank, entry) in board.entries.iter().enumerate() {
            if entry.wallet == Pubkey::default() {
                continue;
            }
            let info = ctx
                .remaining_accounts
                .get(rank)
                .ok_or(PdrError::MissingRankAccount)?;
            let (expect, _) =
                Pubkey::find_program_address(&[b"player", entry.wallet.as_ref()], ctx.program_id);
            require!(info.key() == expect, PdrError::RankAccountMismatch);
            let mut acc: Account<Player> = Account::try_from(info)?;
            acc.claimable += cfg.base_reward * RANK_MULT[rank];
            acc.exit(ctx.program_id)?;
        }

        cfg.season += 1;
        cfg.season_end = now + cfg.season_duration;
        board.season = cfg.season;
        board.entries = [BoardEntry::default(); BOARD_SIZE];
        Ok(())
    }

    /// Mint all claimable $FUEL to the player's token account.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let amount = ctx.accounts.player.claimable;
        require!(amount > 0, PdrError::NothingToClaim);
        ctx.accounts.player.claimable = 0;

        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.player_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }

    /// PvP: open a duel with a $FUEL stake. `seed` doubles as the
    /// short join code shown in the game UI.
    pub fn create_duel(ctx: Context<CreateDuel>, seed: u32, stake: u64) -> Result<()> {
        require!(stake > 0, PdrError::BadParams);
        let duel = &mut ctx.accounts.duel;
        duel.seed = seed;
        duel.creator = ctx.accounts.authority.key();
        duel.opponent = Pubkey::default();
        duel.stake = stake;
        duel.creator_et_ms = 0;
        duel.opponent_et_ms = 0;
        duel.deadline = Clock::get()?.unix_timestamp + DUEL_TIMEOUT;
        duel.settled = false;
        duel.bump = ctx.bumps.duel;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            stake,
        )?;
        Ok(())
    }

    pub fn join_duel(ctx: Context<JoinDuel>) -> Result<()> {
        let duel = &mut ctx.accounts.duel;
        require!(duel.opponent == Pubkey::default(), PdrError::DuelFull);
        require!(!duel.settled, PdrError::DuelSettled);
        require!(
            Clock::get()?.unix_timestamp <= duel.deadline,
            PdrError::DuelExpired
        );
        require!(
            ctx.accounts.authority.key() != duel.creator,
            PdrError::SelfDuel
        );
        duel.opponent = ctx.accounts.authority.key();
        duel.deadline = Clock::get()?.unix_timestamp + DUEL_TIMEOUT;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.opponent_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            duel.stake,
        )?;
        Ok(())
    }

    /// Each participant submits their run once (lowest wins at settle).
    pub fn submit_duel_time(ctx: Context<SubmitDuelTime>, et_ms: u32) -> Result<()> {
        require!((MIN_ET_MS..=MAX_ET_MS).contains(&et_ms), PdrError::ImplausibleTime);
        let duel = &mut ctx.accounts.duel;
        require!(!duel.settled, PdrError::DuelSettled);
        let who = ctx.accounts.authority.key();
        if who == duel.creator {
            require!(duel.creator_et_ms == 0, PdrError::AlreadySubmitted);
            duel.creator_et_ms = et_ms;
        } else if who == duel.opponent {
            require!(duel.opponent_et_ms == 0, PdrError::AlreadySubmitted);
            duel.opponent_et_ms = et_ms;
        } else {
            return err!(PdrError::NotInDuel);
        }
        Ok(())
    }

    /// After both submitted (or deadline passed), pays the pot minus
    /// burned rake to the winner. Missing submission = loss; both
    /// missing or a tie = refund.
    pub fn settle_duel(ctx: Context<SettleDuel>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let duel = &ctx.accounts.duel;
        require!(!duel.settled, PdrError::DuelSettled);
        require!(duel.opponent != Pubkey::default(), PdrError::DuelNotJoined);
        let both = duel.creator_et_ms != 0 && duel.opponent_et_ms != 0;
        require!(both || now > duel.deadline, PdrError::DuelRunning);

        let c = if duel.creator_et_ms == 0 { u32::MAX } else { duel.creator_et_ms };
        let o = if duel.opponent_et_ms == 0 { u32::MAX } else { duel.opponent_et_ms };

        let pot = ctx.accounts.vault.amount;
        let seed_bytes = duel.seed.to_le_bytes();
        let seeds: &[&[u8]] = &[b"duel", duel.creator.as_ref(), &seed_bytes, &[duel.bump]];

        if c == o {
            // tie / double no-show: refund both sides, no rake
            let half = pot / 2;
            for (ata, amt) in [
                (&ctx.accounts.creator_ata, half),
                (&ctx.accounts.opponent_ata, pot - half),
            ] {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ata.to_account_info(),
                            authority: ctx.accounts.duel.to_account_info(),
                        },
                        &[seeds],
                    ),
                    amt,
                )?;
            }
        } else {
            let rake = pot * RAKE_BPS / 10_000;
            let winnings = pot - rake;
            let winner_ata = if c < o {
                &ctx.accounts.creator_ata
            } else {
                &ctx.accounts.opponent_ata
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: winner_ata.to_account_info(),
                        authority: ctx.accounts.duel.to_account_info(),
                    },
                    &[seeds],
                ),
                winnings,
            )?;
            if rake > 0 {
                token::burn(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.mint.to_account_info(),
                            from: ctx.accounts.vault.to_account_info(),
                            authority: ctx.accounts.duel.to_account_info(),
                        },
                        &[seeds],
                    ),
                    rake,
                )?;
            }
        }
        ctx.accounts.duel.settled = true;
        Ok(())
    }

    /// Ranked queue: wait for a rival. Your stake is escrowed in the
    /// queue vault until someone matches you (or you leave).
    pub fn queue_join(ctx: Context<QueueJoin>, stake: u64) -> Result<()> {
        require!(stake > 0, PdrError::BadParams);
        let player = &ctx.accounts.player;
        require!(player.active_match == Pubkey::default(), PdrError::InMatch);

        let queue = &mut ctx.accounts.queue;
        if queue.bump == 0 {
            queue.bump = ctx.bumps.queue;
        }
        let me = ctx.accounts.authority.key();
        require!(
            queue.slots.iter().all(|s| s.player != me),
            PdrError::AlreadyQueued
        );
        let slot = queue
            .slots
            .iter_mut()
            .find(|s| s.player == Pubkey::default())
            .ok_or(PdrError::QueueFull)?;
        *slot = QueueSlot {
            player: me,
            rp: player.rp,
            stake,
            ts: Clock::get()?.unix_timestamp,
        };

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_ata.to_account_info(),
                    to: ctx.accounts.qvault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            stake,
        )?;
        Ok(())
    }

    /// Ranked queue: match with the waiting player in `slot_index`.
    /// Only allowed inside the RP band (which widens while they wait);
    /// creates the match, escrows both stakes, links both profiles.
    pub fn queue_match(ctx: Context<QueueMatch>, slot_index: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let me = ctx.accounts.authority.key();
        let slot = {
            let queue = &ctx.accounts.queue;
            *queue
                .slots
                .get(slot_index as usize)
                .ok_or(PdrError::BadParams)?
        };
        require!(slot.player != Pubkey::default(), PdrError::SlotEmpty);
        require!(slot.player != me, PdrError::SelfDuel);
        require!(
            ctx.accounts.opp_player.wallet == slot.player,
            PdrError::RankAccountMismatch
        );
        require!(
            ctx.accounts.player.active_match == Pubkey::default()
                && ctx.accounts.opp_player.active_match == Pubkey::default(),
            PdrError::InMatch
        );

        // rating band check, widening with wait time
        let band = BASE_BAND + ((now - slot.ts).max(0) / 60) * BAND_PER_MIN;
        let diff = (ctx.accounts.player.rp as i64 - slot.rp as i64).abs();
        require!(diff <= band, PdrError::OutOfBand);

        // my stake in
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_ata.to_account_info(),
                    to: ctx.accounts.mvault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            slot.stake,
        )?;
        // their escrowed stake moves from the queue vault
        let qbump = ctx.accounts.queue.bump;
        let qseeds: &[&[u8]] = &[b"queue", &[qbump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.qvault.to_account_info(),
                    to: ctx.accounts.mvault.to_account_info(),
                    authority: ctx.accounts.queue.to_account_info(),
                },
                &[qseeds],
            ),
            slot.stake,
        )?;

        let m = &mut ctx.accounts.ranked_match;
        m.a = slot.player;
        m.b = me;
        m.stake = slot.stake;
        m.a_et_ms = 0;
        m.b_et_ms = 0;
        m.deadline = now + MATCH_TIMEOUT;
        m.settled = false;
        m.bump = ctx.bumps.ranked_match;

        let mkey = m.key();
        ctx.accounts.player.active_match = mkey;
        ctx.accounts.opp_player.active_match = mkey;

        let queue = &mut ctx.accounts.queue;
        queue.slots[slot_index as usize] = QueueSlot::default();
        Ok(())
    }

    /// Leave the queue and reclaim the escrowed stake.
    pub fn queue_leave(ctx: Context<QueueLeave>) -> Result<()> {
        let me = ctx.accounts.authority.key();
        let (idx, stake) = {
            let queue = &ctx.accounts.queue;
            let idx = queue
                .slots
                .iter()
                .position(|s| s.player == me)
                .ok_or(PdrError::NotQueued)?;
            (idx, queue.slots[idx].stake)
        };
        let qbump = ctx.accounts.queue.bump;
        let qseeds: &[&[u8]] = &[b"queue", &[qbump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.qvault.to_account_info(),
                    to: ctx.accounts.authority_ata.to_account_info(),
                    authority: ctx.accounts.queue.to_account_info(),
                },
                &[qseeds],
            ),
            stake,
        )?;
        ctx.accounts.queue.slots[idx] = QueueSlot::default();
        Ok(())
    }

    /// Each matched player submits their solo run once.
    pub fn submit_ranked_time(ctx: Context<SubmitRankedTime>, et_ms: u32) -> Result<()> {
        require!((MIN_ET_MS..=MAX_ET_MS).contains(&et_ms), PdrError::ImplausibleTime);
        let m = &mut ctx.accounts.ranked_match;
        require!(!m.settled, PdrError::DuelSettled);
        let who = ctx.accounts.authority.key();
        if who == m.a {
            require!(m.a_et_ms == 0, PdrError::AlreadySubmitted);
            m.a_et_ms = et_ms;
        } else if who == m.b {
            require!(m.b_et_ms == 0, PdrError::AlreadySubmitted);
            m.b_et_ms = et_ms;
        } else {
            return err!(PdrError::NotInDuel);
        }
        Ok(())
    }

    /// Settle a ranked match: pot minus burned rake to the winner and
    /// an on-chain Elo swing between both player profiles.
    pub fn settle_ranked(ctx: Context<SettleRanked>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &ctx.accounts.ranked_match;
        require!(!m.settled, PdrError::DuelSettled);
        let both = m.a_et_ms != 0 && m.b_et_ms != 0;
        require!(both || now > m.deadline, PdrError::DuelRunning);
        require!(
            ctx.accounts.player_a.wallet == m.a && ctx.accounts.player_b.wallet == m.b,
            PdrError::RankAccountMismatch
        );

        let a = if m.a_et_ms == 0 { u32::MAX } else { m.a_et_ms };
        let b = if m.b_et_ms == 0 { u32::MAX } else { m.b_et_ms };
        let pot = ctx.accounts.mvault.amount;
        let seeds: &[&[u8]] = &[
            b"match",
            m.a.as_ref(),
            m.b.as_ref(),
            &[m.bump],
        ];

        if a == b {
            // tie / double no-show: refund, no rating change
            let half = pot / 2;
            for (ata, amt) in [
                (&ctx.accounts.a_ata, half),
                (&ctx.accounts.b_ata, pot - half),
            ] {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.mvault.to_account_info(),
                            to: ata.to_account_info(),
                            authority: ctx.accounts.ranked_match.to_account_info(),
                        },
                        &[seeds],
                    ),
                    amt,
                )?;
            }
        } else {
            let a_wins = a < b;
            let rake = pot * RAKE_BPS / 10_000;
            let winnings = pot - rake;
            let winner_ata = if a_wins { &ctx.accounts.a_ata } else { &ctx.accounts.b_ata };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.mvault.to_account_info(),
                        to: winner_ata.to_account_info(),
                        authority: ctx.accounts.ranked_match.to_account_info(),
                    },
                    &[seeds],
                ),
                winnings,
            )?;
            if rake > 0 {
                token::burn(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.mint.to_account_info(),
                            from: ctx.accounts.mvault.to_account_info(),
                            authority: ctx.accounts.ranked_match.to_account_info(),
                        },
                        &[seeds],
                    ),
                    rake,
                )?;
            }
            // integer Elo: upsets pay more, capped swing
            let (winner, loser) = if a_wins {
                (&mut ctx.accounts.player_a, &mut ctx.accounts.player_b)
            } else {
                (&mut ctx.accounts.player_b, &mut ctx.accounts.player_a)
            };
            let diff = loser.rp as i64 - winner.rp as i64;
            let delta = (20 + diff / 10).clamp(8, 40) as u16;
            winner.rp = winner.rp.saturating_add(delta);
            loser.rp = loser.rp.saturating_sub(delta);
        }

        ctx.accounts.player_a.active_match = Pubkey::default();
        ctx.accounts.player_b.active_match = Pubkey::default();
        ctx.accounts.ranked_match.settled = true;
        Ok(())
    }

    /// Mints a car as a tradeable Metaplex NFT. The FUEL price is
    /// burned (deflationary sink); the NFT itself trades freely on any
    /// marketplace and unlocks the car model in-game for its holder.
    pub fn mint_car(ctx: Context<MintCar>, model: u8) -> Result<()> {
        require!((model as usize) < CAR_MODELS, PdrError::BadParams);
        let index = ctx.accounts.config.cars_minted[model as usize];
        let price = CAR_PRICES_FUEL[model as usize] * 1_000_000; // 6 decimals

        // pay: burn FUEL from the buyer
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.fuel_mint.to_account_info(),
                    from: ctx.accounts.buyer_fuel_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            price,
        )?;

        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];

        // mint the single edition to the buyer
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.car_mint.to_account_info(),
                    to: ctx.accounts.buyer_car_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )?;

        // Metaplex metadata + master edition = a real, tradeable NFT
        let name = format!("PDR {} #{}", CAR_NAMES[model as usize], index + 1);
        let uri = format!("{}{}.json", NFT_BASE_URI, model);
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.car_mint.to_account_info(),
                    mint_authority: ctx.accounts.config.to_account_info(),
                    update_authority: ctx.accounts.config.to_account_info(),
                    payer: ctx.accounts.buyer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[seeds],
            ),
            DataV2 {
                name,
                symbol: NFT_SYMBOL.to_string(),
                uri,
                seller_fee_basis_points: NFT_ROYALTY_BPS,
                creators: Some(vec![Creator {
                    address: ctx.accounts.config.key(),
                    verified: true,
                    share: 100,
                }]),
                collection: None,
                uses: None,
            },
            true, // is_mutable
            true, // update_authority_is_signer (config PDA signs)
            None,
        )?;
        create_master_edition_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMasterEditionV3 {
                    edition: ctx.accounts.master_edition.to_account_info(),
                    mint: ctx.accounts.car_mint.to_account_info(),
                    update_authority: ctx.accounts.config.to_account_info(),
                    mint_authority: ctx.accounts.config.to_account_info(),
                    payer: ctx.accounts.buyer.to_account_info(),
                    metadata: ctx.accounts.metadata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[seeds],
            ),
            Some(0), // max_supply 0 = 1/1, no prints
        )?;

        ctx.accounts.config.cars_minted[model as usize] = index + 1;
        Ok(())
    }

    /// Creator can reclaim the stake if nobody joined before the deadline.
    pub fn cancel_duel(ctx: Context<CancelDuel>) -> Result<()> {
        let duel = &ctx.accounts.duel;
        require!(!duel.settled, PdrError::DuelSettled);
        require!(duel.opponent == Pubkey::default(), PdrError::DuelFull);
        require!(
            Clock::get()?.unix_timestamp > duel.deadline,
            PdrError::DuelRunning
        );
        let seed_bytes = duel.seed.to_le_bytes();
        let seeds: &[&[u8]] = &[b"duel", duel.creator.as_ref(), &seed_bytes, &[duel.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator_ata.to_account_info(),
                    authority: ctx.accounts.duel.to_account_info(),
                },
                &[seeds],
            ),
            ctx.accounts.vault.amount,
        )?;
        ctx.accounts.duel.settled = true;
        Ok(())
    }
}

// ============================================================
// Accounts
// ============================================================

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub season: u16,
    pub season_duration: i64,
    pub season_end: i64,
    pub base_reward: u64,
    pub referral_bps: u16,
    pub cars_minted: [u32; CAR_MODELS],
    pub bump: u8,
}
impl Config {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 8 + 8 + 8 + 2 + 4 * CAR_MODELS + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq)]
pub struct BoardEntry {
    pub wallet: Pubkey,
    pub et_ms: u32,
    pub car: u8,
    pub ts: i64,
}
impl BoardEntry {
    pub const SIZE: usize = 32 + 4 + 1 + 8;
    /// empty slots sort last
    pub fn et_ms(&self) -> u32 {
        if self.wallet == Pubkey::default() {
            u32::MAX
        } else {
            self.et_ms
        }
    }
}

#[account]
pub struct SeasonBoard {
    pub season: u16,
    pub entries: [BoardEntry; BOARD_SIZE],
}
impl SeasonBoard {
    pub const SIZE: usize = 8 + 2 + BoardEntry::SIZE * BOARD_SIZE;
}

#[account]
pub struct Player {
    pub wallet: Pubkey,
    pub referrer: Option<Pubkey>,
    pub season: u16,
    pub best_et_ms: u32,
    pub races: u32,
    pub claimable: u64,
    pub referral_count: u32,
    pub referral_earned: u64,
    pub rp: u16,
    pub active_match: Pubkey,
    pub bump: u8,
}
impl Player {
    pub const SIZE: usize = 8 + 32 + 33 + 2 + 4 + 4 + 8 + 4 + 8 + 2 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq)]
pub struct QueueSlot {
    pub player: Pubkey,
    pub rp: u16,
    pub stake: u64,
    pub ts: i64,
}
impl QueueSlot {
    pub const SIZE: usize = 32 + 2 + 8 + 8;
}

#[account]
pub struct RankedQueue {
    pub slots: [QueueSlot; QUEUE_SIZE],
    pub bump: u8,
}
impl RankedQueue {
    pub const SIZE: usize = 8 + QueueSlot::SIZE * QUEUE_SIZE + 1;
}

#[account]
pub struct RankedMatch {
    pub a: Pubkey,
    pub b: Pubkey,
    pub stake: u64,
    pub a_et_ms: u32,
    pub b_et_ms: u32,
    pub deadline: i64,
    pub settled: bool,
    pub bump: u8,
}
impl RankedMatch {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 4 + 4 + 8 + 1 + 1;
}

#[account]
pub struct Duel {
    pub seed: u32,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    pub stake: u64,
    pub creator_et_ms: u32,
    pub opponent_et_ms: u32,
    pub deadline: i64,
    pub settled: bool,
    pub bump: u8,
}
impl Duel {
    pub const SIZE: usize = 8 + 4 + 32 + 32 + 8 + 4 + 4 + 8 + 1 + 1;
}

// ============================================================
// Instruction contexts
// ============================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SIZE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = config,
        seeds = [b"fuel"],
        bump
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = SeasonBoard::SIZE,
        seeds = [b"season", 0u16.to_le_bytes().as_ref()],
        bump
    )]
    pub board: Account<'info, SeasonBoard>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = Player::SIZE,
        seeds = [b"player", authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    /// referrer's Player PDA — required when a referrer is given
    #[account(mut)]
    pub referrer_player: Option<Account<'info, Player>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitTime<'info> {
    pub authority: Signer<'info>,
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"player", authority.key().as_ref()],
        bump = player.bump,
        constraint = player.wallet == authority.key() @ PdrError::NotYourProfile
    )]
    pub player: Account<'info, Player>,
    #[account(
        mut,
        seeds = [b"season", config.season.to_le_bytes().as_ref()],
        bump
    )]
    pub board: Account<'info, SeasonBoard>,
    /// referrer's Player PDA (pass when the player has a referrer so
    /// the referral cut can be credited)
    #[account(mut)]
    pub referrer_player: Option<Account<'info, Player>>,
}

#[derive(Accounts)]
pub struct EndSeason<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"season", config.season.to_le_bytes().as_ref()],
        bump
    )]
    pub board: Account<'info, SeasonBoard>,
    // remaining_accounts: the 16 Player PDAs in board order
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"player", authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = authority
    )]
    pub player_ata: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(seed: u32)]
pub struct CreateDuel<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = Duel::SIZE,
        seeds = [b"duel", authority.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump
    )]
    pub duel: Account<'info, Duel>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = duel,
        seeds = [b"vault", duel.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = creator_ata.owner == authority.key())]
    pub creator_ata: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct QueueJoin<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"player", authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    #[account(
        init_if_needed,
        payer = authority,
        space = RankedQueue::SIZE,
        seeds = [b"queue"],
        bump
    )]
    pub queue: Account<'info, RankedQueue>,
    #[account(
        init_if_needed,
        payer = authority,
        token::mint = mint,
        token::authority = queue,
        seeds = [b"qvault"],
        bump
    )]
    pub qvault: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_ata.owner == authority.key() @ PdrError::WrongAta)]
    pub authority_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct QueueMatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"player", authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub opp_player: Account<'info, Player>,
    #[account(mut, seeds = [b"queue"], bump = queue.bump)]
    pub queue: Account<'info, RankedQueue>,
    #[account(mut, seeds = [b"qvault"], bump)]
    pub qvault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        space = RankedMatch::SIZE,
        seeds = [b"match", opp_player.wallet.as_ref(), authority.key().as_ref()],
        bump
    )]
    pub ranked_match: Account<'info, RankedMatch>,
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = ranked_match,
        seeds = [b"mvault", ranked_match.key().as_ref()],
        bump
    )]
    pub mvault: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_ata.owner == authority.key() @ PdrError::WrongAta)]
    pub authority_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct QueueLeave<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"queue"], bump = queue.bump)]
    pub queue: Account<'info, RankedQueue>,
    #[account(mut, seeds = [b"qvault"], bump)]
    pub qvault: Account<'info, TokenAccount>,
    #[account(mut, constraint = authority_ata.owner == authority.key() @ PdrError::WrongAta)]
    pub authority_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SubmitRankedTime<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub ranked_match: Account<'info, RankedMatch>,
}

#[derive(Accounts)]
pub struct SettleRanked<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"match", ranked_match.a.as_ref(), ranked_match.b.as_ref()],
        bump = ranked_match.bump
    )]
    pub ranked_match: Account<'info, RankedMatch>,
    #[account(mut, seeds = [b"mvault", ranked_match.key().as_ref()], bump)]
    pub mvault: Account<'info, TokenAccount>,
    #[account(mut, constraint = a_ata.owner == ranked_match.a @ PdrError::WrongAta)]
    pub a_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = b_ata.owner == ranked_match.b @ PdrError::WrongAta)]
    pub b_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub player_a: Account<'info, Player>,
    #[account(mut)]
    pub player_b: Account<'info, Player>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(model: u8)]
pub struct MintCar<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, address = config.mint)]
    pub fuel_mint: Account<'info, Mint>,
    #[account(mut, constraint = buyer_fuel_ata.owner == buyer.key() @ PdrError::WrongAta)]
    pub buyer_fuel_ata: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = config,
        mint::freeze_authority = config,
        seeds = [
            b"carmint".as_ref(),
            &[model],
            config.cars_minted[model as usize].to_le_bytes().as_ref()
        ],
        bump
    )]
    pub car_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = car_mint,
        associated_token::authority = buyer
    )]
    pub buyer_car_ata: Account<'info, TokenAccount>,
    /// CHECK: verified by the token metadata program CPI
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: verified by the token metadata program CPI
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinDuel<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"vault", duel.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = opponent_ata.owner == authority.key())]
    pub opponent_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SubmitDuelTime<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub duel: Account<'info, Duel>,
}

#[derive(Accounts)]
pub struct SettleDuel<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, address = config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"vault", duel.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = creator_ata.owner == duel.creator @ PdrError::WrongAta)]
    pub creator_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = opponent_ata.owner == duel.opponent @ PdrError::WrongAta)]
    pub opponent_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelDuel<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, constraint = duel.creator == authority.key() @ PdrError::NotInDuel)]
    pub duel: Account<'info, Duel>,
    #[account(mut, seeds = [b"vault", duel.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = creator_ata.owner == authority.key())]
    pub creator_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ============================================================
// Errors
// ============================================================

#[error_code]
pub enum PdrError {
    #[msg("bad params")]
    BadParams,
    #[msg("you cannot refer yourself")]
    SelfReferral,
    #[msg("referrer player account missing")]
    MissingReferrerAccount,
    #[msg("referrer account mismatch")]
    ReferrerMismatch,
    #[msg("implausible race time")]
    ImplausibleTime,
    #[msg("season is over - call end_season")]
    SeasonOver,
    #[msg("season still running")]
    SeasonRunning,
    #[msg("board does not match current season")]
    WrongBoard,
    #[msg("missing rank account")]
    MissingRankAccount,
    #[msg("rank account mismatch")]
    RankAccountMismatch,
    #[msg("nothing to claim")]
    NothingToClaim,
    #[msg("not your profile")]
    NotYourProfile,
    #[msg("duel already has an opponent")]
    DuelFull,
    #[msg("duel already settled")]
    DuelSettled,
    #[msg("duel expired")]
    DuelExpired,
    #[msg("you cannot duel yourself")]
    SelfDuel,
    #[msg("already submitted")]
    AlreadySubmitted,
    #[msg("you are not in this duel")]
    NotInDuel,
    #[msg("duel still running")]
    DuelRunning,
    #[msg("duel has no opponent yet")]
    DuelNotJoined,
    #[msg("wrong token account")]
    WrongAta,
    #[msg("ranked queue is full")]
    QueueFull,
    #[msg("already waiting in the queue")]
    AlreadyQueued,
    #[msg("you are not in the queue")]
    NotQueued,
    #[msg("queue slot is empty")]
    SlotEmpty,
    #[msg("outside the rating band")]
    OutOfBand,
    #[msg("finish your active match first")]
    InMatch,
}
