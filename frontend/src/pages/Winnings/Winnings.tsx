import { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useClaimSummary, useRequestClaimVoucher } from '../../api/hooks';
import { submitClaimVoucher } from '../../solana/claimVoucher';
import { formatUsdc } from '../../lib/format';
import { WalletGate } from '../../components/WalletGate/WalletGate';
import { TransactionOverlay, type TxState } from '../../components/TransactionOverlay/TransactionOverlay';
import { CoinLoader } from '../../components/CoinLoader/CoinLoader';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import styles from './Winnings.module.css';

export function Winnings() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { data: summary, isLoading } = useClaimSummary();
  const requestVoucher = useRequestClaimVoucher();

  const [txState, setTxState] = useState<TxState>('idle');
  const [message, setMessage] = useState('');

  const claimable = summary ? Number(summary.claimableUsdc) : 0;

  async function handleClaim() {
    setTxState('loading');
    setMessage('');
    try {
      const voucher = await requestVoucher.mutateAsync();

      if (!voucher.transactionBase64) {
        // A voucher is already live from an earlier request but we no longer
        // hold its raw bytes to re-sign — the backend never re-issues a
        // second live voucher (that's the whole point: one at a time,
        // per-wallet, so two vouchers can never double-pay). It resolves on
        // its own within about a minute either way.
        setMessage('A claim is already in flight for this wallet — check your wallet for a pending signature, or wait about a minute and try again.');
        setTxState('idle');
        return;
      }

      const signature = await submitClaimVoucher(connection, wallet, voucher.transactionBase64);
      await connection.confirmTransaction(signature, 'confirmed');
      setTxState('success');
    } catch (err) {
      console.error('Claim failed:', err);
      setMessage(err instanceof Error ? err.message : 'Claim failed');
      setTxState('error');
    } finally {
      setTimeout(() => setTxState('idle'), 2800);
    }
  }

  return (
    <div className={styles.page}>
      <TransactionOverlay
        state={txState}
        loadingText="SIGN IN YOUR WALLET..."
        successText="CLAIM SUBMITTED"
        errorText={message || 'CLAIM FAILED'}
      />

      <h2 className={styles.title}>Winnings</h2>

      <WalletGate
        title="Connect to view winnings"
        description="Check what's claimable and pull it straight to your wallet."
      >
        {/* {isLoading && (
          <div className={styles.loading}> // -> remove loading css from here
            <CoinLoader size="md" />
          </div>
        )} */}

        {!isLoading && summary && (
          <>
            <div className={styles.availableCard}>
              <div className={styles.row}>
                <div>
                  <p className={styles.label}>Winnings</p>
                  <p className={styles.value}>{formatUsdc(summary.claimableUsdc)}</p>
                </div>
                <button
                  className={styles.claimButton}
                  disabled={claimable <= 0 || txState !== 'idle'}
                  onClick={handleClaim}
                >
                  Claim
                </button>
              </div>

              {summary.freeTickets > 0 && (
                <div className={styles.row}>
                  <div>
                    <p className={styles.label}>Free tickets</p>
                    <p className={styles.valueSecondary}>{summary.freeTickets}</p>
                  </div>
                  <button className={styles.playFreeButton} disabled title="Paid out with your Winnings above for now — redeeming as a free ticket is coming in a future update">
                    Included in Claim
                  </button>
                </div>
              )}
            </div>

            {message && txState === 'idle' && <p className={styles.notice}>{message}</p>}

            {summary.pendingVoucher && (
              <div className={styles.pendingNotice}>
                A claim for {formatUsdc(summary.pendingVoucher.amountUsdc)} is pending confirmation on-chain.
              </div>
            )}

            <div className={styles.paidSection}>
              <p className={styles.paidLabel}>Total claimed all-time</p>
              <p className={styles.paidValue}>{formatUsdc(summary.totalPaidOutUsdc)}</p>
            </div>

            {claimable <= 0 && summary.freeTickets === 0 && (
              <EmptyState
                icon="💰"
                title="Nothing to claim yet"
                description="Winning tickets show up here once a drawing settles and your prize has been pulled into the payout vault."
              />
            )}
          </>
        )}
      </WalletGate>
    </div>
  );
}
