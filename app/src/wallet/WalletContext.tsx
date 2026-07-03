import { ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { RPC_ENDPOINT } from '../config';

import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * Wallet support:
 * - Phantom & Solflare via their explicit adapters (desktop extension + in-app browser).
 * - Seed Vault on Solana Seeker/Saga: the Mobile Wallet Adapter is registered
 *   automatically by @solana/wallet-adapter-react when running on Android,
 *   and any other Wallet-Standard wallet is picked up automatically too.
 */
export function SolanaWalletContext({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
