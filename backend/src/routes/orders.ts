import { Router, Request, Response } from 'express';
import { prisma } from '../lib/db';
import { OrderStatus } from '../../generated/prisma/client';

const router = Router();

router.get('/:signature', async (req: Request, res: Response) => {
  const signature = String(req.params.signature);

  const order = await prisma.relayOrder.findUnique({
    where: { signature },
    include: {
      tickets: true,
      attempts: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const fulfilled = order.status === 'SUCCESS';

  return res.json({
    status: order.status,
    orderId: order.hash,
    proofs: {
      solana: {
        signature: order.signature,
        explorer: `https://solscan.io/tx/${order.signature}`,
        buyer: order.buyer,
        amountUsdc: order.amountUsdc.toString(),
        epoch: order.purchaseEpoch,
      },
      base: fulfilled
        ? {
            txHash: order.baseTxHash,
            explorer: `https://basescan.org/tx/${order.baseTxHash}`,
            orderId: order.hash,
            megapotTicketIds: order.megapotTicketIds.map(String),
            fulfillEpoch: order.fulfillEpoch,
          }
        : null,
    },
    tickets: order.tickets.map((t) => ({
      normalBalls: t.normalBalls,
      bonusBall: t.bonusBall,
      megapotNftId: t.megapotNftId,
      winStatus: t.winStatus,
    })),
    attempts: order.attempts,
    lastError: order.lastError,
  });
});

router.get('/buyer/:pubkey', async (req: Request, res: Response) => {
  const pubkey = String(req.params.pubkey);

  const orders = await prisma.relayOrder.findMany({
    where: { buyer: pubkey },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      signature: true,
      hash: true,
      status: true,
      ticketCount: true,
      baseTxHash: true,
      createdAt: true,
    },
  });
  return res.json({ orders });
});

export default router;
