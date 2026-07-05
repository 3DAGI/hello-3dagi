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
    pub bump: u8,
}
impl Config {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 8 + 8 + 8 + 2 + 1;
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
    pub bump: u8,
}
impl Player {
    pub const SIZE: usize = 8 + 32 + 33 + 2 + 4 + 4 + 8 + 4 + 8 + 1;
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
}
