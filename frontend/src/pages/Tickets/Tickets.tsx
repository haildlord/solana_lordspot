import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyTickets, useProtocolState } from '../../api/hooks';
import { formatUsdc, shortenAddress } from '../../lib/format';
import { TicketRow, type TicketRowVariant } from '../../components/TicketRow/TicketRow';
import { NumberBall } from '../../components/NumberBall/NumberBall';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { WalletGate } from '../../components/WalletGate/WalletGate';
import { CoinLoader } from '../../components/CoinLoader/CoinLoader';
import { CountdownBadge } from '../../components/CountdownBadge/CountdownBadge';
import { BallReveal } from '../../components/BallReveal/BallReveal';
import { useRevealedEpochsStore, keyFor } from '../../store/revealedEpochsStore';
import { playWinChime } from '../../lib/sound';
import type { UserTicket } from '../../api/types';
import styles from './Tickets.module.css';

interface TicketGroup {
  epoch: number;
  tickets: UserTicket[];
  settledAt: string | null;
  /** This group's own epoch's countdown/reveal target once it has settled
   * (backend already bakes the UI reveal buffer into it) — null only while
   * the epoch is still the one currently running. */
  countdownAnchor: string | null;
  winningNormals: number[] | null;
  winningBonusBall: number | null;
}

