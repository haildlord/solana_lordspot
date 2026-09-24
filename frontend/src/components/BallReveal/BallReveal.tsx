import { useEffect, useRef, useState } from 'react';
import { NumberBall } from '../NumberBall/NumberBall';
import { playThud } from '../../lib/sound';
import styles from './BallReveal.module.css';

interface BallRevealProps {
  normals: number[];
  bonus: number;
  onComplete: () => void;
}

const NORMAL_DELAYS = [400, 550, 620, 690, 760];
const BONUS_DELAY = 1500;
const SETTLE_DELAY = 650;

/** Pops the winning numbers in one at a time — each thud heavier than the last, bonus ball slowest of all. */
export function BallReveal({ normals, bonus, onComplete }: BallRevealProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let elapsed = 0;
    const schedule = (delay: number, cb: () => void) => {
      elapsed += delay;
      timeouts.current.push(setTimeout(cb, elapsed));
    };

    normals.forEach((_, i) => {
      schedule(NORMAL_DELAYS[i] ?? 700, () => {
        playThud(i * 0.15);
        setRevealedCount((c) => c + 1);
      });
    });

    schedule(BONUS_DELAY, () => {
      playThud(1);
      setRevealedCount((c) => c + 1);
    });

    schedule(SETTLE_DELAY, onComplete);

    const captured = timeouts.current;
    return () => {
      captured.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.row}>
      {normals.map((n, i) => (
        <div key={i} className={`${styles.slot} ${i < revealedCount ? styles.popped : ''}`}>
          {i < revealedCount ? <NumberBall number={n} size="md" /> : <div className={styles.placeholder} />}
        </div>
      ))}
      <div className={`${styles.slot} ${revealedCount > normals.length ? styles.popped : ''}`}>
        {revealedCount > normals.length ? (
          <NumberBall number={bonus} variant="bonus" size="md" />
        ) : (
          <div className={`${styles.placeholder} ${styles.placeholderBonus}`} />
        )}
      </div>
    </div>
  );
}
