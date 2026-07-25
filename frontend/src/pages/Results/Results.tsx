import { useMemo, useState } from 'react';
import { useEpochs, useEpochWinners, useAllTimeStats } from '../../api/hooks';
import { formatUsdc, formatDollarAmount, shortenAddress } from '../../lib/format';
import { NumberBall } from '../../components/NumberBall/NumberBall';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { CoinLoader } from '../../components/CoinLoader/CoinLoader';
import type { EpochSummary, PrizeTier } from '../../api/types';
import styles from './Results.module.css';

const FREE_TICKET_TIER_IDS = new Set([1, 4]);

function tierLabel(tier: PrizeTier): string {
  // Reverse-engineer the matches using division and modulo
  const normalMatches = Math.floor(tier.tierId / 2);
  const bonusMatch = tier.tierId % 2 !== 0; // True if odd, false if even

  const parts: string[] = [];
  parts.push(`${normalMatches} normal ball${normalMatches === 1 ? '' : 's'}`);
  if (bonusMatch) parts.push('1 bonus ball');
  
  return parts.join(' + ');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Results() {
  const { data, isLoading } = useEpochs();

  const { data: stats } = useAllTimeStats();
  const [selectedId, setSelectedId] = useState<number | null>(null);


  const selected = useMemo(
    () => data?.epochs.find((e) => e.megapotId === selectedId) ?? null,
    [data, selectedId]
  );

  if (selected) {
    return <EpochDetail epoch={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.headline}>Real Winners Everyday</h1>

      {stats && (
        <div className={styles.statsStrip}>
          <div className={styles.statsBlock}>
            <span className={styles.statsLabel}>Jackpots won</span>
            <span className={styles.statsValue}>{stats.jackpotsWon.toLocaleString()}</span>
          </div>
          <div className={styles.statsDivider} />
          <div className={styles.statsBlock}>
            <span className={styles.statsLabel}>Prizes paid</span>
            <span className={styles.statsValue}>{formatDollarAmount(stats.prizesWon)}</span>
          </div>
        </div>
      )}

      <h2 className={styles.sectionTitle}>Past Draws</h2>

      {isLoading && (
        <div className={styles.loading}>
          <CoinLoader size="lg" label="" />
        </div>
      )}

      {!isLoading && (!data || data.epochs.length === 0) && (
        <EmptyState icon="🕓" title="No settled draws yet" description="Results appear here once the first drawing concludes." />
      )}

      <div className={styles.list}>
        {data?.epochs.map((epoch) => {
          const jackpotPrize = formatUsdc(epoch.jackpot, { 
            decimals: 0 
          });

          return (
            <div key={epoch.megapotId} className={styles.card}>
              <div className={styles.cardDate}>{formatDate(epoch.settledAt)}</div>

              <TicketStub normals={epoch.winningNormals} bonus={epoch.winningBonusBall} size="md" />

              <div className={styles.statsRow}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Jackpot</span>
                  <span className={styles.statValue}>
                    {jackpotPrize}
                  </span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Prize Winners</span>
                  <span className={styles.statValue}>{epoch.totalWinnersCount}</span>
                </div>
              </div>

              <button className={styles.detailsButton} onClick={() => setSelectedId(epoch.megapotId)}>
                Round details →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TicketStub({ normals, bonus, size }: { normals: number[]; bonus: number; size: 'md' | 'lg' }) {
  return (
    <div className={`${styles.stub} ${size === 'lg' ? styles.stubLg : ''}`}>
      <div className={styles.stubNotchLeft} />
      <div className={styles.stubNotchRight} />
      <div className={styles.stubBalls}>
        {normals.map((n, i) => (
          <NumberBall key={i} number={n} size={size === 'lg' ? 'md' : 'sm'} />
        ))}
        <NumberBall number={bonus} variant="bonus" size={size === 'lg' ? 'md' : 'sm'} />
      </div>
      <span className={styles.stubMark}>LORDSPOT</span>
    </div>
  );
}

function EpochDetail({ epoch, onBack }: { epoch: EpochSummary; onBack: () => void }) {
  const [tab, setTab] = useState<'winners' | 'tiers'>('winners');
  const { data: winnersData, isLoading: winnersLoading } = useEpochWinners(epoch.megapotId);

  // Updated to use camelCase properties from the new optimized DB structure
  const sortedTiers = epoch.prizeTiers
    .filter((t) => t.amount !== '0' || FREE_TICKET_TIER_IDS.has(t.tierId))
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));

  return (
    <div className={styles.page}>
      <div className={styles.detailHeader}>
        <button className={styles.backButton} onClick={onBack}>
          ←
        </button>
        <h2 className={styles.detailTitle}>{formatDate(epoch.settledAt)}</h2>
      </div>

      <div className={styles.detailCard}>
        <TicketStub normals={epoch.winningNormals} bonus={epoch.winningBonusBall} size="lg" />

        <div className={styles.statsGrid}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Jackpot</span>
            <span className={styles.statValueLg}>
              {formatUsdc(epoch.jackpot, { decimals: 0 })}
            </span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Prize Winners</span>
            <span className={styles.statValueLg}>{epoch.totalWinnersCount.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className={styles.roundStatsHeader}>
        <h3 className={styles.roundStatsTitle}>Round Stats</h3>
        <a
          className={styles.verifyLink}
          href={`https://megapot.io/results/${epoch.megapotId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Verify ↗
        </a>
      </div>

      <div className={styles.roundStats}>
        <div className={styles.roundStatBlock}>
          <span className={styles.statLabel}>Prizes paid</span>
          <span className={styles.roundStatValue}>{formatUsdc(epoch.totalPaidAmount)}</span>
        </div>
        <div className={styles.roundStatBlock}>
          <span className={styles.statLabel}>Tickets played</span>
          <span className={styles.roundStatValue}>{epoch.totalTicketCount.toLocaleString()}</span>
        </div>
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'winners' ? styles.tabActive : ''}`} onClick={() => setTab('winners')}>
          Winners
        </button>
        <button className={`${styles.tab} ${tab === 'tiers' ? styles.tabActive : ''}`} onClick={() => setTab('tiers')}>
          Prize Tiers
        </button>
      </div>

      {tab === 'winners' && (
        <div className={styles.winnersList}>
          {winnersLoading && <CoinLoader size="sm" label="Loading winners" />}
          {!winnersLoading && (!winnersData || winnersData.winners.length === 0) && (
            <EmptyState title="No winning tickets this round" />
          )}
          {winnersData?.winners.map((w, i) => (
            <div key={i} className={styles.winnerRow}>
              <div className={styles.winnerLeft}>
                <div className={styles.avatar}>👤</div>
                <div>
                  <p className={styles.winnerAddress}>{shortenAddress(w.buyer)}</p>
                  <p className={styles.winnerTickets}>{w.ticketCount} winning ticket{w.ticketCount === 1 ? '' : 's'}</p>
                </div>
              </div>
              <span className={styles.winnerAmount}>{formatUsdc(w.totalUsdc)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'tiers' && (
        <>
          <div className={styles.tiersList}>
            {sortedTiers.map((tier) => {
              // 1. Calculate matches dynamically from the tierId since they are no longer in the DB
              const normalMatches = Math.floor(tier.tierId / 2);
              const bonusMatch = tier.tierId % 2 !== 0;
              const isFreeTicket = FREE_TICKET_TIER_IDS.has(tier.tierId);

              return (
                <div key={tier.tierId} className={styles.tierRow}>
                  <div className={styles.tierLeft}>
                    <div className={styles.tierBalls}>
                      {/* 2. Use normalMatches for the filled dots logic */}
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className={i < normalMatches ? styles.tierDotFilled : styles.tierDot}
                        />
                      ))}
                      {/* 3. Use bonusMatch for the bonus ball logic */}
                      <span className={bonusMatch ? styles.tierDotBonus : styles.tierDotBonusDim} />
                    </div>
                    <span className={styles.tierText}>{tierLabel(tier)}</span>
                  </div>
                  <div className={styles.tierRight}>
                    {/* 4. Use camelCase amount */}
                    <span className={isFreeTicket ? styles.tierAmountFree : styles.tierAmount}>
                      {isFreeTicket ? 'Free ticket' : formatUsdc(tier.amount)}
                    </span>
                    {/* 5. Use camelCase ticketCount */}
                    <span className={styles.tierWinners}>
                      {tier.ticketCount > 0
                        ? `${tier.ticketCount.toLocaleString()} winning ticket${tier.ticketCount === 1 ? '' : 's'}`
                        : 'No winning tickets'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {epoch.normalMax !== null && epoch.bonusMax !== null && (
            <div className={styles.ballRange}>
              <div className={styles.ballRangeBlock}>
                <div className={styles.ballRangeRow}>
                  <NumberBall number={1} size="sm" />
                  <span className={styles.ballRangeArrow}>→</span>
                  <NumberBall number={epoch.normalMax} size="sm" />
                </div>
                <span className={styles.ballRangeLabel}>normal balls</span>
              </div>
              <div className={styles.ballRangeBlock}>
                <div className={styles.ballRangeRow}>
                  <NumberBall number={1} variant="bonus" size="sm" />
                  <span className={styles.ballRangeArrow}>→</span>
                  <NumberBall number={epoch.bonusMax} variant="bonus" size="sm" />
                </div>
                <span className={styles.ballRangeLabel}>bonus balls</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
