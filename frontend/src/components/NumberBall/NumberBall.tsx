import styles from './NumberBall.module.css';

interface NumberBallProps {
  number: number;
  variant?: 'normal' | 'bonus';
  size?: 'xs' | 'sm' | 'md';
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

export function NumberBall({ number, variant = 'normal', size = 'md', selected, dim, onClick }: NumberBallProps) {
  const classes = [
    styles.ball,
    styles[size],
    variant === 'bonus' ? styles.bonus : styles.normal,
    selected ? styles.selected : '',
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
