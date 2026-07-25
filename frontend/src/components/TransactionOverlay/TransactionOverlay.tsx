import { CoinLoader } from '../CoinLoader/CoinLoader';
import styles from './TransactionOverlay.module.css';

export type TxState = 'idle' | 'loading' | 'success' | 'error';

interface TransactionOverlayProps {
  state: TxState;
  loadingText?: string;
  successText?: string;
  errorText?: string;
}

/** Full-screen modal reused by every on-chain action (buy, claim) so the app has one consistent transaction feel. */
export function TransactionOverlay({
  state,
  loadingText = 'CONFIRMING...',
  successText = 'SUCCESS',
  errorText = 'SOMETHING WENT WRONG',
}: TransactionOverlayProps) {
  if (state === 'idle') return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {state === 'loading' && (
          <>
            <CoinLoader size="lg" />
            <p className={styles.loadingText}>{loadingText}</p>
          </>
        )}

        {state === 'success' && (
          <div className={styles.resultWrap}>
            <div className={`${styles.iconCircle} ${styles.iconSuccess}`}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className={`${styles.resultText} ${styles.successText}`}>{successText}</p>
          </div>
        )}

        {state === 'error' && (
          <div className={styles.resultWrap}>
            <div className={`${styles.iconCircle} ${styles.iconError}`}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className={`${styles.resultText} ${styles.errorText}`}>{errorText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
