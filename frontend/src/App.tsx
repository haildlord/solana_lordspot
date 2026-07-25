import { useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';

import { queryClient } from './lib/queryClient';
import { HELIUS_RPC_URL } from './solana/constants';
import { Navbar } from './components/Navbar/Navbar';
import { ParticleField } from './components/ParticleField/ParticleField';
import { Home } from './pages/Home/Home';
import { Tickets } from './pages/Tickets/Tickets';
import { Winnings } from './pages/Winnings/Winnings';
import { Results } from './pages/Results/Results';
import styles from './App.module.css';

export function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={HELIUS_RPC_URL}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <BrowserRouter>
              <div className={styles.shell}>
                <ParticleField />
                <div className={styles.ambientOrbTop} aria-hidden="true" />
                <div className={styles.ambientOrbBottom} aria-hidden="true" />

                <Navbar />

                <main className={styles.main}>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/tickets" element={<Tickets />} />
                    <Route path="/winnings" element={<Winnings />} />
                    <Route path="/results" element={<Results />} />
                  </Routes>
                </main>
              </div>
            </BrowserRouter>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
