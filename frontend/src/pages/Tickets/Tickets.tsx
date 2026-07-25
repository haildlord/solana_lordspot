import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMyTickets } from '../../api/hooks';
import { formatUsdc } from '../../lib/format';
import { TicketRow, type TicketRowVariant } from '../../components/TicketRow/TicketRow';
import { EmptyState } from '../../components/EmptyState/EmptyState';
import { WalletGate } from '../../components/WalletGate/WalletGate';
import { CoinLoader } from '../../components/CoinLoader/CoinLoader';
import type { UserTicket } from '../../api/types';
import styles from './Tickets.module.css';

function statusFor(ticket: UserTicket): { variant: TicketRowVariant; label: string } {
  switch (ticket.winStatus) {
    case 'DRAW_PENDING':
      return { variant: 'pending', label: 'Awaiting Draw' };
    case 'LOST':
      return { variant: 'loss', label: 'No Win' };
    case 'WON_FREE_TICKET':
      return { variant: 'free', label: 'Free Ticket' };
    case 'WON_UNCLAIMED':
      return { variant: 'win', label: `Won ${formatUsdc(ticket.winAmountUsdc)}` };
    case 'CLAIMED_ON_BASE':
      return { variant: 'win', label: `${formatUsdc(ticket.winAmountUsdc)} · Ready to claim` };
    case 'PAID_OUT_ON_SOLANA':
      return { variant: 'neutral', label: `${formatUsdc(ticket.winAmountUsdc)} · Paid` };
    default:
      return { variant: 'neutral', label: ticket.winStatus };
  }
}

export function Tickets() {
  const { data, isLoading } = useMyTickets();
  const navigate = useNavigate();

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, UserTicket[]>();
    for (const t of data.tickets) {
      const epoch = t.fulfillEpoch ?? t.purchaseEpoch;
      const list = map.get(epoch) ?? [];
      list.push(t);
      map.set(epoch, list);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [data]);

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

        <div className={styles.groups}>
          {groups.map(([epoch, tickets]) => (
            <div key={epoch} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupBadge}>Epoch {epoch}</span>
                <div className={styles.groupLine} />
                <span className={styles.groupCount}>{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</span>
              </div>
              <div className={styles.groupList}>
                {tickets.map((t) => {
                  const { variant, label } = statusFor(t);
                  return (
                    <TicketRow key={t.id} normals={t.normalBalls} bonus={t.bonusBall} variant={variant} statusLabel={label} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </WalletGate>
    </div>
  );
}
