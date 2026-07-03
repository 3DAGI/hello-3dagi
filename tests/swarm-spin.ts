import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assert } from 'chai';

/**
 * Anchor integration tests — run with a local validator:
 *   anchor test
 */
describe('swarm-spin', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SwarmSpin as Program;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    program.programId
  );
  const rewardMint = Keypair.generate();

  const initParams = {
    scoreAuthority: PublicKey.default, // dev mode: no attestation
    baseReward: new anchor.BN(10_000), // 0.01 HONEY / point
    maxScorePerRun: new anchor.BN(5_000),
    cooldownSecs: new anchor.BN(0), // no cooldown in tests
    playerDailyCap: new anchor.BN(500_000_000),
    epochEmissionCap: new anchor.BN(1_111_111_000_000),
    halvingPeriod: new anchor.BN(15_552_000),
    maxEmission: new anchor.BN(400_000_000_000_000),
    continueCost: new anchor.BN(25_000_000),
    minStakeLockSecs: new anchor.BN(0),
  };

  it('initializes the game config and mint', async () => {
    await program.methods
      .initialize(initParams)
      .accounts({
        config: configPda,
        rewardMint: rewardMint.publicKey,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([rewardMint])
      .rpc();

    const cfg: any = await (program.account as any).config.fetch(configPda);
    assert.ok(cfg.admin.equals(provider.wallet.publicKey));
    assert.equal(cfg.totalEmitted.toNumber(), 0);
  });

  it('registers a player and submits a score', async () => {
    const owner = provider.wallet.publicKey;
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), owner.toBuffer()],
      program.programId
    );

    await program.methods
      .registerPlayer()
      .accounts({ player: playerPda, owner, systemProgram: SystemProgram.programId })
      .rpc();

    await program.methods
      .submitScore(new anchor.BN(100))
      .accounts({
        config: configPda,
        player: playerPda,
        owner,
        rewardMint: rewardMint.publicKey,
        scoreAuthority: null,
      })
      .rpc();

    const player: any = await (program.account as any).player.fetch(playerPda);
    // 100 points * 10_000 base units = 1 HONEY
    assert.equal(player.totalEarned.toNumber(), 1_000_000);
    assert.equal(player.bestScore.toNumber(), 100);
  });

  it('rejects scores above the per-run cap', async () => {
    const owner = provider.wallet.publicKey;
    const [playerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('player'), owner.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .submitScore(new anchor.BN(1_000_000))
        .accounts({
          config: configPda,
          player: playerPda,
          owner,
          rewardMint: rewardMint.publicKey,
          scoreAuthority: null,
        })
        .rpc();
      assert.fail('expected ScoreTooHigh');
    } catch (e: any) {
      assert.include(String(e), 'ScoreTooHigh');
    }
  });
});
