import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/db';
import { megapotService } from '../services/megapotService';

/**
 * Read-only protocol data for the frontend. Deliberately separate from the
 * dormant orders.ts/state.ts/quote.ts (those are pre-existing, unmounted,
 * written against an older schema — left untouched per standing instruction).
 *
 * Split of responsibility with the frontend's own on-chain reads:
 *   - Ticket price / ball ranges / pause flag used to VALIDATE AND BUILD a
 *     buy transaction come from the frontend reading LordsPotState directly
 *     on-chain — authoritative, no backend dependency for the money path.
 *   - Everything here is either a MEGAPOT fact our backend already mirrors
 *     (prize pool, next draw time) or a Postgres aggregate Solana itself
 *     doesn't track (ticket counts, winner breakdowns, a wallet's history).
 */

const router = Router();

function parseWallet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return new PublicKey(raw).toBase58();
  } catch {
    return null;
  }
}

/** Live Megapot-mirrored state — powers the Home hero (prize pool + next draw). */
router.get('/state', async (_req: Request, res: Response) => {
  const state = await prisma.protocolState.findUnique({ where: { id: 'singleton' } });
  if (!state) return res.status(503).json({ error: 'Protocol state not yet synced' });

  // ProtocolState.endedAt already carries the same UI buffer megapotService
  // bakes into a settled MegapotEpoch's endedAt (see EPOCH_END_UI_BUFFER_MS) —
  // so a ticket's countdown target never jumps when its epoch moves from
  // "currently running" to "settled, awaiting reveal": both sides of that
  // transition read from a value padded the same way.
  return res.json({
    isPaused: state.isPaused,
    megapotEpochId: state.currentEpochId,
    nextDrawAt: state.endedAt,
    prizePoolUsdc: (state.prizePoolAmount ?? 0n).toString(),
    maxNormalBall: state.maxNormalBall,
    maxBonusBall: state.maxBonusBall,
  });
});

/** Settled epoch history — powers the Results list. */
router.get('/epochs', async (req: Request, res: Response) => {

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

  const epochs = await prisma.megapotEpoch.findMany({
    where: {
      ...megapotService.revealedEpochWhere(),
      ...(cursor ? { megapotId: { lt: cursor } } : {}),
    },
    orderBy: { megapotId: 'desc' },
    take: limit,
  });


  return res.json({
    epochs: epochs.map((e) => ({
      megapotId: e.megapotId,

      lordsPotTicketCount: e.lordsPotTicketCount,
      totalTicketCount: e.totalTicketCount,

      lordsPotWinnersCount: e.lordsPotWinnersCount,
      totalWinnersCount: e.totalWinnersCount,
   
      totalPaidAmount: (e.totalPaidAmount ?? 0n).toString(),
      lordsPotPaidAmount: (e.lordsPotPaidAmount ?? 0n).toString(),

      jackpot: (e.jackpot).toString(),
      prizeTiers: e.prizeTiers,
   
      topPrizeAmountUsdc: e.topPrizeAmount.toString(),
      topPrizeWinnersCount: e.topPrizeWinnersCount,

      normalMax: e.normalMax,
      bonusMax: e.bonusMax,
      winningNormals: [...e.winningNormals].sort((a, b) => a - b),
      winningBonusBall: e.winningBonusBall,
 
      settledAt: e.drawnAt ?? e.createdAt,
    })),
    
    nextCursor: epochs.length === limit ? epochs[epochs.length - 1].megapotId : null,
  });
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const state = await prisma.protocolState.findUnique({
      where: { id: 'singleton' },
      select: {
        jackpotsWon: true,
        prizesWon: true,
      },
    });

    if (!state) {
      return res.status(404).json({
        ok: false,
        error: 'Protocol state not found',
      });
    }

    // Use nullish coalescing to safely handle null/undefined values
    const jackpotsWon = state.jackpotsWon ?? 0;
    const prizesWon = (state.prizesWon ?? BigInt(0)).toString();

    return res.json({
      jackpotsWon,
      prizesWon,
    });

  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to retrieve stats',
    });
  }
});

const WINNING_STATUSES = ['WON_UNCLAIMED', 'WON_FREE_TICKET', 'CLAIMED_ON_BASE', 'PAID_OUT_ON_SOLANA'] as const;

