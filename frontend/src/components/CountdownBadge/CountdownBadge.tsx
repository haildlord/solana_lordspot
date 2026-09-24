import { useEffect, useState } from 'react';
import { formatCountdown } from '../../lib/format';
import styles from './CountdownBadge.module.css';

interface CountdownBadgeProps {
  targetIso: string | null;
  label?: string;
}

export function CountdownBadge({ targetIso, label = 'Next draw' }: CountdownBadgeProps) {
  const [text, setText] = useState(() => formatCountdown(targetIso));

  useEffect(() => {
    setText(formatCountdown(targetIso));
    const id = setInterval(() => setText(formatCountdown(targetIso)), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  return (
    <div className={styles.badge}>
      <span className={styles.dot} />
      {label && <span className={styles.label}>{label}:</span>}
      <span className={styles.value}>{text}</span>
    </div>
  );
}
