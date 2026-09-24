import { prisma } from '../lib/db';
import { megapotService } from '../services/megapotService';
import { onShutdown } from '../lib/shutdown';
import { onEpochSettled, publishEpochGraded } from '../lib/epochEvents';

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
 * pays. winAmount stores the NET payout: gross tier payout minus Megapot's 10%
 * referral win-share, mirroring the claim contract's exact integer math
 * (share = floor(gross × bps/10000), net = gross − share — NOT floor(gross×0.9),
 * which differs by 1 unit on some amounts). That reduction is applied ONCE,
 * upstream, in megapotService.ts's applyReferralShare (used by
 * processPrizeTiers) — epoch.prizeTiers is already net by the time this file
 * reads it, so the `gross` local below is really already-net despite the
 * name. Harvest receipts (TicketWinningsClaimed events) remain the final
 * authority and should reconcile against these values.
 *
 * Free-ticket tiers (tier 1: bonusball only, tier 4: 2 normals no bonus) are
 * marked WON_FREE_TICKET instead of WON_UNCLAIMED — product redeems those as a
 * new ticket rather than a cash payout. Note their net is ticketPrice + 1 unit
 * of floor dust (1111112 − 111111 = 1000001).
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

const POLL_MS = 60_000;             // 1 min
const TICKET_BATCH = 500;
const MAX_BATCHES_PER_EPOCH = 2_000; // runaway guard: 1M tickets/epoch hard stop
const BIG_WIN_ALERT_UNITS = 1_000_000_000n; // $1,000 net (6dp) — page a human, liquidity may be needed

// Tiers redeemed as a free ticket instead of cash: 1 (bonusball only) and
// 4 (2 normals, no bonus). Gross 1111112 is engineered so net ≈ ticketPrice.
const FREE_TICKET_TIERS = new Set([1, 4]);

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
 * Parse our internally formatted prizeTiers JSON into tierId → net payout (6dp base units).
 * THROWS on any shape drift to ensure we never mis-grade tickets.
 */
