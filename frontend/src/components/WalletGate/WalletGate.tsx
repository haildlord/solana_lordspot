import type { ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import styles from './WalletGate.module.css';

interface WalletGateProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** Gates page content behind a connect-wallet prompt — reused across Home/Tickets/Winnings. */
export function WalletGate({ title, description, children }: WalletGateProps) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected) return <>{children}</>;

  return (
    <div className={styles.wrap}>
      <div className={styles.icon}>🔐</div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      <button className={styles.button} onClick={() => setVisible(true)}>
        Connect Wallet
      </button>
    </div>
  );
}
