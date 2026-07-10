import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { config } from '../lib/config';
import { megapotService } from '../services/megapotService';
import { QuoteRequest } from '../types';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { tickets, userSolanaAddress, referrers, referralSplitBps }: QuoteRequest =
      req.body;

    if (!tickets || !userSolanaAddress || !referrers || !referralSplitBps) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    const roundState = await megapotService.getRoundState();
    const isPaused = await megapotService.isProtocolPaused();

    if (isPaused) {
      return res.status(503).json({ message: 'Protocol is paused for epoch rollover' });
    }

    if (!roundState) {
      return res.status(404).json({ message: 'No active round found' });
    }

    if (tickets.length === 0) {
      return res.status(400).json({ message: 'No tickets provided' });
    }

    try {
      new PublicKey(userSolanaAddress);
    } catch {
      return res.status(400).json({ message: 'Invalid Solana public key format' });
    }

    if (referrers.length !== 1 || referralSplitBps.length !== 1) {
      return res.status(400).json({
        message: 'Invalid referral structure: exactly one referrer allowed',
      });
    }

    if (referrers[0] !== config.base.rewardWallet) {
      return res.status(400).json({ message: 'Unauthorized referrer wallet' });
    }

    if (referralSplitBps[0] !== 10000) {
      return res.status(400).json({
        message: 'Referral split must be 10000 BPS (100%) for quote validation',
      });
    }

    const { normals_max, bonusball_max, ended_at } = roundState;

    if (megapotService.isRoundLocked(roundState)) {
      return res.status(503).json({ message: 'Round is locked — sales paused' });
    }

    const epochEndTime = new Date(ended_at).getTime();
    if (epochEndTime < Date.now()) {
      return res.status(503).json({ message: 'Current round has ended' });
    }

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];

      if (!ticket.normals || !Array.isArray(ticket.normals)) {
        return res.status(400).json({
          message: `Ticket ${i}: normals must be an array`,
        });
      }

      if (ticket.normals.length !== 5) {
        return res.status(400).json({
          message: `Ticket ${i}: must have exactly 5 normal numbers`,
        });
      }

      if (
        typeof ticket.bonusball !== 'number' ||
        ticket.bonusball < 1 ||
        ticket.bonusball > bonusball_max
      ) {
        return res.status(400).json({
          message: `Ticket ${i}: bonus ball out of bounds (1-${bonusball_max})`,
        });
      }

      for (let j = 0; j < ticket.normals.length; j++) {
        const ball = ticket.normals[j];
        if (typeof ball !== 'number') {
          return res.status(400).json({
            message: `Ticket ${i}: normal ball at index ${j} must be a number`,
          });
        }
        if (ball < 1 || ball > normals_max) {
          return res.status(400).json({
            message: `Ticket ${i}: normal ball ${j} out of bounds (1-${normals_max})`,
          });
        }
        if (j > 0 && ball <= ticket.normals[j - 1]) {
          return res.status(400).json({
            message: `Ticket ${i}: normal balls must be unique and sorted ascending`,
          });
        }
      }
    }

    return res.status(200).json({
      valid: true,
      ticketCount: tickets.length,
      roundState,
    });
  } catch (error) {
    console.error('[quote]', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
