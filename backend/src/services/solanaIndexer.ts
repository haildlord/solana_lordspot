import { Connection, PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/db';
import { ticketIngestQueue } from '../lib/queues';
import { config } from '../lib/config';

const connection = new Connection(config.solana.rpcUrl, 'confirmed');

const CURSOR_ID = 'solana_vault';

export async function pollMissedTransactions(): Promise<number> {
  const vaultAta = config.solana.vaultUsdcAta;
  if (!vaultAta) {
    return 0;
  }

  // READ, not upsert. This used to be an `upsert` — a database WRITE on every
  // single poll, forever, even when the chain had nothing new. That one line was
  // enough on its own to keep the database permanently awake (it is what pushed
  // the old Neon deployment past its free compute-hour allowance). The row is
  // created exactly once, on the first run this database ever sees; after that
  // this is a plain read. The upsert is kept for that create because two poller
  // processes starting at once would otherwise race on the insert.
  let cursor = await prisma.indexerCursor.findUnique({ where: { id: CURSOR_ID } });
  if (!cursor) {
    cursor = await prisma.indexerCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID },
      update: {},
    });
  }

  const sigs = await connection.getSignaturesForAddress(
    new PublicKey(vaultAta),
    { limit: 50, until: cursor.signature ?? undefined },
    'confirmed'
  );

  let enqueued = 0;

  for (const sigInfo of [...sigs].reverse()) {
    if (sigInfo.err) continue;

    const known = await prisma.relayOrder.findUnique({
      where: { signature: sigInfo.signature },
    });
    if (known) continue;

    const tx = await connection.getTransaction(sigInfo.signature, {
      maxSupportedTransactionVersion: 0,
    });

    const logs = tx?.meta?.logMessages ?? [];
    if (!logs.some((l) => l.includes('Instruction: BuyTicket'))) continue;

    await ticketIngestQueue.add(
      'process-solana-logs',
      { signature: sigInfo.signature, logs },
      { jobId: `ticket-${sigInfo.signature}` }
    );
    enqueued++;
  }

  if (sigs.length > 0) {
    await prisma.indexerCursor.update({
      where: { id: CURSOR_ID },
      data: { signature: sigs[0].signature },
    });
  }

  if (enqueued > 0) {
    console.log(`[solana-indexer] Enqueued ${enqueued} missed tx(s)`);
  }

  return enqueued;
}
