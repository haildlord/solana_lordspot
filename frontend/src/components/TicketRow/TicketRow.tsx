import { NumberBall } from '../NumberBall/NumberBall';
import styles from './TicketRow.module.css';

export type TicketRowVariant = 'win' | 'free' | 'pending' | 'loss' | 'neutral';

interface TicketRowProps {
  normals: number[];
  bonus: number;
  statusLabel: string;
  variant: TicketRowVariant;
}

/** One ticket's numbers + a status pill — shared by the Tickets and Results pages. */
export function TicketRow({ normals, bonus, statusLabel, variant }: TicketRowProps) {
  const dim = variant === 'loss';

  return (
    <div className={`${styles.row} ${variant === 'win' ? styles.rowWin : ''}`}>
      <div className={styles.balls}>
        {normals.map((n, i) => (
          <NumberBall key={i} number={n} size="sm" dim={dim} />
        ))}
        <NumberBall number={bonus} variant="bonus" size="sm" dim={dim} />
      </div>
      <span className={`${styles.pill} ${styles[variant]}`}>{statusLabel}</span>
    </div>
  );
}
