import styles from './NumberBall.module.css';

interface NumberBallProps {
  number: number;
  variant?: 'normal' | 'bonus';
  size?: 'xs' | 'sm' | 'md';
  /** Actively being picked right now (Home's ticket editor grid) — a violet
   * ring. Distinct from `winning`: the two never appear in the same view. */
  selected?: boolean;
  /** This ball matched the drawn numbers (Tickets/Results) — glows green for
   * a normal-ball match, purple for the bonus-ball match. */
  winning?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

export function NumberBall({ number, variant = 'normal', size = 'md', selected, winning, dim, onClick }: NumberBallProps) {
  const classes = [
    styles.ball,
    styles[size],
    variant === 'bonus' ? styles.bonus : styles.normal,
    selected ? styles.selected : '',
    winning ? styles.winning : '',
    dim ? styles.dim : '',
    onClick ? styles.clickable : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {number}
      </button>
    );
  }

  return <div className={classes}>{number}</div>;
}
