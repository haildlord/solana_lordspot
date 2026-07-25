import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useClaimSummary } from '../../api/hooks';
import styles from './Navbar.module.css';

const MEGAPOT_LOGO = '/megapot.avif';

const LINKS = [
  { path: '/', label: 'Play' },
  { path: '/tickets', label: 'Tickets' },
  { path: '/winnings', label: 'Winnings' },
  { path: '/results', label: 'Results' },
];

export function Navbar() {
  const location = useLocation();
  const { connected } = useWallet();
  const { data: summary } = useClaimSummary();
  const [menuOpen, setMenuOpen] = useState(false);

  const hasClaimable = connected && summary && (Number(summary.claimableUsdc) > 0 || summary.freeTickets > 0);

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
    
      <div className={styles.logoWrapper}>
        
        {/* Link 1: Internal Route for Lordspot */}
        <Link to="/" className={styles.logoLink} onClick={() => setMenuOpen(false)}>
          <div className={styles.logo}>
            <span className={styles.logoBase}>LORDS</span><span className={styles.logoAccent}>POT</span>
          </div>
        </Link>

        {/* Link 2: External Link for Megapot */}
        <a 
          href="https://megapot.io/play" 
          target="_blank" 
          rel="noopener noreferrer" 
          className={styles.poweredByBadge}
        >
          <span className={styles.poweredByText}>Powered by</span> 
          <img 
            src={MEGAPOT_LOGO} 
            alt="Megapot" 
            className={styles.poweredByLogo}
          />
        </a>
      </div>

        <nav className={styles.links}>
          {LINKS.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`${styles.link} ${location.pathname === link.path ? styles.linkActive : ''}`}
            >
              {link.label}
              {link.path === '/winnings' && hasClaimable && <span className={styles.dot} />}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <WalletMultiButton />
          <button
            className={styles.menuToggle}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span className={menuOpen ? styles.iconOpen : styles.iconClosed} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className={styles.mobileMenu}>
          {LINKS.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`${styles.mobileLink} ${location.pathname === link.path ? styles.linkActive : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
              {link.path === '/winnings' && hasClaimable && <span className={styles.dot} />}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
