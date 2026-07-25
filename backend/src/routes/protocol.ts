import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/db';

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
    where: cursor ? { megapotId: { lt: cursor } } : undefined,
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

/** Per-buyer winner breakdown for one epoch — powers the Results detail view. */
router.get('/epochs/:megapotId/winners', async (req: Request, res: Response) => {
  const megapotId = Number(req.params.megapotId);
  if (!Number.isInteger(megapotId)) return res.status(400).json({ error: 'Invalid epoch id' });

  const tickets = await prisma.ticket.findMany({
    where: {
      winStatus: { in: ['WON_UNCLAIMED', 'WON_FREE_TICKET', 'CLAIMED_ON_BASE', 'PAID_OUT_ON_SOLANA'] },
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

  const winners = [...byBuyer.entries()]
    .map(([buyer, v]) => ({ buyer, ticketCount: v.ticketCount, totalUsdc: v.totalUsdc.toString() }))
    .sort((a, b) => (BigInt(b.totalUsdc) > BigInt(a.totalUsdc) ? 1 : -1));

  return res.json({ megapotId, winners });
});

/** One wallet's full ticket history (all epochs, including in-flight). */
router.get('/tickets', async (req: Request, res: Response) => {
  const wallet = parseWallet(req.query.wallet);
  if (!wallet) return res.status(400).json({ error: 'Invalid or missing wallet' });

  const tickets = await prisma.ticket.findMany({
    where: { relayOrder: { buyer: wallet } },
    include: { relayOrder: { select: { purchaseEpoch: true, fulfillEpoch: true, status: true, lastBought: true } } },
    orderBy: { id: 'desc' },
    take: 500,
  });

  return res.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      normalBalls: t.normalBalls,
      bonusBall: t.bonusBall,
      winStatus: t.winStatus,
      winAmountUsdc: t.winAmount.toString(),
      isFreeTicketTier: t.isFreeTicketTier,
      purchaseEpoch: t.relayOrder.purchaseEpoch,
      fulfillEpoch: t.relayOrder.fulfillEpoch,
      orderStatus: t.relayOrder.status,
      purchasedAt: t.relayOrder.lastBought,
    })),
  });
});

export default router;
