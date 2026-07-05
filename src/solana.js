// ============================================================
// Solana integration — Mobile Wallet Adapter (Seeker / Saga)
// Connects the native wallet and posts race records on-chain
// as Memo-program transactions. Android-only at runtime; on
// other platforms the game hides these features gracefully.
// ============================================================

import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';

// Switch to 'mainnet-beta' + a mainnet RPC for the store release.
export const CLUSTER = 'devnet';
const RPC_URL = 'https://api.devnet.solana.com';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const APP_IDENTITY = {
  name: 'Pixel Drag Racer',
  uri: 'https://github.com/3DAGI/hello-3dagi',
  icon: 'favicon.ico',
};

// Mobile Wallet Adapter needs an Android environment with an
// MWA-compatible wallet app installed (Seeker ships one).
export const mwaSupported =
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

export const sol = {
  connected: false,
  address: '',       // base58
  shortAddress: '',
  busy: false,
  lastSig: '',
  error: '',
};

let authToken = null;
let publicKey = null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function authorize(wallet) {
  const auth = authToken
    ? await wallet.reauthorize({ auth_token: authToken, identity: APP_IDENTITY })
    : await wallet.authorize({ cluster: CLUSTER, identity: APP_IDENTITY });
  authToken = auth.auth_token;
  publicKey = new PublicKey(b64ToBytes(auth.accounts[0].address));
  sol.connected = true;
  sol.address = publicKey.toBase58();
  sol.shortAddress = sol.address.slice(0, 4) + '..' + sol.address.slice(-4);
  return publicKey;
}

export async function connectWallet() {
  if (!mwaSupported || sol.busy) return false;
  sol.busy = true;
  sol.error = '';
  try {
    await transact(async (wallet) => authorize(wallet));
    return true;
  } catch (e) {
    sol.error = walletError(e);
    return false;
  } finally {
    sol.busy = false;
  }
}

export function disconnectWallet() {
  authToken = null;
  publicKey = null;
  sol.connected = false;
  sol.address = '';
  sol.shortAddress = '';
  sol.lastSig = '';
  sol.error = '';
}

export function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

export function getPublicKey() {
  return publicKey;
}

// Signs and sends a transaction built from arbitrary instructions via
// the mobile wallet. Returns the signature or '' (sol.error set).
export async function sendIxs(instructions) {
  if (!mwaSupported || sol.busy) return '';
  sol.busy = true;
  sol.error = '';
  try {
    const connection = getConnection();
    const { blockhash } = await connection.getLatestBlockhash();
    const sig = await transact(async (wallet) => {
      const payer = await authorize(wallet);
      const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
      for (const ix of instructions) tx.add(ix);
      const sigs = await wallet.signAndSendTransactions({ transactions: [tx] });
      return sigs[0];
    });
    sol.lastSig = sig;
    return sig;
  } catch (e) {
    sol.error = walletError(e);
    return '';
  } finally {
    sol.busy = false;
  }
}

// Posts a JSON race record via the Memo program and returns the tx
// signature, or '' on failure (sol.error is set).
export async function postRecord(record) {
  if (!mwaSupported || sol.busy) return '';
  sol.busy = true;
  sol.error = '';
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const { blockhash } = await connection.getLatestBlockhash();
    const sig = await transact(async (wallet) => {
      const payer = await authorize(wallet);
      const tx = new Transaction({
        feePayer: payer,
        recentBlockhash: blockhash,
      }).add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(JSON.stringify(record), 'utf8'),
        })
      );
      const sigs = await wallet.signAndSendTransactions({ transactions: [tx] });
      return sigs[0];
    });
    sol.lastSig = sig;
    return sig;
  } catch (e) {
    sol.error = walletError(e);
    return '';
  } finally {
    sol.busy = false;
  }
}

function walletError(e) {
  const msg = (e && e.message) || String(e);
  if (/cancelled|declined|rejected/i.test(msg)) return 'REQUEST DECLINED';
  if (/no.*wallet|association|ACTIVITY_NOT_FOUND/i.test(msg)) return 'NO SOLANA WALLET FOUND';
  return 'WALLET ERROR';
}
