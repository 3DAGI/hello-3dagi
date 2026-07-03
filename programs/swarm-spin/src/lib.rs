use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"); // replace with deployed program id

/// SWARM Spin — on-chain game economy for the HONEY token.
///
/// Economic invariants enforced here (see TOKENOMICS.md):
/// * Hard cap on play-to-earn emissions (`max_emission`), tracked in `total_emitted`.
/// * Emissions halve every `halving_period` seconds (Bitcoin-style decay).
/// * Per-epoch (daily) global emission cap, also subject to halving.
/// * Per-player daily earn cap + submission cooldown + max score sanity cap.
/// * Continues are paid by burning HONEY — a hard token sink.
/// * Staking locks HONEY for a reward multiplier (tiered, up to 2x).
/// * Optional `score_authority` co-signer so a game backend can attest scores.
#[program]
pub mod swarm_spin {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: InitParams) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.score_authority = params.score_authority;
        cfg.reward_mint = ctx.accounts.reward_mint.key();
        cfg.genesis_ts = Clock::get()?.unix_timestamp;
        cfg.base_reward = params.base_reward;
        cfg.max_score_per_run = params.max_score_per_run;
        cfg.cooldown_secs = params.cooldown_secs;
        cfg.player_daily_cap = params.player_daily_cap;
        cfg.epoch_emission_cap = params.epoch_emission_cap;
        cfg.halving_period = params.halving_period;
        cfg.max_emission = params.max_emission;
        cfg.continue_cost = params.continue_cost;
        cfg.min_stake_lock_secs = params.min_stake_lock_secs;
        cfg.total_emitted = 0;
        cfg.total_burned = 0;
        cfg.current_epoch = 0;
        cfg.epoch_minted = 0;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn register_player(ctx: Context<RegisterPlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.owner = ctx.accounts.owner.key();
        player.bump = ctx.bumps.player;
        Ok(())
    }

    /// Settle a run: converts score into HONEY within all emission limits.
    /// If `config.score_authority` is set (non-default), that key must co-sign,
    /// allowing a backend to attest that the score is legitimate.
    pub fn submit_score(ctx: Context<SubmitScore>, score: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let cfg = &mut ctx.accounts.config;
        let player = &mut ctx.accounts.player;

        // Score attestation (anti-cheat) when a score authority is configured.
        if cfg.score_authority != Pubkey::default() {
            let attested = ctx
                .accounts
                .score_authority
                .as_ref()
                .map(|a| a.key() == cfg.score_authority && a.is_signer)
                .unwrap_or(false);
            require!(attested, GameError::MissingScoreAuthority);
        }

        require!(score > 0, GameError::ZeroScore);
        require!(score <= cfg.max_score_per_run, GameError::ScoreTooHigh);
        require!(
            now - player.last_submit_ts >= cfg.cooldown_secs,
            GameError::CooldownActive
        );

        // Halving factor: emissions halve every `halving_period` seconds.
        let halvings = ((now - cfg.genesis_ts) / cfg.halving_period).min(32) as u32;
        let base = (score as u128) * (cfg.base_reward as u128);
        let mut reward = (base >> halvings) as u64;

        // Staking multiplier (basis points, 10_000 = 1x).
        let mult_bps = stake_multiplier_bps(player.staked);
        reward = ((reward as u128) * (mult_bps as u128) / 10_000) as u64;

        // Per-player daily cap.
        let day = (now / 86_400) as u32;
        if player.day != day {
            player.day = day;
            player.minted_today = 0;
        }
        let daily_cap = cfg.player_daily_cap >> halvings;
        reward = reward.min(daily_cap.saturating_sub(player.minted_today));

        // Global per-epoch (daily) cap, halved on the same schedule.
        let epoch = ((now - cfg.genesis_ts) / 86_400) as u64;
        if cfg.current_epoch != epoch {
            cfg.current_epoch = epoch;
            cfg.epoch_minted = 0;
        }
        let epoch_cap = cfg.epoch_emission_cap >> halvings;
        reward = reward.min(epoch_cap.saturating_sub(cfg.epoch_minted));

        // Lifetime emission hard cap.
        reward = reward.min(cfg.max_emission.saturating_sub(cfg.total_emitted));
        require!(reward > 0, GameError::EmissionExhausted);

        player.last_submit_ts = now;
        player.minted_today += reward;
        player.total_earned += reward;
        player.best_score = player.best_score.max(score);
        cfg.epoch_minted += reward;
        cfg.total_emitted += reward;

        let bump = cfg.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    to: ctx.accounts.player_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            reward,
        )?;

        emit!(ScoreSubmitted {
            player: player.owner,
            score,
            reward,
            halvings,
        });
        Ok(())
    }

    /// Burn HONEY for an extra life. 100% of the cost is burned (hard sink).
    pub fn buy_continue(ctx: Context<BuyContinue>) -> Result<()> {
        let cost = ctx.accounts.config.continue_cost;
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.reward_mint.to_account_info(),
                    from: ctx.accounts.player_token.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            cost,
        )?;
        let cfg = &mut ctx.accounts.config;
        cfg.total_burned += cost;
        let player = &mut ctx.accounts.player;
        player.continues_bought += 1;

        emit!(ContinueBought { player: player.owner, cost });
        Ok(())
    }

    /// Lock HONEY in the staking vault for a reward multiplier.
    pub fn stake(ctx: Context<StakeCtx>, amount: u64) -> Result<()> {
        require!(amount > 0, GameError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.player_token.to_account_info(),
                    to: ctx.accounts.vault_token.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;
        let now = Clock::get()?.unix_timestamp;
        let player = &mut ctx.accounts.player;
        player.staked += amount;
        player.stake_locked_until = now + ctx.accounts.config.min_stake_lock_secs;

        emit!(Staked { player: player.owner, amount, total: player.staked });
        Ok(())
    }

    pub fn unstake(ctx: Context<StakeCtx>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let player = &mut ctx.accounts.player;
        require!(now >= player.stake_locked_until, GameError::StakeLocked);
        require!(amount > 0 && amount <= player.staked, GameError::ZeroAmount);
        player.staked -= amount;

        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token.to_account_info(),
                    to: ctx.accounts.player_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        emit!(Unstaked { player: ctx.accounts.player.owner, amount });
        Ok(())
    }
}

