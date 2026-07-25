import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useTicketBuilderStore } from '../../store/ticketBuilderStore';
import { useProtocolState } from '../../api/hooks';
import { useOnChainState } from '../../solana/useOnChainState';
import { useLordsPotProgram } from '../../solana/program';
import { buyTickets } from '../../solana/buyTickets';
import { generateQuickPick, validateTicket, type StagedTicket } from '../../solana/ticketUtils';
import { usdcToNumber } from '../../lib/format';
import { CountdownBadge } from '../../components/CountdownBadge/CountdownBadge';
import { NumberBall } from '../../components/NumberBall/NumberBall';
import { AnimatedPrizePool } from '../../components/AnimatedPrizePool/AnimatedPrizePool';
import { TransactionOverlay, type TxState } from '../../components/TransactionOverlay/TransactionOverlay';
import { WalletGate } from '../../components/WalletGate/WalletGate';
import styles from './Home.module.css';

const QUICK_COUNTS = [1, 5, 10, 25];

export function Home() {
  const { publicKey } = useWallet();
  useConnection();
  const program = useLordsPotProgram();

  const { data: protocolState } = useProtocolState();
  const { data: onChain } = useOnChainState();

  const {
    stagedTickets,
    quickPickCount,
    manualNormals,
    manualBonus,
    addTickets,
    removeTicket,
    clearTickets,
    setQuickPickCount,
    toggleManualNormal,
    toggleManualBonus,
    resetManualPicker,
  } = useTicketBuilderStore();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const normalMax = onChain?.normalMax ?? 30;
  const bonusMax = onChain?.bonusMax ?? 10;
  const ticketPrice = onChain ? usdcToNumber(onChain.ticketPriceUsdc) : 1;
  const totalCost = stagedTickets.length * ticketPrice;
  const isPaused = onChain?.isPaused ?? protocolState?.isPaused ?? false;

  const manualValidation = validateTicket(manualNormals, manualBonus, normalMax, bonusMax);

  function handleQuickPick() {
    if (quickPickCount <= 0) return;
    const tickets: StagedTicket[] = Array.from({ length: quickPickCount }, () =>
      generateQuickPick(normalMax, bonusMax)
    );
    addTickets(tickets);
  }

  function handleAddManualTicket() {
    if (manualValidation) return;
    addTickets([{ normals: [...manualNormals], bonus: manualBonus as number, isQuickPick: false }]);
    resetManualPicker();
  }

  async function handleBuy() {
    if (!program || !publicKey || stagedTickets.length === 0 || isPaused) return;

    setTxState('loading');
    try {
      await buyTickets(program, publicKey, stagedTickets);
      clearTickets();
      setTxState('success');
    } catch (err) {
      console.error('Buy failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Transaction failed');
      setTxState('error');
    } finally {
      setTimeout(() => setTxState('idle'), 2800);
    }
  }

  return (
    <div className={styles.page}>
      <TransactionOverlay
        state={txState}
        loadingText="SECURING TICKETS..."
        successText="TICKETS SECURED"
        errorText={errorMsg || 'PURCHASE FAILED'}
      />

      {isPaused && (
        <div className={styles.pausedBanner}>
          Epoch is rolling over — ticket sales resume in moments.
        </div>
      )}

      <section className={styles.hero}>
        <div className={styles.badges}>
          <CountdownBadge targetIso={protocolState?.nextDrawAt ?? null} />
        </div>

        <AnimatedPrizePool value={protocolState ? usdcToNumber(protocolState.prizePoolUsdc) : 0} />
      </section>

      <section className={styles.buyCard}>
        <WalletGate
          title="Connect to play"
          description="Connect a Solana wallet to buy tickets — LordsPot never touches your keys."
        >
          <div className={styles.stepperRow}>
            <span className={styles.stepperLabel}>Quick Pick</span>
            <div className={styles.chips}>
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  className={`${styles.chip} ${quickPickCount === n ? styles.chipActive : ''}`}
                  onClick={() => setQuickPickCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.stepper}>
            <button onClick={() => setQuickPickCount(Math.max(1, quickPickCount - 1))}>−</button>
            <input
              type="number"
              min={1}
              value={quickPickCount}
              onChange={(e) => setQuickPickCount(Number(e.target.value) || 1)}
            />
            <button onClick={() => setQuickPickCount(quickPickCount + 1)}>+</button>
            <button className={styles.addQuickButton} onClick={handleQuickPick}>
              Add {quickPickCount} Ticket{quickPickCount === 1 ? '' : 's'}
            </button>
          </div>

          <button className={styles.pickerToggle} onClick={() => setPickerOpen((v) => !v)}>
            Choose numbers manually {pickerOpen ? '▲' : '▼'}
          </button>

          {pickerOpen && (
            <div className={styles.picker}>
              <div className={styles.pickerGroup}>
                <div className={styles.pickerHeader}>
                  <span>Numbers</span>
                  <span className={styles.pickerCount}>{manualNormals.length} of 5</span>
                </div>
                <div className={styles.ballGrid}>
                  {Array.from({ length: normalMax }, (_, i) => i + 1).map((n) => (
                    <NumberBall
                      key={n}
                      number={n}
                      size="sm"
                      selected={manualNormals.includes(n)}
                      onClick={() => toggleManualNormal(n)}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.pickerGroup}>
                <div className={styles.pickerHeader}>
                  <span>Bonus ball</span>
                  <span className={styles.pickerCount}>{manualBonus ? 1 : 0} of 1</span>
                </div>
                <div className={styles.ballGrid}>
                  {Array.from({ length: bonusMax }, (_, i) => i + 1).map((n) => (
                    <NumberBall
                      key={n}
                      number={n}
                      variant="bonus"
                      size="sm"
                      selected={manualBonus === n}
                      onClick={() => toggleManualBonus(n)}
                    />
                  ))}
                </div>
              </div>

              <button
                className={styles.addManualButton}
                disabled={manualValidation !== null}
                onClick={handleAddManualTicket}
              >
                {manualValidation ?? 'Stage this ticket'}
              </button>
            </div>
          )}

          {stagedTickets.length > 0 && (
            <div className={styles.staged}>
              <div className={styles.stagedHeader}>
                <span>Staged tickets ({stagedTickets.length})</span>
                <button className={styles.clearAll} onClick={clearTickets}>
                  Clear all
                </button>
              </div>
              <div className={styles.stagedList}>
                {stagedTickets.map((t, i) => (
                  <div key={i} className={styles.stagedRow}>
                    <div className={styles.stagedBalls}>
                      {t.normals.map((n, j) => (
                        <NumberBall key={j} number={n} size="xs" />
                      ))}
                      <NumberBall number={t.bonus} variant="bonus" size="xs" />
                    </div>
                    <button className={styles.removeTicket} onClick={() => removeTicket(i)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className={styles.buyButton}
            disabled={stagedTickets.length === 0 || txState !== 'idle' || isPaused || !program}
            onClick={handleBuy}
          >
            {stagedTickets.length === 0
              ? 'Stage tickets to buy'
              : `Buy ${stagedTickets.length} Ticket${stagedTickets.length === 1 ? '' : 's'} — $${totalCost.toFixed(2)}`}
          </button>
        </WalletGate>
      </section>
    </div>
  );
}
