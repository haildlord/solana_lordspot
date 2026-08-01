import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from '../src/lib/config';

/**
 * One-off, idempotent UI fixture seeder — NOT part of the app runtime.
 * Populates every Tickets/Winnings visual state for one wallet, using the
 * caller's own already-settled MegapotEpoch rows (relative to currentEpochId)
 * so it works against whatever epoch history is actually in this DB.
 *
 * Run: npx tsx scripts/seed_mock_ui_data.ts   (from backend/)
 */

const adapter = new PrismaPg({ connectionString: config.databaseUrl });
const prisma = new PrismaClient({ adapter });

const WALLET = 'H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY';

function fakeSig(seed: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let out = '';
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 88; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += chars[x % chars.length];
  }
  return out;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** Builds a 5-ball + bonus set for an epoch, controlling how many winning balls it matches. */
function craftBalls(
  epoch: { winningNormals: number[]; winningBonusBall: number; normalMax: number | null; bonusMax: number | null },
  matchCount: number,
  matchBonus: boolean
) {
  const normalMax = epoch.normalMax ?? 30;
  const bonusMax = epoch.bonusMax ?? 10;
  const winSet = new Set(epoch.winningNormals);
  const matched = epoch.winningNormals.slice(0, matchCount);
  const fillers: number[] = [];
  for (let n = 1; n <= normalMax && fillers.length < 5 - matchCount; n++) {
    if (!winSet.has(n) && !matched.includes(n)) fillers.push(n);
  }
  const normalBalls = [...matched, ...fillers].slice(0, 5).sort((a, b) => a - b);
  const bonusBall = matchBonus ? epoch.winningBonusBall : epoch.winningBonusBall === 1 ? Math.min(2, bonusMax) : 1;
  return { normalBalls, bonusBall };
}

async function makeOrder(opts: {
  tag: string;
  purchaseEpoch: number;
  fulfillEpoch: number;
  ticketCount: number;
  lastBought: Date;
}) {
  const hash = `mock-ui-order-${opts.tag}`;
  await prisma.relayOrder.upsert({
    where: { hash },
    create: {
      hash,
      signature: fakeSig(hash),
      buyer: WALLET,
      purchaseEpoch: opts.purchaseEpoch,
      fulfillEpoch: opts.fulfillEpoch,
      amountUsdc: BigInt(opts.ticketCount) * 1_000_000n,
      ticketCount: opts.ticketCount,
      lastBought: opts.lastBought,
      status: 'SUCCESS',
    },
    update: { lastBought: opts.lastBought },
  });
  return hash;
}

async function makeTicket(opts: {
  tag: string;
  orderHash: string;
  normalBalls: number[];
  bonusBall: number;
  winStatus: string;
  winAmount: bigint;
  isFreeTicketTier?: boolean;
  harvestBatchId?: string | null;
  payoutClaimId?: string | null;
}) {
  const id = `mock-ui-ticket-${opts.tag}`;
  const data = {
    orderHash: opts.orderHash,
    normalBalls: opts.normalBalls,
    bonusBall: opts.bonusBall,
    winStatus: opts.winStatus as never,
    winAmount: opts.winAmount,
    isFreeTicketTier: opts.isFreeTicketTier ?? false,
    harvestBatchId: opts.harvestBatchId ?? null,
    payoutClaimId: opts.payoutClaimId ?? null,
  };
  await prisma.ticket.upsert({ where: { id }, create: { id, ...data }, update: data });
}

async function makeHarvestBatch(tag: string, megapotId: number, amountGross: bigint) {
  const id = `mock-ui-harvest-${tag}`;
  await prisma.harvestBatch.upsert({
    where: { id },
    create: {
      id,
      megapotId,
      txHash: fakeSig(id),
      status: 'CONFIRMED',
      amountGross,
      confirmedAt: daysAgo(1),
    },
    update: {},
  });
  return id;
}

async function makePayoutClaim(tag: string, status: 'PENDING' | 'CONFIRMED', amountUsdc: bigint, createdAt: Date) {
  const id = `mock-ui-claim-${tag}`;
  await prisma.payoutClaim.upsert({
    where: { id },
    create: {
      id,
      wallet: WALLET,
      amountUsdc,
      status: status as never,
      txSignature: fakeSig(id),
      lastValidBlockHeight: 999_999_999n,
      createdAt,
      confirmedAt: status === 'CONFIRMED' ? daysAgo(1) : null,
    },
    update: { status: status as never },
  });
  return id;
}