/// Staking tiers (HONEY has 6 decimals):
/// Worker ≥ 1k → 1.10x · Guard ≥ 10k → 1.25x · Court ≥ 100k → 1.50x · Queen ≥ 1M → 2.00x
fn stake_multiplier_bps(staked: u64) -> u64 {
    const ONE: u64 = 1_000_000; // 1 HONEY in base units
    match staked {
        s if s >= 1_000_000 * ONE => 20_000,
        s if s >= 100_000 * ONE => 15_000,
        s if s >= 10_000 * ONE => 12_500,
        s if s >= 1_000 * ONE => 11_000,
        _ => 10_000,
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitParams {
    /// Backend key that must co-sign score submissions; Pubkey::default() disables attestation (dev mode).
    pub score_authority: Pubkey,
    /// HONEY base units minted per score point (pre-halving, pre-multiplier).
    pub base_reward: u64,
    pub max_score_per_run: u64,
    pub cooldown_secs: i64,
    /// Per-player daily emission cap in base units (halves with the schedule).
    pub player_daily_cap: u64,
    /// Global daily emission cap in base units (halves with the schedule).
    pub epoch_emission_cap: u64,
    /// Seconds between emission halvings (e.g. 180 days = 15_552_000).
    pub halving_period: i64,
    /// Lifetime play-to-earn emission hard cap in base units.
    pub max_emission: u64,
    /// HONEY base units burned per continue.
    pub continue_cost: u64,
    pub min_stake_lock_secs: i64,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub score_authority: Pubkey,
    pub reward_mint: Pubkey,
    pub genesis_ts: i64,
    pub base_reward: u64,
    pub max_score_per_run: u64,
    pub cooldown_secs: i64,
    pub player_daily_cap: u64,
    pub epoch_emission_cap: u64,
    pub halving_period: i64,
    pub max_emission: u64,
    pub continue_cost: u64,
    pub min_stake_lock_secs: i64,
    pub total_emitted: u64,
    pub total_burned: u64,
    pub current_epoch: u64,
    pub epoch_minted: u64,
    pub bump: u8,
}

impl Config {
    pub const SIZE: usize = 8 + 32 * 3 + 8 * 13 + 1;
}

#[account]
pub struct Player {
    pub owner: Pubkey,
    pub staked: u64,
    pub stake_locked_until: i64,
    pub last_submit_ts: i64,
    pub day: u32,
    pub minted_today: u64,
    pub continues_bought: u32,
    pub total_earned: u64,
    pub best_score: u64,
    pub bump: u8,
}

impl Player {
    pub const SIZE: usize = 8 + 32 + 8 * 6 + 4 * 2 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = Config::SIZE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// Reward mint; its mint authority must be (or be transferred to) the config PDA.
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = config,
    )]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterPlayer<'info> {
    #[account(init, payer = owner, space = Player::SIZE, seeds = [b"player", owner.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitScore<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = reward_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub reward_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = owner,
    )]
    pub player_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    /// Optional backend co-signer, required when config.score_authority is set.
    pub score_authority: Option<Signer<'info>>,
}

#[derive(Accounts)]
pub struct BuyContinue<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = reward_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub owner: Signer<'info>,
    #[account(mut)]
    pub reward_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = reward_mint, associated_token::authority = owner)]
    pub player_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeCtx<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = reward_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub reward_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = reward_mint, associated_token::authority = owner)]
    pub player_token: Account<'info, TokenAccount>,
    /// Staking vault: the config PDA's associated token account.
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = reward_mint,
        associated_token::authority = config,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct ScoreSubmitted {
    pub player: Pubkey,
    pub score: u64,
    pub reward: u64,
    pub halvings: u32,
}

#[event]
pub struct ContinueBought {
    pub player: Pubkey,
    pub cost: u64,
}

#[event]
pub struct Staked {
    pub player: Pubkey,
    pub amount: u64,
    pub total: u64,
}

#[event]
pub struct Unstaked {
    pub player: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum GameError {
    #[msg("score must be greater than zero")]
    ZeroScore,
    #[msg("score exceeds the per-run maximum")]
    ScoreTooHigh,
    #[msg("submission cooldown still active")]
    CooldownActive,
    #[msg("score authority signature required")]
    MissingScoreAuthority,
    #[msg("emission caps exhausted — try again later")]
    EmissionExhausted,
    #[msg("amount must be greater than zero and within balance")]
    ZeroAmount,
    #[msg("stake is still locked")]
    StakeLocked,
}
