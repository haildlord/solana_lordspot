import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useMyTickets, useProtocolState } from '../../api/hooks';
import { formatUsdc, formatCountdown, shortenAddress } from '../../lib/format';
import { TicketRow, type TicketRowVariant } from '../../components/TicketRow/TicketRow';
import { NumberBall } from '../../components/NumberBall/NumberBall';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { WalletGate } from '../../components/WalletGate/WalletGate';
import { CoinLoader } from '../../components/CoinLoader/CoinLoader';
import { BallReveal } from '../../components/BallReveal/BallReveal';
import { useRevealedEpochsStore, keyFor } from '../../store/revealedEpochsStore';
import { playWinChime } from '../../lib/sound';
import type { UserTicket } from '../../api/types';
import styles from './Tickets.module.css';

interface TicketGroup {
  epoch: number;
  tickets: UserTicket[];
  settledAt: string | null;
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

function useCountdown(targetIso: string | null): string {
  const [text, setText] = useState(() => formatCountdown(targetIso));
  useEffect(() => {
    setText(formatCountdown(targetIso));
    const id = setInterval(() => setText(formatCountdown(targetIso)), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return text;
}

function groupWinAmount(tickets: UserTicket[]): bigint {
  return tickets.filter((t) => !t.isFreeTicketTier).reduce((sum, t) => sum + BigInt(t.winAmountUsdc), 0n);
}

export function Tickets() {
  const { data, isLoading } = useMyTickets();
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
        winningNormals: tickets[0].epochWinningNormals,
        winningBonusBall: tickets[0].epochWinningBonusBall,
      }))
      .sort((a, b) => b.epoch - a.epoch);
  }, [data]);

  const upcomingGroups = groups.filter((g) => g.settledAt === null);
  const previousGroups = groups.filter((g) => g.settledAt !== null);
  const selected = groups.find((g) => g.epoch === selectedEpoch) ?? null;

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
          <div className={styles.loading}>
            <CoinLoader size="md" label="Loading tickets" />
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
  onClick,
}: {
  group: TicketGroup;
  nextDrawAt: string | null;
  onClick: () => void;
}) {
  const countdown = useCountdown(nextDrawAt);
  const preview = group.tickets[0];

  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.cardCountdown}>
        <span className={styles.cardCountdownDot} />
        {countdown}
      </div>
      <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
      <p className={styles.cardCount}>
        {group.tickets.length} Ticket{group.tickets.length === 1 ? '' : 's'}
      </p>
      <p className={styles.cardDate}>{nextDrawAt ? formatShortDate(nextDrawAt) : '—'}</p>
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

function TxHistory({ tickets }: { tickets: UserTicket[] }) {
  const [open, setOpen] = useState(true);

  const orders = useMemo(() => {
    const map = new Map<string, { count: number; purchasedAt: string; txSignature: string }>();
    for (const t of tickets) {
      const existing = map.get(t.orderHash);
      if (existing) existing.count += 1;
      else map.set(t.orderHash, { count: 1, purchasedAt: t.purchasedAt, txSignature: t.txSignature });
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
            <a
              key={o.txSignature}
              className={styles.txRow}
              href={`https://explorer.solana.com/tx/${o.txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div>
                <p className={styles.txCount}>
                  {o.count} ticket{o.count === 1 ? '' : 's'}
                </p>
                <p className={styles.txDate}>{formatDateTime(o.purchasedAt)}</p>
                <p className={styles.txSig}>{shortenAddress(o.txSignature, 6)}</p>
              </div>
              <span className={styles.txLinkIcon}>↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketOutcomeList({ tickets }: { tickets: UserTicket[] }) {
  return (
    <>
      <div className={styles.purchasedHeader}>
        <h3 className={styles.purchasedTitle}>Purchased</h3>
        <span className={styles.purchasedCount}>
          {tickets.length} Ticket{tickets.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className={styles.groupList}>
        {tickets.map((t) => {
          const { variant, label } = statusFor(t);
          return <TicketRow key={t.id} normals={t.normalBalls} bonus={t.bonusBall} variant={variant} statusLabel={label} />;
        })}
      </div>
    </>
  );
}

function matchSets(tickets: UserTicket[]) {
  const normals = new Set<number>();
  const bonuses = new Set<number>();
  for (const t of tickets) {
    t.normalBalls.forEach((n) => normals.add(n));
    bonuses.add(t.bonusBall);
  }
  return { normals, bonuses };
}

function WinningNumbersRow({ group }: { group: TicketGroup }) {
  const { normals, bonuses } = matchSets(group.tickets);
  const winningNormals = group.winningNormals!;
  const winningBonus = group.winningBonusBall!;

  return (
    <div className={styles.winningRow}>
      {winningNormals.map((n, i) => (
        <NumberBall key={i} number={n} size="md" selected={normals.has(n)} dim={!normals.has(n)} />
      ))}
      <NumberBall number={winningBonus} variant="bonus" size="md" selected={bonuses.has(winningBonus)} dim={!bonuses.has(winningBonus)} />
    </div>
  );
}

function UpcomingDetail({ group, nextDrawAt }: { group: TicketGroup; nextDrawAt: string | null }) {
  const countdown = useCountdown(nextDrawAt);
  const preview = group.tickets[0];

  return (
    <>
      <div className={styles.upcomingHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <p className={styles.heroHeadline}>Good Luck</p>
        <p className={styles.heroCountdown}>{countdown}</p>
        <p className={styles.heroSub}>{nextDrawAt ? `Drawing ${formatDateTime(nextDrawAt)}` : 'Draw time to be confirmed'}</p>
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
          <CoinLoader size="sm" label="" />
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
            normals={group.winningNormals!}
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
  const hasUnclaimedCash = group.tickets.some((t) => t.winStatus === 'WON_UNCLAIMED');
  const claimLabel = hasUnclaimedCash ? 'Claim Rewards' : 'Claim Free Tickets';

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

      <TicketOutcomeList tickets={group.tickets} />
      <TxHistory tickets={group.tickets} />
    </>
  );
}

function LostDetail({ group }: { group: TicketGroup }) {
  const preview = group.tickets[0];

  return (
    <>
      <div className={styles.pointsHero}>
        <MiniTicketStub normals={preview.normalBalls} bonus={preview.bonusBall} />
        <h2 className={styles.pointsHeadline}>You Earned Points</h2>
        <p className={styles.winningLabel}>Winning numbers</p>
        <WinningNumbersRow group={group} />
        <p className={styles.wonDate}>Drawn {formatDateTime(group.settledAt!)}</p>

        <div className={styles.statGrid}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Winnings</span>
            <span className={styles.statValue}>{formatUsdc('0')}</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Free Tickets</span>
            <span className={styles.statValue}>0</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Points</span>
            <span className={styles.statValueMuted}>Coming soon</span>
          </div>
        </div>
      </div>

      <TicketOutcomeList tickets={group.tickets} />
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

  const headerDate = isUpcoming
    ? protocolState?.nextDrawAt
      ? formatDate(protocolState.nextDrawAt)
      : 'Upcoming'
    : formatDate(group.settledAt!);

  let body: ReactNode;
  if (isUpcoming) {
    body = <UpcomingDetail group={group} nextDrawAt={protocolState?.nextDrawAt ?? null} />;
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