async function main() {
  const protocolState = await prisma.protocolState.findUnique({ where: { id: 'singleton' } });
  if (!protocolState?.currentEpochId) {
    throw new Error('ProtocolState.currentEpochId is not set — seed the current epoch first.');
  }
  const current = protocolState.currentEpochId;

  // Epoch offsets from the current (upcoming) epoch. All must already exist
  // as settled MegapotEpoch rows except `current` itself.
  const EPOCH = {
    upcoming: current,
    grading: current - 1,
    wonUnclaimed: current - 2,
    wonFreePreHarvest: current - 3,
    wonClaimableNow: current - 4,
    wonPaidOut: current - 5,
    lost: current - 6,
    wonPendingVoucher: current - 7,
    wonFreeRedeemable: current - 8,
  };

  const settledIds = Object.values(EPOCH).filter((e) => e !== EPOCH.upcoming);
  const epochs = await prisma.megapotEpoch.findMany({ where: { megapotId: { in: settledIds } } });
  const byId = new Map(epochs.map((e) => [e.megapotId, e]));
  for (const id of settledIds) {
    if (!byId.has(id)) throw new Error(`MegapotEpoch ${id} not found — need settled epochs current-1..current-8 to exist.`);
  }

  // 1. Upcoming — two separate purchases, same draw, still pending.
  const upA = await makeOrder({ tag: 'up-a', purchaseEpoch: EPOCH.upcoming, fulfillEpoch: EPOCH.upcoming, ticketCount: 1, lastBought: daysAgo(0) });
  await makeTicket({ tag: 'up-a', orderHash: upA, normalBalls: [3, 6, 9, 14, 15], bonusBall: 4, winStatus: 'DRAW_PENDING', winAmount: 0n });
  const upB = await makeOrder({ tag: 'up-b', purchaseEpoch: EPOCH.upcoming, fulfillEpoch: EPOCH.upcoming, ticketCount: 1, lastBought: daysAgo(0) });
  await makeTicket({ tag: 'up-b', orderHash: upB, normalBalls: [2, 8, 19, 21, 27], bonusBall: 7, winStatus: 'DRAW_PENDING', winAmount: 0n });

  // 2. Grading — epoch settled, ticket not graded yet.
  const gradingEpoch = byId.get(EPOCH.grading)!;
  const gradeOrder = await makeOrder({ tag: 'grading', purchaseEpoch: EPOCH.grading, fulfillEpoch: EPOCH.grading, ticketCount: 1, lastBought: daysAgo(1) });
  const gradeBalls = craftBalls(gradingEpoch, 2, false);
  await makeTicket({ tag: 'grading', orderHash: gradeOrder, ...gradeBalls, winStatus: 'DRAW_PENDING', winAmount: 0n });

  // 3. Won, cash, unclaimed (pre-harvest).
  const unclaimedEpoch = byId.get(EPOCH.wonUnclaimed)!;
  const unclaimedOrder = await makeOrder({ tag: 'unclaimed', purchaseEpoch: EPOCH.wonUnclaimed, fulfillEpoch: EPOCH.wonUnclaimed, ticketCount: 3, lastBought: daysAgo(2) });
  await makeTicket({ tag: 'unclaimed-win', orderHash: unclaimedOrder, ...craftBalls(unclaimedEpoch, 4, true), winStatus: 'WON_UNCLAIMED', winAmount: 4_250_000n });
  await makeTicket({ tag: 'unclaimed-loss-1', orderHash: unclaimedOrder, ...craftBalls(unclaimedEpoch, 0, false), winStatus: 'LOST', winAmount: 0n });
  await makeTicket({ tag: 'unclaimed-loss-2', orderHash: unclaimedOrder, ...craftBalls(unclaimedEpoch, 1, false), winStatus: 'LOST', winAmount: 0n });

  // 4. Won, free ticket, pre-harvest.
  const freePreEpoch = byId.get(EPOCH.wonFreePreHarvest)!;
  const freePreOrder = await makeOrder({ tag: 'free-pre', purchaseEpoch: EPOCH.wonFreePreHarvest, fulfillEpoch: EPOCH.wonFreePreHarvest, ticketCount: 2, lastBought: daysAgo(3) });
  await makeTicket({ tag: 'free-pre-win', orderHash: freePreOrder, ...craftBalls(freePreEpoch, 2, true), winStatus: 'WON_FREE_TICKET', winAmount: 0n, isFreeTicketTier: true });
  await makeTicket({ tag: 'free-pre-loss', orderHash: freePreOrder, ...craftBalls(freePreEpoch, 0, false), winStatus: 'LOST', winAmount: 0n });

  // 5. Won, cash, harvested — still live-claimable right now (feeds Winnings "claimableUsdc").
  const claimableEpoch = byId.get(EPOCH.wonClaimableNow)!;
  const claimableHarvest = await makeHarvestBatch('claimable', EPOCH.wonClaimableNow, 7_800_000n);
  const claimableOrder = await makeOrder({ tag: 'claimable', purchaseEpoch: EPOCH.wonClaimableNow, fulfillEpoch: EPOCH.wonClaimableNow, ticketCount: 2, lastBought: daysAgo(4) });
  await makeTicket({ tag: 'claimable-win', orderHash: claimableOrder, ...craftBalls(claimableEpoch, 3, true), winStatus: 'CLAIMED_ON_BASE', winAmount: 7_800_000n, harvestBatchId: claimableHarvest });
  await makeTicket({ tag: 'claimable-loss', orderHash: claimableOrder, ...craftBalls(claimableEpoch, 0, false), winStatus: 'LOST', winAmount: 0n });

  // 6. Won, cash, fully paid out on Solana already (feeds "Total claimed all-time").
  const paidOutEpoch = byId.get(EPOCH.wonPaidOut)!;
  const paidHarvest = await makeHarvestBatch('paidout', EPOCH.wonPaidOut, 3_120_000n);
  const paidClaim = await makePayoutClaim('confirmed', 'CONFIRMED', 3_120_000n, daysAgo(5));
  const paidOrder = await makeOrder({ tag: 'paidout', purchaseEpoch: EPOCH.wonPaidOut, fulfillEpoch: EPOCH.wonPaidOut, ticketCount: 1, lastBought: daysAgo(5) });
  await makeTicket({
    tag: 'paidout-win',
    orderHash: paidOrder,
    ...craftBalls(paidOutEpoch, 5, true),
    winStatus: 'PAID_OUT_ON_SOLANA',
    winAmount: 3_120_000n,
    harvestBatchId: paidHarvest,
    payoutClaimId: paidClaim,
  });

  // 7. Lost, no matches.
  const lostEpoch = byId.get(EPOCH.lost)!;
  const lostOrder = await makeOrder({ tag: 'lost', purchaseEpoch: EPOCH.lost, fulfillEpoch: EPOCH.lost, ticketCount: 2, lastBought: daysAgo(6) });
  await makeTicket({ tag: 'lost-1', orderHash: lostOrder, ...craftBalls(lostEpoch, 0, false), winStatus: 'LOST', winAmount: 0n });
  await makeTicket({ tag: 'lost-2', orderHash: lostOrder, ...craftBalls(lostEpoch, 1, false), winStatus: 'LOST', winAmount: 0n });

  // 8. Won, cash, harvested — bound to a still-PENDING voucher (feeds "pendingVoucher" banner).
  const pendingEpoch = byId.get(EPOCH.wonPendingVoucher)!;
  const pendingHarvest = await makeHarvestBatch('pending', EPOCH.wonPendingVoucher, 5_500_000n);
  const pendingClaim = await makePayoutClaim('pending', 'PENDING', 5_500_000n, daysAgo(0));
  const pendingOrder = await makeOrder({ tag: 'pending', purchaseEpoch: EPOCH.wonPendingVoucher, fulfillEpoch: EPOCH.wonPendingVoucher, ticketCount: 1, lastBought: daysAgo(7) });
  await makeTicket({
    tag: 'pending-win',
    orderHash: pendingOrder,
    ...craftBalls(pendingEpoch, 4, true),
    winStatus: 'CLAIMED_ON_BASE',
    winAmount: 5_500_000n,
    harvestBatchId: pendingHarvest,
    payoutClaimId: pendingClaim,
  });

  // 9. Won, free ticket, harvested — redeemable now (feeds Winnings "Free tickets" count).
  const freeRedeemEpoch = byId.get(EPOCH.wonFreeRedeemable)!;
  const freeRedeemHarvest = await makeHarvestBatch('free-redeem', EPOCH.wonFreeRedeemable, 0n);
  const freeRedeemOrder = await makeOrder({ tag: 'free-redeem', purchaseEpoch: EPOCH.wonFreeRedeemable, fulfillEpoch: EPOCH.wonFreeRedeemable, ticketCount: 1, lastBought: daysAgo(8) });
  await makeTicket({
    tag: 'free-redeem-win',
    orderHash: freeRedeemOrder,
    ...craftBalls(freeRedeemEpoch, 2, false),
    winStatus: 'CLAIMED_ON_BASE',
    winAmount: 0n,
    isFreeTicketTier: true,
    harvestBatchId: freeRedeemHarvest,
  });

  console.log(`Seeded mock UI fixtures for ${WALLET}`);
  console.log('Epochs used:', EPOCH);
  console.log('Expect on Winnings: claimableUsdc=7.80, freeTickets=1, totalPaidOutUsdc=3.12, pendingVoucher=5.50');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
