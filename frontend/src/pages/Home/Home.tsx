import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useTicketBuilderStore, MAX_STAGED_TICKETS } from '../../store/ticketBuilderStore';
import { useProtocolState } from '../../api/hooks';
import { useOnChainState } from '../../solana/useOnChainState';
import { useLordsPotProgram } from '../../solana/program';
import { buyTickets } from '../../solana/buyTickets';
import { isTicketComplete } from '../../solana/ticketUtils';
import { usdcToNumber } from '../../lib/format';
import { CountdownBadge } from '../../components/CountdownBadge/CountdownBadge';
import { NumberBall } from '../../components/NumberBall/NumberBall';
import { AnimatedPrizePool } from '../../components/AnimatedPrizePool/AnimatedPrizePool';
import { TicketEditor, EditIcon } from '../../components/TicketEditor/TicketEditor';
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
    removeTicket,
    clearTickets,
    syncStagedCount,
    shuffleTicket,
    clearTicketBalls,
    toggleTicketNormal,
    toggleTicketBonus,
    shuffleAllTickets,
    clearAllTicketBalls,
  } = useTicketBuilderStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [txState, setTxState] = useState<TxState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const normalMax = onChain?.normalMax ?? 30;
  const bonusMax = onChain?.bonusMax ?? 10;
  const ticketPrice = onChain ? usdcToNumber(onChain.ticketPriceUsdc) : 1;
  const totalCost = stagedTickets.length * ticketPrice;
  const isPaused = onChain?.isPaused ?? protocolState?.isPaused ?? false;

  const atCap = stagedTickets.length >= MAX_STAGED_TICKETS;
  const allComplete =
    stagedTickets.length > 0 && stagedTickets.every((t) => isTicketComplete(t, normalMax, bonusMax));

  // Local text buffer for the count input — see the input's own comment for
  // why this can't just be a plain `value={stagedTickets.length}` binding.
  const [countText, setCountText] = useState(() => String(stagedTickets.length));
  useEffect(() => {
    setCountText(String(stagedTickets.length));
  }, [stagedTickets.length]);

  function setCount(next: number) {
    syncStagedCount(Math.max(0, Math.min(next, MAX_STAGED_TICKETS)), normalMax, bonusMax);
  }

  function closeEditor() {
    setEditorOpen(false);
    setExpandedIndex(null);
  }

  function openEditorOn(index: number) {
    setEditorOpen(true);
    setExpandedIndex(index);
  }

  async function handleBuy() {
    if (!program || !publicKey || !allComplete || stagedTickets.length > MAX_STAGED_TICKETS || isPaused) return;

    setTxState('loading');
    try {
      await buyTickets(program, publicKey, stagedTickets);
      clearTickets();
      closeEditor();
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
            <span className={styles.stepperLabel}>Ticket count</span>
            <div className={styles.chips}>
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  className={`${styles.chip} ${stagedTickets.length === n ? styles.chipActive : ''}`}
                  onClick={() => setCount(n)}
                  disabled={n > MAX_STAGED_TICKETS}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.stepper}>
            <button onClick={() => setCount(stagedTickets.length - 1)} disabled={stagedTickets.length === 0}>
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={countText}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
                setCountText(raw);
                if (raw !== '') setCount(Number(raw));
              }}
              onBlur={() => setCountText(String(stagedTickets.length))}
            />
            <button onClick={() => setCount(stagedTickets.length + 1)} disabled={atCap}>
              +
            </button>
          </div>
          <p className={styles.stepperHint}>
            {stagedTickets.length === 0
              ? 'Set a count to auto-stage random tickets — edit any of them below.'
              : atCap
                ? `Max ${MAX_STAGED_TICKETS} tickets per purchase.`
                : `${stagedTickets.length} staged — adjust the count or edit numbers below.`}
          </p>

          {stagedTickets.length > 0 && (
            <div className={styles.staged}>
              <div className={styles.stagedHeader}>
                <span>
                  Staged tickets ({stagedTickets.length}/{MAX_STAGED_TICKETS})
                </span>
                <button className={styles.clearAll} onClick={() => { clearTickets(); closeEditor(); }}>
                  Clear all
                </button>
              </div>

              {!editorOpen && (
                <div className={styles.stagedList}>
                  {stagedTickets.map((t, i) => {
                    const complete = isTicketComplete(t, normalMax, bonusMax);
                    return (
                      <div key={i} className={styles.stagedRow}>
                        <div className={styles.stagedBalls}>
                          {t.normals.map((n, j) => (
                            <NumberBall key={j} number={n} size="xs" />
                          ))}
                          {t.bonus !== null && <NumberBall number={t.bonus} variant="bonus" size="xs" />}
                          {!complete && <span className={styles.incompleteTag}>Incomplete</span>}
                        </div>
                        <button
                          className={styles.editTicketButton}
                          onClick={() => openEditorOn(i)}
                          aria-label="Choose numbers for this ticket"
                        >
                          <EditIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <button className={styles.editorToggle} onClick={() => (editorOpen ? closeEditor() : setEditorOpen(true))}>
                {editorOpen ? 'Hide editor ▲' : 'Choose numbers ▼'}
              </button>

              {editorOpen && (
                <TicketEditor
                  tickets={stagedTickets}
                  normalMax={normalMax}
                  bonusMax={bonusMax}
                  expandedIndex={expandedIndex}
                  onExpand={setExpandedIndex}
                  onToggleNormal={toggleTicketNormal}
                  onToggleBonus={toggleTicketBonus}
                  onShuffleTicket={(i) => shuffleTicket(i, normalMax, bonusMax)}
                  onClearTicket={clearTicketBalls}
                  onRemoveTicket={removeTicket}
                  onShuffleAll={() => shuffleAllTickets(normalMax, bonusMax)}
                  onClearAll={clearAllTicketBalls}
                  onClose={closeEditor}
                />
              )}
            </div>
          )}

          <button
            className={styles.buyButton}
            disabled={!allComplete || txState !== 'idle' || isPaused || !program}
            onClick={handleBuy}
          >
            {stagedTickets.length === 0
              ? 'Set a count to buy'
              : !allComplete
                ? 'Finish selecting numbers'
                : `Buy ${stagedTickets.length} Ticket${stagedTickets.length === 1 ? '' : 's'} — $${totalCost.toFixed(2)}`}
          </button>
        </WalletGate>
      </section>
    </div>
  );
}