export function parsePrizeTiers(json: unknown): Map<number, bigint> {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('prizeTiers is not a non-empty array');
  }

  const tiers = new Map<number, bigint>();
  
  for (const entry of json) {
    // 1. Read from our new flattened database structure (camelCase)
    const tierId = entry?.tierId;
    const amount = entry?.amount;

    const numericTierId = Number(tierId);

    // 2. Strict validation on the new shape
    if (!Number.isInteger(numericTierId) || typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      throw new Error(`Malformed prize tier entry: ${JSON.stringify(entry)}`);
    }

    // Note: We removed the `tierId === 2 * normalMatches + ...` check.
    // Why? Because we stripped those fields out of the JSON in MegapotService 
    // to save DB space, and we implicitly trust this data now since we 
    // sanitized and formatted it ourselves before insertion.

    // 3. Map it for the settlement engine
    tiers.set(numericTierId, BigInt(amount));
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

  for (let batch = 0; batch < MAX_BATCHES_PER_EPOCH; batch++) { // * MAX_BATCHES_PER_EPOCH : 2000
    // Only tickets from SUCCESS orders — fulfillEpoch is authoritative for
    // which drawing the tickets actually entered (purchaseEpoch is not).
    const tickets: GradableTicket[] = await prisma.ticket.findMany({
      where: {
        winStatus: 'DRAW_PENDING',
        relayOrder: { fulfillEpoch: epoch.megapotId, status: 'SUCCESS' },
      },
      select: { id: true, normalBalls: true, bonusBall: true },
      take: TICKET_BATCH, // * 500
    });

    if (tickets.length === 0) break;

    // Group by (status, net payout) so a 500-ticket page settles in a handful
    // of updateMany calls (losers are one group; winners share few tiers).
    const losers: string[] = [];
    const winnersByGroup = new Map<
      string,
      { status: 'WON_UNCLAIMED' | 'WON_FREE_TICKET'; amount: bigint; ids: string[] }
    >();

    for (const t of tickets) {
      
      const tierId = calcTierId(t.normalBalls, t.bonusBall, winningSet, epoch.winningBonusBall);
      // `tiers` is built from epoch.prizeTiers, which megapotService's
      // processPrizeTiers already reduced by the 10% referral win-share
      // (applyReferralShare) at ingestion time — so despite the name, this
      // value is already NET, not gross. Do NOT re-apply the reduction here;
      // that would double-deduct. (The old inline referrerShare/net lines that
      // used to live here referenced an undefined REFERRAL_WIN_SHARE_BPS and
      // were always dead — removed rather than left as a landmine.)
      const gross = tiers.get(tierId) ?? 0n;
      if (gross === 0n) {
        losers.push(t.id);
        continue;
      }

      const status = FREE_TICKET_TIERS.has(tierId)
        ? ('WON_FREE_TICKET' as const)
        : ('WON_UNCLAIMED' as const);

      const key = `${status}|${gross}`;
      const group = winnersByGroup.get(key) ?? { status, amount: gross, ids: [] };
      group.ids.push(t.id);
      winnersByGroup.set(key, group);
    }

    await prisma.$transaction([
      ...(losers.length
        ? [prisma.ticket.updateMany({
            where: { id: { in: losers }, winStatus: 'DRAW_PENDING' },
            data: { winStatus: 'LOST' },
          })]
        : []),
      ...[...winnersByGroup.values()].map(({ status, amount, ids }) =>
        prisma.ticket.updateMany({
          where: { id: { in: ids }, winStatus: 'DRAW_PENDING' },
          // isFreeTicketTier must survive past CLAIMED_ON_BASE (where the
          // winStatus distinction is lost) — payout vouchers exclude these.
          data: {
            winStatus: status,
            winAmount: amount,
            isFreeTicketTier: status === 'WON_FREE_TICKET',
          },
        })
      ),
    ]);

    graded += tickets.length;

    for (const { status, amount, ids } of winnersByGroup.values()) {
      winners += ids.length;
      if (status === 'WON_FREE_TICKET') {
        console.log(`[settlement] 🎟️ Epoch ${epoch.megapotId}: ${ids.length} ticket(s) WON A FREE TICKET (${amount} units net each)`);
      } else {
        console.log(`[settlement] 🏆 Epoch ${epoch.megapotId}: ${ids.length} ticket(s) WON ${amount} units each (net of 10% referral share)`);
      }
      if (amount >= BIG_WIN_ALERT_UNITS) {
        console.error(`[ALERT][settlement] BIG WIN in epoch ${epoch.megapotId}: ${amount} units/ticket (net) × ${ids.length} — verify payout liquidity before users claim!`);
      }
    }

    if (tickets.length < TICKET_BATCH) break; // * TICKET_BATCH : 500

    if (batch === MAX_BATCHES_PER_EPOCH - 1) { // * MAX_BATCHES_PER_EPOCH : 2_000
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

  // Nudge harvest so it doesn't wait up to 60s for its own poll — see lib/epochEvents.ts.
  publishEpochGraded(epoch.megapotId);
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

let intervalId: NodeJS.Timeout | null = null;

export function startSettlementWorker(): void {

  if (intervalId) return; // singleton per process

  void runSettlementTick(); // immediate catch-up on boot, don't wait a full interval

  intervalId = setInterval(() => void runSettlementTick(), POLL_MS); // 1 min

  // Cross-process nudge: react the moment megapotService saves a newly
  // settled epoch, instead of waiting for the next poll tick.
  onEpochSettled((megapotId) => {
    console.log(`[settlement] Nudged for epoch ${megapotId} — running early tick.`);
    void runSettlementTick();
  });

  onShutdown('settlement-worker', () => {
    if (intervalId) clearInterval(intervalId);
  });

  console.log(`[settlement] Ticket settlement worker online (every ${POLL_MS / 1000}s)`);
}
