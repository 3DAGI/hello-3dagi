import { clusterApiUrl } from '@solana/web3.js';

/**
 * Chain configuration.
 *
 * The game is fully playable without a deployed program ("demo mode"):
 * earned HONEY accrues locally as a pending balance. Once the swarm-spin
 * program is deployed (see /programs and the root README), set
 * PROGRAM_ID to the deployed address and ONCHAIN_ENABLED to true — the
 * "Claim" button then mints real SPL tokens via the program.
 */
export const NETWORK: 'devnet' | 'mainnet-beta' = 'devnet';
export const RPC_ENDPOINT = clusterApiUrl(NETWORK);

export const ONCHAIN_ENABLED = false;
export const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS'; // replace after deploy

/** HONEY has 6 decimals; 1 game point = 0.01 HONEY (matches program config). */
export const HONEY_DECIMALS = 6;
export const HONEY_PER_POINT = 0.01;

/** Escalating continue cost in HONEY, matching the on-chain base cost. */
export const CONTINUE_BASE_COST = 25;
