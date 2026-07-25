import type { FormatUsdcOptions } from "../api/types";

/** USDC on both Solana and Base is stored as a 6-decimal integer string/bigint. */
const USDC_DECIMALS = 1_000_000;

export function usdcToNumber(raw: string | bigint | number): number {
  const n = typeof raw === 'bigint' ? Number(raw) : typeof raw === 'string' ? Number(raw) : raw;
  return n / USDC_DECIMALS;
}

export function formatUsdc(
  raw: string | bigint | number,
  opts: FormatUsdcOptions = {}
): string {
  let value = usdcToNumber(raw);

  const fractionDigits = opts.decimals ?? 2;

  // 1. Truncate (floor) down to exact decimal precision — NO ROUNDING UP
  const factor = Math.pow(10, fractionDigits);
  value = Math.floor(value * factor) / factor;

  // 2. Format string with exact fixed decimals
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  if (opts.withSign && value > 0) return `+$${formatted}`;
  return `$${formatted}`;
}


export function formatDollarAmount(raw: string | number): string {
  // Converts to number, adds commas, and prepends $ without dividing
  return `$${Number(raw).toLocaleString('en-US')}`;
}

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function formatCountdown(targetIso: string | null): string {
  if (!targetIso) return '--:--:--';
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return 'DRAWING NOW';

  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
