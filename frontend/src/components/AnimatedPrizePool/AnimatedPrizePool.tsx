import { useEffect, useState } from 'react';
import { motion, animate } from 'framer-motion';
import styles from './AnimatedPrizePool.module.css';

interface AnimatedPrizePoolProps {
  value: number;
  label?: string;
}

/** Spring count-up to the live prize pool, with a pop-on-arrival and a few drifting sparkles — the "wow" moment of the homepage. */
export function AnimatedPrizePool({ value, label = 'UP FOR GRABS' }: AnimatedPrizePoolProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [popScale, setPopScale] = useState(1);

  useEffect(() => {
    const controls = animate(displayValue, value, {
      type: 'spring',
      stiffness: 55,
      damping: 14,
      onUpdate: (latest) => setDisplayValue(Math.floor(latest)),
      onComplete: () => {
        setPopScale(1.08);
        setTimeout(() => setPopScale(1), 380);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const formatted = displayValue.toLocaleString('en-US');

  return (
    <div className={styles.wrap}>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={styles.labelRow}
      >
        <span className={styles.line} />
        <span className={styles.label}>{label}</span>
        <span className={styles.line} />
      </motion.div>

      <motion.h1
        animate={{ scale: popScale }}
        transition={{ type: 'spring', stiffness: 400, damping: 14 }}
        className={styles.valueContainer}
      >
        {/* Layer 1: The 3D Shadows */}
        <span className={styles.valueShadow}>{`$${formatted}`}</span>
        
        {/* Layer 2: Your exact Gold Gradient */}
        <span className={styles.valueGradient}>{`$${formatted}`}</span>
      </motion.h1>
    </div>
  );
}
