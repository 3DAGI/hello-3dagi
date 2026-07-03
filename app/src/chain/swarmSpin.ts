import { sha256 } from '@noble/hashes/sha256';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Connection,
} from '@solana/web3.js';
import { PROGRAM_ID as PROGRAM_ID_STR } from '../config';

/**
 * Minimal client for the swarm-spin Anchor program (see /programs/swarm-spin).
 * Instructions are built by hand (Anchor discriminator = first 8 bytes of
 * sha256("global:<ix_name>")) so the app doesn't need the full Anchor SDK.
 */

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function discriminator(name: string): Buffer {
  return Buffer.from(sha256(`global:${name}`)).subarray(0, 8);
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
}

export function playerPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('player'), owner.toBuffer()], PROGRAM_ID)[0];
}

export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

export function registerPlayerIx(owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: playerPda(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('register_player'),
  });
}

export function submitScoreIx(
  owner: PublicKey,
  rewardMint: PublicKey,
  score: bigint
): TransactionInstruction {
  const config = configPda();
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: playerPda(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: rewardMint, isSigner: false, isWritable: true },
      { pubkey: ata(owner, rewardMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('submit_score'), u64le(score)]),
  });
}

export function buyContinueIx(owner: PublicKey, rewardMint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: playerPda(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: rewardMint, isSigner: false, isWritable: true },
      { pubkey: ata(owner, rewardMint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator('buy_continue'),
  });
}

/** Reads the reward mint out of the on-chain Config account (offset per state layout). */
export async function fetchRewardMint(connection: Connection): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(configPda());
  if (!info) return null;
  // Config layout: 8 (discriminator) + 32 (admin) + 32 (score_authority) → reward_mint
  return new PublicKey(info.data.subarray(72, 104));
}

export async function playerRegistered(connection: Connection, owner: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(playerPda(owner))) !== null;
}

/** Claim pending points as HONEY: registers the player if needed, then submits the score. */
export async function buildClaimTransaction(
  connection: Connection,
  owner: PublicKey,
  points: bigint
): Promise<Transaction> {
  const rewardMint = await fetchRewardMint(connection);
  if (!rewardMint) throw new Error('Program not initialized on this cluster');
  const tx = new Transaction();
  if (!(await playerRegistered(connection, owner))) {
    tx.add(registerPlayerIx(owner));
  }
  tx.add(submitScoreIx(owner, rewardMint, points));
  return tx;
}