/**
 * Per-buyer winner breakdown for one epoch — powers the Results detail view.
 * Paginated: the buyer list is a live-computed aggregate (grouped + summed
 * from tickets), not a stable indexed column, so this uses simple limit/offset
 * rather than a cursor — fine at this scale (bounded by tickets-per-epoch,
 * not "all epochs ever").
 */
router.get('/epochs/:megapotId/winners', async (req: Request, res: Response) => {
  const megapotId = Number(req.params.megapotId);
  if (!Number.isInteger(megapotId)) return res.status(400).json({ error: 'Invalid epoch id' });
  if (!(await megapotService.isEpochRevealed(megapotId))) {
    return res.status(404).json({ error: 'Settled epoch not found' });
  }

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const tickets = await prisma.ticket.findMany({
    where: {
      winStatus: { in: [...WINNING_STATUSES] },
      relayOrder: { fulfillEpoch: megapotId, status: 'SUCCESS' },
    },
    select: { winAmount: true, relayOrder: { select: { buyer: true } } },
  });

  const byBuyer = new Map<string, { ticketCount: number; totalUsdc: bigint }>();
  for (const t of tickets) {
    const buyer = t.relayOrder.buyer;
    const entry = byBuyer.get(buyer) ?? { ticketCount: 0, totalUsdc: 0n };
    entry.ticketCount += 1;
    entry.totalUsdc += t.winAmount;
    byBuyer.set(buyer, entry);
  }

  const allWinners = [...byBuyer.entries()]
    .map(([buyer, v]) => ({ buyer, ticketCount: v.ticketCount, totalUsdc: v.totalUsdc.toString() }))
    // Sort by amount desc, buyer asc as a stable tiebreaker (ties on amount
    // would otherwise make offset pagination's ordering nondeterministic).
    .sort((a, b) => {
      const diff = BigInt(b.totalUsdc) > BigInt(a.totalUsdc) ? 1 : BigInt(b.totalUsdc) < BigInt(a.totalUsdc) ? -1 : 0;
      return diff !== 0 ? diff : a.buyer.localeCompare(b.buyer);
    });

  const page = allWinners.slice(offset, offset + limit);
  const nextOffset = offset + page.length < allWinners.length ? offset + page.length : null;

  return res.json({ megapotId, winners: page, nextOffset });
});

/** One buyer's individual tickets for one epoch — powers the Results "winner detail" modal. */
router.get('/epochs/:megapotId/winners/:buyer', async (req: Request, res: Response) => {
  const megapotId = Number(req.params.megapotId);
  if (!Number.isInteger(megapotId)) return res.status(400).json({ error: 'Invalid epoch id' });
  if (!(await megapotService.isEpochRevealed(megapotId))) {
    return res.status(404).json({ error: 'Settled epoch not found' });
  }

  const buyer = parseWallet(req.params.buyer);
  if (!buyer) return res.status(400).json({ error: 'Invalid buyer wallet' });

  const tickets = await prisma.ticket.findMany({
    where: {
      relayOrder: { fulfillEpoch: megapotId, status: 'SUCCESS', buyer },
    },
    select: {
      normalBalls: true,
      bonusBall: true,
      winStatus: true,
      winAmount: true,
      isFreeTicketTier: true,
    },
    orderBy: { id: 'asc' },
  });

  if (tickets.length === 0) return res.status(404).json({ error: 'No tickets found for this buyer in this epoch' });

  return res.json({
    megapotId,
    buyer,
    tickets: tickets.map((t) => ({
      normalBalls: t.normalBalls,
      bonusBall: t.bonusBall,
      winStatus: t.winStatus,
      winAmountUsdc: t.winAmount.toString(),
      isFreeTicketTier: t.isFreeTicketTier,
    })),
  });
});

