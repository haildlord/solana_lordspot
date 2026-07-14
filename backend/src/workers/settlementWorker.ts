import { prisma } from '../lib/db';
import { megapotService } from '../services/megapotService';
import { onShutdown } from '../lib/shutdown';

/**
 * The SETTLEMENT pass — third poller alongside the confirmer.
 *
 * When an epoch lands in MegapotEpoch (settled, with drawing data), every
 * DRAW_PENDING ticket fulfilled in that epoch is graded against the winning
 * numbers + prizeTiers and moved to LOST or WON_UNCLAIMED. Grading mirrors
 * Megapot's on-chain _calculateTicketTierId exactly:
 *
 *     tierId = 2 * normalMatches + (bonusballMatch ? 1 : 0)
 *
 * "Won" means payout > 0, NEVER "matched something" — real tier tables pay 0
 * on some matching tiers (e.g. 1 normal + no bonus) while 0-normals+bonusball
 * pays. winAmount stores the GROSS tier payout; the net (after Megapot's
 * referral win-share skim) is only knowable at harvest time from the
 * TicketWinningsClaimed event and is recorded by that later phase.
 *
 * Durability: MegapotEpoch.ticketsSettledAt is the watermark — NULL rows are
 * unfinished work, set only after every ticket left DRAW_PENDING. A server
 * down across N rollovers heals itself: boot backfill inserts the missed
 * epochs (ticketsSettledAt NULL), and healMissingEpochs() re-fetches any epoch
 * that has pending tickets but no MegapotEpoch row at all (drawing data posted
 * late, transition-time fetch failed, etc.).
 *
 * Safety: every ticket update is guarded by `winStatus: DRAW_PENDING`, so the
 * pass is idempotent, re-runnable, safe to run concurrently from the worker
 * AND cron processes, and can never regress a CLAIMED/PAID ticket. A malformed
 * prizeTiers payload aborts that epoch loudly instead of grading against a
 * misread table — the failure mode "winner marked LOST" must be impossible.
 */

const POLL_MS = 60_000;
const TICKET_BATCH = 500;
const MAX_BATCHES_PER_EPOCH = 2_000; // runaway guard: 1M tickets/epoch hard stop
const BIG_WIN_ALERT_UNITS = 1_000_000_000n; // $1,000 (6dp) — page a human, liquidity may be needed

interface GradableTicket {
  id: string;
  normalBalls: number[];
  bonusBall: number;
}

/** Mirror of Megapot's _calculateTicketTierId (see contract: 2*(matches-bonus)+bonus). */
export function calcTierId(
  normalBalls: number[],
  bonusBall: number,
  winningNormals: Set<number>,
  winningBonusBall: number
): number {
  let matches = 0;
  for (const ball of normalBalls) {
    if (winningNormals.has(ball)) matches++;
  }
  return 2 * matches + (bonusBall === winningBonusBall ? 1 : 0);
}

/**
 * Parse prizeTiers JSON into tierId → gross payout (6dp base units).
 * THROWS on any shape drift — including a tier_id that contradicts its own
 * normal_matches/bonusball_match fields — so a silent API format change can
 * never mis-grade tickets.
 */
export function parsePrizeTiers(json: unknown): Map<number, bigint> {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('prizeTiers is not a non-empty array');
  }

  const tiers = new Map<number, bigint>();
  for (const entry of json) {
    const tierId = entry?.tier_id;
    const amount = entry?.payout?.amount;
    const normalMatches = entry?.normal_matches;
    const bonusMatch = entry?.bonusball_match;

    if (!Number.isInteger(tierId) || typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      throw new Error(`Malformed prize tier entry: ${JSON.stringify(entry)}`);
    }
    if (tierId !== 2 * normalMatches + (bonusMatch ? 1 : 0)) {
      throw new Error(
        `Tier encoding mismatch: tier_id=${tierId} but normal_matches=${normalMatches}, bonusball_match=${bonusMatch}`
      );
    }
    tiers.set(tierId, BigInt(amount));
  }
  return tiers;
}

