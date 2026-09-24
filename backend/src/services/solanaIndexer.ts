import { Connection, PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/db';
import { ticketIngestQueue } from '../lib/queues';
import { config } from '../lib/config';

const connection = new Connection(config.solana.rpcUrl, 'confirmed');

export async function pollMissedTransactions(): Promise<number> {
  const vaultAta = config.solana.vaultUsdcAta;
  if (!vaultAta) {
    return 0;
  }

  const cursor = await prisma.indexerCursor.upsert({
    where: { id: 'solana_vault' },
    create: { id: 'solana_vault' },
    update: {},
  });

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
      where: { id: 'solana_vault' },
      data: { signature: sigs[0].signature },
    });
  }

  if (enqueued > 0) {
    console.log(`[solana-indexer] Enqueued ${enqueued} missed tx(s)`);
  }

  return enqueued;
}