/**
 * One wallet's ticket history (all epochs, including in-flight), newest first.
 *
 * Ordering: `Ticket.id` is a UUID, so the previous `orderBy: { id: 'desc' }`
 * was effectively ARBITRARY, not newest-first — a long-lived buyer got their
 * history in random order. Real recency lives on the order
 * (`relayOrder.lastBought`), with `id` as a deterministic tiebreaker so paging
 * can never repeat or skip a row when several tickets share one purchase time.
 *
 * Pagination is limit/offset for the same reason as the winners route above:
 * the sort key is a related, non-unique column, which a cursor handles poorly.
 * Bounded per wallet, so offset scanning stays cheap.
 *
 * Backward compatible on purpose — `tickets` keeps its shape and the default
 * page size is the old hard cap, so existing callers are unaffected. `total`
 * and `hasMore` are additive. The old `take: 500` silently truncated with no
 * signal at all; `hasMore` is what makes the truncation visible.
 */
router.get('/tickets', async (req: Request, res: Response) => {
  const wallet = parseWallet(req.query.wallet);
  if (!wallet) return res.status(400).json({ error: 'Invalid or missing wallet' });

  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = { relayOrder: { buyer: wallet } };

  const [total, tickets] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      include: {
        relayOrder: {
          select: { hash: true, signature: true, purchaseEpoch: true, fulfillEpoch: true, status: true, lastBought: true },
        },
      },
      orderBy: [{ relayOrder: { lastBought: 'desc' } }, { id: 'desc' }],
      skip: offset,
      take: limit,
    }),
  ]);

  const epochIds = [...new Set(tickets.map((t) => t.relayOrder.fulfillEpoch).filter((e): e is number => e !== null))];
  const epochs = epochIds.length
    ? await prisma.megapotEpoch.findMany({
        where: { megapotId: { in: epochIds } },
        select: { megapotId: true, endedAt: true, drawnAt: true, winningNormals: true, winningBonusBall: true },
      })
    : [];
  const epochById = new Map(epochs.map((e) => [e.megapotId, e]));

  // Not-yet-revealed epochs (padded endedAt hasn't passed) have their
  // tickets made to look exactly like they haven't been graded yet, even
  // though settlement/harvest may already be done. Same rendering path the
  // frontend already uses for a genuinely-still-pending ticket, so no frontend
  // change is needed for this to work: it just isn't "settled" yet as far as
  // the API is concerned.
  const revealedEpochIds = await megapotService.getRevealedEpochIds();

  return res.json({
    total,
    limit,
    offset,
    hasMore: offset + tickets.length < total,
    tickets: tickets.map((t) => {
      const fulfillEpoch = t.relayOrder.fulfillEpoch;
      const isRevealed = fulfillEpoch === null || revealedEpochIds.has(fulfillEpoch);
      // Looked up unconditionally (not gated on isRevealed) — the row exists
      // the instant a rollover is detected, well before its own reveal buffer
      // clears, and endedAt is just a timestamp, not the drawing's outcome, so
      // it's safe to hand to the frontend early as this ticket's own countdown
      // target. Only the actual result fields below stay gated on isRevealed.
      const epoch = fulfillEpoch !== null ? epochById.get(fulfillEpoch) : undefined;
      return {
        id: t.id,
        normalBalls: t.normalBalls,
        bonusBall: t.bonusBall,
        winStatus: isRevealed ? t.winStatus : 'DRAW_PENDING',
        winAmountUsdc: isRevealed ? t.winAmount.toString() : '0',
        isFreeTicketTier: isRevealed && t.isFreeTicketTier,
        purchaseEpoch: t.relayOrder.purchaseEpoch,
        fulfillEpoch: t.relayOrder.fulfillEpoch,
        orderStatus: t.relayOrder.status,
        purchasedAt: t.relayOrder.lastBought,
        orderHash: t.relayOrder.hash,
        txSignature: t.relayOrder.signature,
        // Per-ticket, not per-order: a large purchase can relay across several
        // Base transactions (chunked — see baseRelayWorker.ts), so different
        // tickets from the same Solana order can carry different Base tx hashes.
        baseTxHash: t.baseTxHash,
        epochEndedAt: epoch?.endedAt ?? null,
        epochSettledAt: isRevealed ? (epoch?.drawnAt ?? null) : null,
        epochWinningNormals: isRevealed ? (epoch?.winningNormals ?? null) : null,
        epochWinningBonusBall: isRevealed ? (epoch?.winningBonusBall ?? null) : null,
      };
    }),
  });
});

export default router;
