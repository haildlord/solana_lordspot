import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { megapotService } from '../services/megapotService';

const router = Router();

function formatProtocol(protocol: {
  isPaused: boolean;
  currentEpochId: number | null;
  endedAt: Date | null;
  maxNormalBall: number | null;
  maxBonusBall: number | null;
  prizePoolAmount: bigint | null;
  prizePoolDecimals: number | null;
}) {
  return {
    isPaused: protocol.isPaused,
    currentEpochId: protocol.currentEpochId,
    ended_at: protocol.endedAt?.toISOString() ?? null,
    ball_pool: {
      normals_max: protocol.maxNormalBall,
      bonusball_max: protocol.maxBonusBall,
    },
    prize_pool: protocol.prizePoolAmount
      ? {
          amount: protocol.prizePoolAmount.toString(),
          decimals: protocol.prizePoolDecimals ?? 6,
        }
      : null,
  };
}

function formatSettledEpoch(epoch: {
  megapotId: number;
  ticketCount: number;
  uniqueParticipants: number;
  winnersCount: number;
  topPrizeAmount: bigint;
  topPrizeDecimals: number;
  topPrizeWinnersCount: number;
  lpEarningsAmount: bigint;
  lpEarningsDecimals: number;
  winningNormals: number[];
  winningBonusBall: number;
  prizeTiers: unknown;
}) {
  return {
    id: String(epoch.megapotId),
    ticket_count: epoch.ticketCount,
    unique_participants: epoch.uniqueParticipants,
    winners_count: epoch.winnersCount,
    top_prize_amount: {
      amount: epoch.topPrizeAmount.toString(),
      decimals: epoch.topPrizeDecimals,
    },
    top_prize_winners_count: epoch.topPrizeWinnersCount,
    lp_earnings: {
      amount: epoch.lpEarningsAmount.toString(),
      decimals: epoch.lpEarningsDecimals,
    },
    winning_numbers: {
      normals: epoch.winningNormals,
      bonusball: epoch.winningBonusBall,
    },
    prize_tiers: epoch.prizeTiers,
  };
}

/** Frontend: live protocol state (current epoch for ticket picker) */
router.get('/', async (_req: Request, res: Response) => {
  const protocol = await prisma.protocolState.findUnique({
    where: { id: 'singleton' },
  });

  if (!protocol) {
    return res.status(503).json({ error: 'Protocol state not ready' });
  }

  const round = await megapotService.getRoundState();

  return res.json({
    ...formatProtocol(protocol),
    round,
  });
});

/** Settled epoch history (newest first) */
router.get('/epochs', async (req: Request, res: Response) => {
  const take = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);

  const epochs = await prisma.megapotEpoch.findMany({
    orderBy: { megapotId: 'desc' },
    take,
  });

  return res.json({
    epochs: epochs.map(formatSettledEpoch),
  });
});

/** Single settled epoch by Megapot id */
router.get('/epochs/:id', async (req: Request, res: Response) => {
  const megapotId = parseInt(String(req.params.id), 10);
  if (Number.isNaN(megapotId)) {
    return res.status(400).json({ error: 'Invalid epoch id' });
  }

  const epoch = await prisma.megapotEpoch.findUnique({ where: { megapotId } });
  if (!epoch) {
    return res.status(404).json({ error: 'Settled epoch not found' });
  }

  return res.json(formatSettledEpoch(epoch));
});

export default router;
