import { NumberBall } from '../NumberBall/NumberBall';
import styles from './TicketRow.module.css';

export type TicketRowVariant = 'win' | 'free' | 'pending' | 'loss' | 'neutral';

interface TicketRowProps {
  normals: number[];
  bonus: number;
  statusLabel: string;
  variant: TicketRowVariant;
  /** When provided, each of this ticket's own balls is highlighted if it matches
   * a winning number — the drawn numbers themselves stay plain elsewhere. */
  winningNormals?: number[];
  winningBonusBall?: number;
}

/** One ticket's numbers + a status pill — used on the Tickets page's revealed states. */
export function TicketRow({ normals, bonus, statusLabel, variant, winningNormals, winningBonusBall }: TicketRowProps) {
  const hasWinningData = winningNormals !== undefined && winningBonusBall !== undefined;
  const winningSet = hasWinningData ? new Set(winningNormals) : null;
  const dim = !hasWinningData && variant === 'loss';

  return (
    <div className={styles.row}>
      <div className={styles.balls}>
        {normals.map((n, i) => (
          <NumberBall key={i} number={n} size="sm" dim={dim} winning={winningSet ? winningSet.has(n) : undefined} />
        ))}
        <NumberBall
          number={bonus}
          variant="bonus"
          size="sm"
          dim={dim}
          winning={hasWinningData ? bonus === winningBonusBall : undefined}
        />
      </div>
      <span className={`${styles.pill} ${styles[variant]}`}>{statusLabel}</span>
    </div>
  );
}