/** Grade every DRAW_PENDING ticket of one settled epoch. Returns true when fully settled. */
async function settleEpoch(epoch: {
  megapotId: number;
  winningNormals: number[];
  winningBonusBall: number;
  prizeTiers: unknown;
}): Promise<boolean> {
  let tiers: Map<number, bigint>;
  try {
    tiers = parsePrizeTiers(epoch.prizeTiers);
  } catch (err: any) {
    // Do NOT grade against a table we can't trust — leaving the epoch
    // unsettled (watermark NULL) is the safe state; it retries every tick.
    console.error(`[ALERT][settlement] Epoch ${epoch.megapotId} has unusable prizeTiers — refusing to grade. ${err?.message ?? err}`);
    return false;
  }

  const winningSet = new Set(epoch.winningNormals);
  let graded = 0;
  let winners = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_EPOCH; batch++) {
    // Only tickets from SUCCESS orders — fulfillEpoch is authoritative for
    // which drawing the tickets actually entered (purchaseEpoch is not).
    const tickets: GradableTicket[] = await prisma.ticket.findMany({
      where: {
        winStatus: 'DRAW_PENDING',
        relayOrder: { fulfillEpoch: epoch.megapotId, status: 'SUCCESS' },
      },
      select: { id: true, normalBalls: true, bonusBall: true },
      take: TICKET_BATCH,
    });
    if (tickets.length === 0) break;

    // Group by payout so a 500-ticket page settles in a handful of updateMany
    // calls (losers are one group; winners share few distinct tier amounts).
    const losers: string[] = [];
    const winnersByAmount = new Map<bigint, string[]>();

    for (const t of tickets) {
      const tierId = calcTierId(t.normalBalls, t.bonusBall, winningSet, epoch.winningBonusBall);
      const payout = tiers.get(tierId) ?? 0n;
      if (payout > 0n) {
        const group = winnersByAmount.get(payout) ?? [];
        group.push(t.id);
        winnersByAmount.set(payout, group);
      } else {
        losers.push(t.id);
      }
    }

    await prisma.$transaction([
      ...(losers.length
        ? [prisma.ticket.updateMany({
            where: { id: { in: losers }, winStatus: 'DRAW_PENDING' },
            data: { winStatus: 'LOST' },
          })]
        : []),
      ...[...winnersByAmount.entries()].map(([amount, ids]) =>
        prisma.ticket.updateMany({
          where: { id: { in: ids }, winStatus: 'DRAW_PENDING' },
          data: { winStatus: 'WON_UNCLAIMED', winAmount: amount },
        })
      ),
    ]);

    graded += tickets.length;
    for (const [amount, ids] of winnersByAmount) {
      winners += ids.length;
      console.log(`[settlement] 🏆 Epoch ${epoch.megapotId}: ${ids.length} ticket(s) WON ${amount} units each (gross)`);
      if (amount >= BIG_WIN_ALERT_UNITS) {
        console.error(`[ALERT][settlement] BIG WIN in epoch ${epoch.megapotId}: ${amount} units/ticket × ${ids.length} — verify payout liquidity before users claim!`);
      }
    }

    if (tickets.length < TICKET_BATCH) break;

    if (batch === MAX_BATCHES_PER_EPOCH - 1) {
      console.error(`[ALERT][settlement] Epoch ${epoch.megapotId} exceeded ${MAX_BATCHES_PER_EPOCH} batches — leaving unsettled, will resume next tick.`);
      return false;
    }
  }

  // Watermark LAST: a crash anywhere above just re-runs — settled tickets have
  // left the DRAW_PENDING filter, so re-runs converge instead of redoing work.
  await prisma.megapotEpoch.update({
    where: { megapotId: epoch.megapotId },
    data: { ticketsSettledAt: new Date() },
  });

  console.log(`[settlement] Epoch ${epoch.megapotId} settled: ${graded} ticket(s) graded, ${winners} winner(s).`);
  return true;
}

/**
 * Gap healer: epochs whose tickets are still DRAW_PENDING but that have no
 * MegapotEpoch row (server down across the rollover AND boot backfill hasn't
 * covered it, or the drawing data was posted late). Fetches them on demand.
 * Driving the scan from the Ticket side keeps it cheap forever — the
 * DRAW_PENDING set shrinks to ~zero once settlement is caught up.
 */
async function healMissingEpochs(): Promise<void> {
  const pendingEpochs = await prisma.$queryRaw<{ fulfillEpoch: number }[]>`
    SELECT DISTINCT ro."fulfillEpoch"
    FROM "Ticket" t
    JOIN "RelayOrder" ro ON ro.hash = t."orderHash"
    WHERE t."winStatus" = 'DRAW_PENDING'
      AND ro.status = 'SUCCESS'
      AND ro."fulfillEpoch" IS NOT NULL
  `;
  if (pendingEpochs.length === 0) return;

  const current = await megapotService.getRoundState(); // null-safe: upsert itself refuses non-settled rounds

  for (const { fulfillEpoch } of pendingEpochs) {
    if (current && fulfillEpoch >= current.id) continue; // still the live drawing — nothing to settle yet

    const exists = await prisma.megapotEpoch.count({ where: { megapotId: fulfillEpoch } });
    if (exists > 0) continue;

    console.log(`[settlement] Epoch ${fulfillEpoch} has pending tickets but no settled row — fetching from Megapot...`);
    await megapotService.ensureSettledEpochSynced(fulfillEpoch);
  }
}

/** Ops visibility: SUCCESS orders that can never settle because fulfillEpoch was lost. */
async function warnUnsettleableOrders(): Promise<void> {
  const count = await prisma.relayOrder.count({
    where: {
      status: 'SUCCESS',
      fulfillEpoch: null,
      tickets: { some: { winStatus: 'DRAW_PENDING' } },
    },
  });
  if (count > 0) {
    console.error(`[ALERT][settlement] ${count} SUCCESS order(s) have NULL fulfillEpoch — their tickets cannot be graded. Backfill fulfillEpoch manually (from the Base tx block time / TicketPurchased events).`);
  }
}

let tickInFlight = false;

export async function runSettlementTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await healMissingEpochs();

    const unsettled = await prisma.megapotEpoch.findMany({
      where: { ticketsSettledAt: null },
      orderBy: { megapotId: 'asc' },
      select: { megapotId: true, winningNormals: true, winningBonusBall: true, prizeTiers: true },
    });

    for (const epoch of unsettled) {
      await settleEpoch(epoch);
    }

    await warnUnsettleableOrders();
  } catch (err) {
    console.error('[settlement] Tick failed:', err);
  } finally {
    tickInFlight = false;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startSettlementWorker(): void {
  if (intervalHandle) return; // singleton per process

  void runSettlementTick(); // immediate catch-up on boot, don't wait a full interval

  intervalHandle = setInterval(() => void runSettlementTick(), POLL_MS);

  onShutdown('settlement-worker', () => {
    if (intervalHandle) clearInterval(intervalHandle);
  });

  console.log(`[settlement] Ticket settlement worker online (every ${POLL_MS / 1000}s)`);
}
