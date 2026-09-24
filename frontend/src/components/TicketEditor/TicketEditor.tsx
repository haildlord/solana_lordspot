import { NumberBall } from '../NumberBall/NumberBall';
import { isTicketComplete, type StagedTicket } from '../../solana/ticketUtils';
import styles from './TicketEditor.module.css';

export function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

interface TicketEditorProps {
  tickets: StagedTicket[];
  normalMax: number;
  bonusMax: number;
  expandedIndex: number | null;
  onExpand: (index: number | null) => void;
  onToggleNormal: (index: number, n: number) => void;
  onToggleBonus: (index: number, n: number) => void;
  onShuffleTicket: (index: number) => void;
  onClearTicket: (index: number) => void;
  onRemoveTicket: (index: number) => void;
  onShuffleAll: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

/** Shared editor for the whole staged batch — opened via a ticket's "Choose
 * Numbers" action (or the panel header itself). One ticket can be expanded
 * into its own ball-picker grid at a time; the rest stay as compact rows. */
export function TicketEditor({
  tickets,
  normalMax,
  bonusMax,
  expandedIndex,
  onExpand,
  onToggleNormal,
  onToggleBonus,
  onShuffleTicket,
  onClearTicket,
  onRemoveTicket,
  onShuffleAll,
  onClearAll,
  onClose,
}: TicketEditorProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Edit tickets</span>
        <div className={styles.panelActions}>
          <button type="button" className={styles.iconButton} onClick={onClearAll} aria-label="Clear all tickets">
            <ClearIcon />
          </button>
          <button type="button" className={styles.iconButton} onClick={onShuffleAll} aria-label="Quick pick all tickets">
            <RefreshIcon />
          </button>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close editor">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className={styles.rows}>
        {tickets.map((t, i) => {
          const complete = isTicketComplete(t, normalMax, bonusMax);
          const blank = t.normals.length === 0 && t.bonus === null;
          const isExpanded = expandedIndex === i;

          return (
            <div key={i} className={styles.rowWrap}>
              <div className={styles.row}>
                {blank ? (
                  <button
                    type="button"
                    className={styles.quickFillRow}
                    onClick={() => onShuffleTicket(i)}
                    aria-label="Quick pick this ticket"
                  >
                    <span className={styles.quickFillButton}>
                      <RefreshIcon />
                    </span>
                    <span className={styles.quickFillLabel}>Quick pick this ticket</span>
                  </button>
                ) : (
                  <div className={styles.rowBalls}>
                    {Array.from({ length: 5 }, (_, j) => t.normals[j]).map((n, j) =>
                      n === undefined ? (
                        <div key={j} className={styles.emptySlot} />
                      ) : (
                        <NumberBall key={j} number={n} size="xs" />
                      )
                    )}
                    {t.bonus === null ? (
                      <div className={`${styles.emptySlot} ${styles.emptySlotBonus}`} />
                    ) : (
                      <NumberBall number={t.bonus} variant="bonus" size="xs" />
                    )}
                  </div>
                )}

                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${isExpanded ? styles.iconButtonActive : ''}`}
                    onClick={() => onExpand(isExpanded ? null : i)}
                    aria-label="Edit numbers"
                  >
                    <EditIcon />
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => onShuffleTicket(i)} aria-label="Shuffle this ticket">
                    <RefreshIcon />
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => onClearTicket(i)} aria-label="Clear this ticket">
                    <ClearIcon />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                    onClick={() => onRemoveTicket(i)}
                    aria-label="Remove this ticket"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className={styles.expandedGrid}>
                  <div className={styles.grid}>
                    {Array.from({ length: normalMax }, (_, k) => k + 1).map((n) => (
                      <NumberBall
                        key={n}
                        number={n}
                        size="xs"
                        selected={t.normals.includes(n)}
                        onClick={() => onToggleNormal(i, n)}
                      />
                    ))}
                  </div>
                  <div className={styles.grid}>
                    {Array.from({ length: bonusMax }, (_, k) => k + 1).map((n) => (
                      <NumberBall
                        key={n}
                        number={n}
                        variant="bonus"
                        size="xs"
                        selected={t.bonus === n}
                        onClick={() => onToggleBonus(i, n)}
                      />
                    ))}
                  </div>
                  {complete && <p className={styles.completeHint}>Ticket complete — pick a different number to change it.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