function statusFor(ticket: UserTicket): { variant: TicketRowVariant; label: string } {
  switch (ticket.winStatus) {
    case 'DRAW_PENDING':
      return { variant: 'pending', label: 'Awaiting Draw' };
    case 'LOST':
      return { variant: 'loss', label: 'No Win' };
    case 'WON_FREE_TICKET':
      return { variant: 'free', label: 'Free Ticket' };
    case 'WON_UNCLAIMED':
      return { variant: 'win', label: `${formatUsdc(ticket.winAmountUsdc)}` };
    case 'CLAIMED_ON_BASE':
      return { variant: 'win', label: `${formatUsdc(ticket.winAmountUsdc)}` };
    case 'PAID_OUT_ON_SOLANA':
      return { variant: 'neutral', label: `${formatUsdc(ticket.winAmountUsdc)}` };
    default:
      return { variant: 'neutral', label: ticket.winStatus };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${date} - ${time}`;
}

function groupWinAmount(tickets: UserTicket[]): bigint {
  return tickets.filter((t) => !t.isFreeTicketTier).reduce((sum, t) => sum + BigInt(t.winAmountUsdc), 0n);
}

/** True while the relay to Base hasn't landed yet — the ticket exists (Solana confirmed)
 * but isn't guaranteed to be in the drawing yet, so the UI must not promise a draw time. */
function isGroupProcessing(tickets: UserTicket[]): boolean {
  return tickets.some((t) => t.orderStatus !== 'SUCCESS');
}

/**
 * A ticket group's countdown target, resolved per-group instead of against a
 * single shared "most recent epoch" — that was the earlier bug: any group
 * older than the single most-recently-settled epoch had nowhere correct to
 * point, so it either fell back to a live countdown for the wrong (current)
 * epoch (jumping forward every rollover) or froze on a static placeholder.
 *
 * While the group's own epoch is still the one currently running
 * (`protocolState.megapotEpochId`), its target is the live nextDrawAt.
 * Once the protocol moves past it, its MegapotEpoch row (and thus its own
 * endedAt) exists immediately — written the instant a rollover is detected,
 * well before that epoch's own reveal buffer clears — so `countdownAnchor`
 * is always the correct target, no matter how many epochs behind "current"
 * the group is. Both nextDrawAt and countdownAnchor already carry the same
 * UI reveal buffer baked in server-side (see megapotService's
 * EPOCH_END_UI_BUFFER_MS), so there's no jump crossing from one to the other.
 */
function resolveCountdownTarget(
  ticketEpoch: number,
  megapotEpochId: number | null,
  nextDrawAt: string | null,
  countdownAnchor: string | null
): string | null {
  if (megapotEpochId !== null && ticketEpoch >= megapotEpochId) return nextDrawAt;
  return countdownAnchor;
}

/** Ticks every second so a card can flip the instant its own target passes,
 * instead of showing a dead "DRAWING NOW" placeholder until the next
 * (up to 20s away) tickets poll catches up. The backend work itself is
 * normally done well before this — grading runs the moment the epoch
 * settles via a Redis nudge, not on a delay — so once this flips true the
 * real results are almost always already sitting in Postgres, just not
 * fetched into this tab yet. */
function useCountdownExpired(targetIso: string | null): boolean {
  const [expired, setExpired] = useState(() => !!targetIso && new Date(targetIso).getTime() <= Date.now());

  useEffect(() => {
    if (!targetIso) {
      setExpired(false);
      return;
    }
    const check = () => setExpired(new Date(targetIso).getTime() <= Date.now());
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  return expired;
}

export function Tickets() {
  const { data, isLoading, refetch } = useMyTickets();
  const { data: protocolState } = useProtocolState();
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? '';
  const navigate = useNavigate();
  const revealedMap = useRevealedEpochsStore((s) => s.revealed);
  const [selectedEpoch, setSelectedEpoch] = useState<number | null>(null);

  const groups = useMemo<TicketGroup[]>(() => {
    if (!data) return [];
    const map = new Map<number, UserTicket[]>();
    for (const t of data.tickets) {
      const epoch = t.fulfillEpoch ?? t.purchaseEpoch;
      const list = map.get(epoch) ?? [];
      list.push(t);
      map.set(epoch, list);
    }
    return [...map.entries()]
      .map(([epoch, tickets]) => ({
        epoch,
        tickets,
        settledAt: tickets[0].epochSettledAt,
        countdownAnchor: tickets[0].epochEndedAt,
        winningNormals: tickets[0].epochWinningNormals,
        winningBonusBall: tickets[0].epochWinningBonusBall,
      }))
      .sort((a, b) => b.epoch - a.epoch);
  }, [data]);

  const upcomingGroups = groups.filter((g) => g.settledAt === null);
  const previousGroups = groups.filter((g) => g.settledAt !== null);
  const selected = groups.find((g) => g.epoch === selectedEpoch) ?? null;

  // useMyTickets only polls every 20s — left alone, a group sitting right at
  // its own reveal target would keep showing a dead "DRAWING NOW" state for
  // up to 20s after the backend is actually done. Schedule ONE extra refetch
  // for exactly the soonest upcoming target instead of waiting on the regular
  // poll, so the flip to "revealed" happens within a second or two of the
  // countdown reaching zero.
  useEffect(() => {
    const megapotEpochId = protocolState?.megapotEpochId ?? null;
    const nextDrawAt = protocolState?.nextDrawAt ?? null;
    const soonest = upcomingGroups
      .map((g) => resolveCountdownTarget(g.epoch, megapotEpochId, nextDrawAt, g.countdownAnchor))
      .filter((t): t is string => !!t)
      .map((t) => new Date(t).getTime())
      .sort((a, b) => a - b)[0];

    if (soonest === undefined) return;

    const delay = soonest - Date.now();
    if (delay <= 0) {
      void refetch();
      return;
    }
    // Small grace so the backend has actually written the settled row by the
    // time this fires, rather than racing it.
    const id = setTimeout(() => void refetch(), delay + 1500);
    return () => clearTimeout(id);
  }, [upcomingGroups, protocolState?.megapotEpochId, protocolState?.nextDrawAt, refetch]);

  if (selected) {
    return <TicketGroupDetail group={selected} wallet={wallet} onBack={() => setSelectedEpoch(null)} />;
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>My Tickets</h2>

      <WalletGate
        title="Connect to view your tickets"
        description="Your ticket history lives on-chain — connect the wallet you bought with."
      >
        {isLoading && (
          // when list of my tickets are loading
          <div className={styles.loading}>
            <CoinLoader size="md" /> 
          </div>
        )}

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon="🎫"
            title="No tickets yet"
            description="You haven't bought a ticket this epoch. Head to Play and stage your first one."
            action={{ label: 'Buy a ticket', onClick: () => navigate('/') }}
          />
        )}

        {upcomingGroups.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Upcoming</h3>
            <div className={styles.cardList}>
              {upcomingGroups.map((g) => (
                <UpcomingCard
                  key={g.epoch}
                  group={g}
                  nextDrawAt={protocolState?.nextDrawAt ?? null}
                  megapotEpochId={protocolState?.megapotEpochId ?? null}
                  onClick={() => setSelectedEpoch(g.epoch)}
                />
              ))}
            </div>
          </section>
        )}

        {previousGroups.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Previous</h3>
            <div className={styles.cardList}>
              {previousGroups.map((g) => (
                <PreviousCard
                  key={g.epoch}
                  group={g}
                  revealed={!!revealedMap[keyFor(wallet, g.epoch)]}
                  onClick={() => setSelectedEpoch(g.epoch)}
                />
              ))}
            </div>
          </section>
        )}
      </WalletGate>
    </div>
  );
}

function MiniTicketStub({ normals, bonus }: { normals: number[]; bonus: number }) {
  return (
    <div className={styles.stub}>
      <div className={styles.stubBalls}>
        {normals.map((n, i) => (
          <NumberBall key={i} number={n} size="sm" />
        ))}
        <NumberBall number={bonus} variant="bonus" size="sm" />
      </div>
      <span className={styles.stubMark}>LORDSPOT</span>
    </div>
  );
}

function PlainTicketRow({ normals, bonus }: { normals: number[]; bonus: number }) {
  return (
    <div className={styles.plainRow}>
      {normals.map((n, i) => (
        <NumberBall key={i} number={n} size="sm" />
      ))}
      <NumberBall number={bonus} variant="bonus" size="sm" />
    </div>
  );
}

function UpcomingCard({
  group,
  nextDrawAt,
  megapotEpochId,
  onClick,
}: {
  group: TicketGroup;
  nextDrawAt: string | null;
  megapotEpochId: number | null;
  onClick: () => void;
}) {
  const preview = group.tickets[0];
  const processing = isGroupProcessing(group.tickets);
  const target = resolveCountdownTarget(group.epoch, megapotEpochId, nextDrawAt, group.countdownAnchor);
  const expired = useCountdownExpired(target);

  return (
    <button type="button" className={styles.card} onClick={onClick}>
      {processing ? (
        <div className={styles.cardProcessing}>
          <span className={styles.cardProcessingDot} />
          Processing…
        </div>
      ) : expired ? (
        <div className={styles.cardReveal}>
          <span className={styles.cardRevealDot} />
          Reveal
        </div>
      ) : (
        <div className={styles.cardCountdownWrap}>
          <CountdownBadge targetIso={target} label="" />
        </div>
      )}
      <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
      <p className={styles.cardCount}>
        {group.tickets.length} Ticket{group.tickets.length === 1 ? '' : 's'}
      </p>
      <p className={styles.cardDate}>{expired ? 'Ready to reveal' : target ? formatShortDate(target) : '—'}</p>
    </button>
  );
}

function PreviousCard({
  group,
  revealed,
  onClick,
}: {
  group: TicketGroup;
  revealed: boolean;
  onClick: () => void;
}) {
  const preview = group.tickets[0];
  const isGrading = group.tickets.some((t) => t.winStatus === 'DRAW_PENDING');
  const hasFreeTicket = group.tickets.some((t) => t.isFreeTicketTier);
  const freeTicketCount = group.tickets.filter((t) => t.isFreeTicketTier).length;
  const totalWinAmount = groupWinAmount(group.tickets);
  const showWinBadges = revealed && !isGrading && (hasFreeTicket || totalWinAmount > 0n);

  return (
    <button type="button" className={styles.card} onClick={onClick}>
      {showWinBadges && (
        <div className={styles.cardBadges}>
          {totalWinAmount > 0n && <span className={styles.winBadge}>Win {formatUsdc(totalWinAmount)}</span>}
          {hasFreeTicket && <span className={styles.freeBadge}>🎫 {freeTicketCount}</span>}
        </div>
      )}
      <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
      <p className={styles.cardCount}>
        {group.tickets.length} Ticket{group.tickets.length === 1 ? '' : 's'}
      </p>
      <p className={styles.cardDate}>{formatShortDate(group.settledAt!)}</p>
      {isGrading && <p className={styles.cardHint}>Finalizing…</p>}
      {!isGrading && !revealed && <p className={styles.cardHint}>Tap to reveal</p>}
      {!isGrading && revealed && !showWinBadges && <p className={styles.cardHint}>No win this time</p>}
    </button>
  );
}

interface OrderProof {
  orderHash: string;
  count: number;
  purchasedAt: string;
  txSignature: string;
  baseTxHash: string | null;
}

/** LordsPot is a relayer — every purchase leaves two independent proofs: the user's
 * own Solana buy tx, and the relayer's Base buyTickets tx that forwards it into Megapot.
 * A large purchase can relay across several Base transactions (chunked — see
 * baseRelayWorker.ts), so baseTxHash is checked per group, not gated on the parent
 * order's overall status: one chunk can be confirmed while others are still in flight. */
function TxProofRow({ order }: { order: OrderProof }) {
  const baseConfirmed = !!order.baseTxHash;

  return (
    <div className={styles.txRow}>
      <div className={styles.txMeta}>
        <span className={styles.txCount}>
          {order.count} ticket{order.count === 1 ? '' : 's'}
        </span>
        <span className={styles.txDate}>{formatDateTime(order.purchasedAt)}</span>
      </div>

      <div className={styles.txProofGrid}>
        <a
          className={`${styles.txProof} ${styles.txProofSolana}`}
          href={`https://explorer.solana.com/tx/${order.txSignature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className={styles.txProofChain}>Solana</span>
          <span className={styles.txProofHash}>{shortenAddress(order.txSignature, 6)}</span>
          <span className={styles.txProofIcon}>↗</span>
        </a>

        {baseConfirmed ? (
          <a
            className={`${styles.txProof} ${styles.txProofBase}`}
            href={`https://sepolia.basescan.org/tx/${order.baseTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className={styles.txProofChain}>Base</span>
            <span className={styles.txProofHash}>{shortenAddress(order.baseTxHash!, 6)}</span>
            <span className={styles.txProofIcon}>↗</span>
          </a>
        ) : (
          <div className={`${styles.txProof} ${styles.txProofBase} ${styles.txProofPending}`}>
            <span className={styles.txProofChain}>Base</span>
            <span className={styles.txProofPendingLabel}>Processing…</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TxHistory({ tickets }: { tickets: UserTicket[] }) {
  const [open, setOpen] = useState(false);

  // Grouped by (order, base tx) — not just order — because a large purchase
  // can relay across several Base transactions (chunked, see baseRelayWorker.ts).
  // Tickets still awaiting their batch's confirmation (baseTxHash still null)
  // share one "Processing…" group per order until each batch lands.
  const orders = useMemo<OrderProof[]>(() => {
    const map = new Map<string, OrderProof>();
    for (const t of tickets) {
      const key = `${t.orderHash}:${t.baseTxHash ?? 'pending'}`;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else
        map.set(key, {
          orderHash: t.orderHash,
          count: 1,
          purchasedAt: t.purchasedAt,
          txSignature: t.txSignature,
          baseTxHash: t.baseTxHash,
        });
    }
    return [...map.values()].sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
  }, [tickets]);

  return (
    <div className={styles.txSection}>
      <button type="button" className={styles.txHeader} onClick={() => setOpen((o) => !o)}>
        <span>Transaction History ({orders.length})</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className={styles.txList}>
          {orders.map((o) => (
            <TxProofRow key={`${o.orderHash}:${o.baseTxHash ?? 'pending'}`} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketOutcomeList({ group }: { group: TicketGroup }) {
  return (
    <>
      <div className={styles.purchasedHeader}>
        <h3 className={styles.purchasedTitle}>Purchased</h3>
        <span className={styles.purchasedCount}>
          {group.tickets.length} Ticket{group.tickets.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.groupList}>
        {group.tickets.map((t) => {
          const { variant, label } = statusFor(t);
          return (
            <TicketRow
              key={t.id}
              normals={t.normalBalls}
              bonus={t.bonusBall}
              variant={variant}
              statusLabel={label}
              winningNormals={group.winningNormals ?? undefined}
              winningBonusBall={group.winningBonusBall ?? undefined}
            />
          );
        })}
      </div>
    </>
  );
}

/** Just the drawn numbers, plain and sorted — no per-user match styling here.
 * Match highlighting belongs on the purchased tickets below (see TicketRow). */
function WinningNumbersRow({ group }: { group: TicketGroup }) {
  const winningNormals = [...group.winningNormals!].sort((a, b) => a - b);
  const winningBonus = group.winningBonusBall!;

  return (
    <div className={styles.winningRow}>
      {winningNormals.map((n, i) => (
        <NumberBall key={i} number={n} size="md" />
      ))}
      <NumberBall number={winningBonus} variant="bonus" size="md" />
    </div>
  );
}

function UpcomingDetail({
  group,
  nextDrawAt,
  megapotEpochId,
}: {
  group: TicketGroup;
  nextDrawAt: string | null;
  megapotEpochId: number | null;
}) {
  const preview = group.tickets[0];
  const processing = isGroupProcessing(group.tickets);
  const target = resolveCountdownTarget(group.epoch, megapotEpochId, nextDrawAt, group.countdownAnchor);
  const expired = useCountdownExpired(target);

  return (
    <>
      <div className={styles.upcomingHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        {processing ? (
          <>
            <p className={styles.heroHeadline}>Processing Purchase</p>
            <div className={styles.gradingNotice}>
              <span>Confirming your ticket on-chain — this can take a minute</span>
            </div>
          </>
        ) : expired ? (
          <>
            <p className={styles.heroHeadline}>Ready to Reveal</p>
            <div className={styles.heroRevealBadge}>
              <span className={styles.cardRevealDot} />
              Results are landing now
            </div>
          </>
        ) : (
          <>
            <p className={styles.heroHeadline}>Good Luck</p>
            <CountdownBadge targetIso={target} label="" />
            <p className={styles.heroSub}>{target ? `Drawing ${formatDateTime(target)}` : 'Draw time to be confirmed'}</p>
          </>
        )}
      </div>

      <TicketOutcomeListPlain group={group} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function TicketOutcomeListPlain({ group }: { group: TicketGroup }) {
  return (
    <>
      <div className={styles.purchasedHeader}>
        <h3 className={styles.purchasedTitle}>Purchased</h3>
        <span className={styles.purchasedCount}>
          {group.tickets.length} Ticket{group.tickets.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.plainList}>
        {group.tickets.map((t) => (
          <PlainTicketRow key={t.id} normals={t.normalBalls} bonus={t.bonusBall} />
        ))}
      </div>
    </>
  );
}

function GradingDetail({ group }: { group: TicketGroup }) {
  const preview = group.tickets[0];

  return (
    <>
      <div className={styles.neutralHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <h2 className={styles.resultsHeadline}>Results</h2>
        <div className={styles.placeholderRow}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.dot} />
          ))}
          <div className={styles.dotBonus} />
        </div>
        <div className={styles.gradingNotice}>
          <span>Finalizing results — check back shortly</span>
        </div>
      </div>

      <TicketOutcomeListPlain group={group} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function NotRevealedDetail({ group, wallet, hasWon }: { group: TicketGroup; wallet: string; hasWon: boolean }) {
  const [revealing, setRevealing] = useState(false);
  const reveal = useRevealedEpochsStore((s) => s.reveal);
  const preview = group.tickets[0];

  return (
    <>
      <div className={styles.neutralHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <h2 className={styles.resultsHeadline}>Results</h2>

        {revealing ? (
          <BallReveal
            normals={[...group.winningNormals!].sort((a, b) => a - b)}
            bonus={group.winningBonusBall!}
            onComplete={() => {
              if (hasWon) playWinChime();
              reveal(wallet, group.epoch);
            }}
          />
        ) : (
          <div className={styles.placeholderRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.dot} />
            ))}
            <div className={styles.dotBonus} />
          </div>
        )}

        {!revealing && (
          <button type="button" className={styles.checkButton} onClick={() => setRevealing(true)}>
            Check Results
          </button>
        )}
      </div>

      <TicketOutcomeListPlain group={group} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function WonDetail({
  group,
  totalWinAmount,
  freeTicketCount,
}: {
  group: TicketGroup;
  totalWinAmount: bigint;
  freeTicketCount: number;
}) {
  const navigate = useNavigate();
  const preview = group.tickets[0];
  const claimLabel = 'Claim Rewards';

  return (
    <>
      <div className={styles.wonHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <h2 className={styles.wonHeadline}>You Won</h2>
        <p className={styles.winningLabel}>Winning numbers</p>
        <WinningNumbersRow group={group} />
        <p className={styles.wonDate}>Drawn {formatDateTime(group.settledAt!)}</p>

        <div className={styles.statGrid}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Winnings</span>
            <span className={styles.statValue}>{formatUsdc(totalWinAmount)}</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Free Tickets</span>
            <span className={styles.statValue}>{freeTicketCount}</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Points</span>
            <span className={styles.statValueMuted}>Coming soon</span>
          </div>
        </div>

        <button type="button" className={styles.claimButton} onClick={() => navigate('/winnings')}>
          {claimLabel} →
        </button>
      </div>

      <TicketOutcomeList group={group} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function LostDetail({ group }: { group: TicketGroup }) {
  const preview = group.tickets[0];

  return (
    <>
      <div className={styles.neutralHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <h2 className={styles.resultsHeadline}>No Win This Time</h2>
        <p className={styles.winningLabel}>Winning numbers</p>
        <WinningNumbersRow group={group} />
        <p className={styles.wonDate}>Drawn {formatDateTime(group.settledAt!)}</p>
      </div>

      <TicketOutcomeList group={group} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function TicketGroupDetail({
  group,
  wallet,
  onBack,
}: {
  group: TicketGroup;
  wallet: string;
  onBack: () => void;
}) {
  const { data: protocolState } = useProtocolState();
  const revealed = useRevealedEpochsStore((s) => s.isRevealed(wallet, group.epoch));

  const isUpcoming = group.settledAt === null;
  const isGrading = !isUpcoming && group.tickets.some((t) => t.winStatus === 'DRAW_PENDING');
  const hasFreeTicket = group.tickets.some((t) => t.isFreeTicketTier);
  const freeTicketCount = group.tickets.filter((t) => t.isFreeTicketTier).length;
  const totalWinAmount = groupWinAmount(group.tickets);
  const hasWon = hasFreeTicket || totalWinAmount > 0n;

  const target = resolveCountdownTarget(
    group.epoch,
    protocolState?.megapotEpochId ?? null,
    protocolState?.nextDrawAt ?? null,
    group.countdownAnchor
  );
  const expired = useCountdownExpired(target);

  const headerDate = isUpcoming
    ? expired
      ? 'Ready to Reveal'
      : target
        ? formatDate(target)
        : 'Upcoming'
    : formatDate(group.settledAt!);

  let body: ReactNode;
  if (isUpcoming) {
    body = (
      <UpcomingDetail
        group={group}
        nextDrawAt={protocolState?.nextDrawAt ?? null}
        megapotEpochId={protocolState?.megapotEpochId ?? null}
      />
    );
  } else if (isGrading) {
    body = <GradingDetail group={group} />;
  } else if (!revealed) {
    body = <NotRevealedDetail group={group} wallet={wallet} hasWon={hasWon} />;
  } else if (hasWon) {
    body = <WonDetail group={group} totalWinAmount={totalWinAmount} freeTicketCount={freeTicketCount} />;
  } else {
    body = <LostDetail group={group} />;
  }

  return (
    <div className={styles.page}>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ←
        </button>
        <h2 className={styles.detailTitle}>{headerDate}</h2>
      </div>
      {body}
    </div>
  );
}
