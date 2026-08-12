import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/db';
import { config } from '../lib/config';
import { webhookIngestQueue } from '../lib/queues';
import { redisConnection } from '../lib/redis';
import { Prisma } from '../../generated/prisma/client';
import { solanaService } from '../services/solanaService';

const router = Router();

/**
 * Helius webhook auth: the dashboard's "Auth Header" value arrives in the
 * Authorization header. Compared in constant time so attackers can't
 * character-guess the secret via response timing.
 * If HELIUS_WEBHOOK_SECRET is unset (local dev), verification is skipped with a warning.
 */
function verifyHeliusAuth(req: Request, res: Response, next: NextFunction) {

  const secret = config.helius.webhookSecret;
  
  if (!secret) {
    console.error('[WEBHOOK] CRITICAL FATAL ERROR: HELIUS_WEBHOOK_SECRET is completely missing from the server environment!');
    return res.status(500).json({ ok: false, error: 'Server misconfiguration' });
  }

  const provided = Buffer.from(String(req.headers.authorization ?? ''));
  const expected = Buffer.from(secret);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    console.warn('[WEBHOOK] Rejected request with missing/invalid Authorization header');
    return res.status(401).json({ ok: false });
  }

  return next();
}

// Dedup window: Helius may send same tx multiple times.
// Cheap Redis pre-filter only — the DB unique constraint is the real idempotency.
async function isDuplicate(signature: string): Promise<boolean> {
  return (await redisConnection.exists(`webhook:seen:${signature}`)) === 1;
}

// Marked AFTER successful DB persist + enqueue — never before. If it were set
// first and the DB write failed, Helius's retry would be wrongly deduped and
// the webhook lost forever.
async function markSeen(signature: string): Promise<void> {
  const key = `webhook:seen:${signature}`;
  // set(key, value, next_param_is_sec_CODE, secs, only_if_does_not_exist)
  await redisConnection.set(key, '1', 'EX', 86400, 'NX');
}

// Best-effort fee-payer extraction from the raw Helius payload, trying the
// two shapes accountKeys shows up in ("string[]" or "{pubkey}[]"). Returns
// null on anything unrecognized — callers must treat null as "don't skip,
// let the authoritative on-chain check decide" (see filterOutOwnAdminTxs).
function extractFeePayer(tx: unknown): string | null {
  const accountKeys = (tx as any)?.transaction?.message?.accountKeys;
  if (!Array.isArray(accountKeys) || accountKeys.length === 0) return null;
  const first = accountKeys[0];
  if (typeof first === 'string') return first;
  if (typeof first?.pubkey === 'string') return first.pubkey;
  return null;
}

// Our program also receives pause_protocol / resume_protocol / update_epoch /
// claim_winnings — all admin-signed, never a user's buy_ticket — which spam
// WebhookInbox with rows that will always end up SKIPPED. Filter them out
// here by WHO signed (a structural fact any valid payload reliably carries),
// never by trusting the payload's claimed instruction content — the actual
// buy_ticket decision remains the chain-verified check in webhookIngestWorker.
// Fails open: if the fee payer can't be determined, it's kept, not dropped.
function isOwnAdminTx(tx: unknown): boolean {
  const feePayer = extractFeePayer(tx);
  return feePayer !== null && feePayer === solanaService.getAdminPublicKey().toBase58();
}

router.post('/helius', verifyHeliusAuth, async (req: Request, res: Response) => {

  console.log('\n[WEBHOOK] Received POST request at /helius');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    console.log(`[WEBHOOK] Processing payload containing ${transactions.length} transaction(s)`);

    const fresh: { signature: string; tx: unknown }[] = [];

    for (const tx of transactions) {
      
      const signature = tx?.transaction?.signatures?.[0] ?? null;

      if (!signature) {
        console.warn('[WEBHOOK] Transaction skipped: No signature found in payload block');
        continue;
      }

      if (await isDuplicate(signature)) {
        console.log(`[WEBHOOK] Transaction skipped: Signature ${signature} already processed within deduplication window`);
        continue;
      }

      if (isOwnAdminTx(tx)) {
        console.log(`[WEBHOOK] Transaction skipped: ${signature} was signed by our own admin wallet (pause/resume/update_epoch/claim), not a buyer — not stored.`);
        continue;
      }

      fresh.push({ signature, tx });
    }

    if (fresh.length > 0) {
      // Durability Layer: single batched insert (idempotent via unique signature)
      console.log(`[DATABASE] Persisting ${fresh.length} webhook(s) to inbox`);
      await prisma.webhookInbox.createMany({
        data: fresh.map((f) => ({
          signature: f.signature,
          source: 'helius',
          rawPayload: f.tx as Prisma.InputJsonValue,
          status: 'RECEIVED' as const,
        })),
        skipDuplicates: true,
      });

      // Ingestion Layer: single batched enqueue
      // ! BullMQ uses the colon character (:) as a delimiter to build its Redis keys (for example, it creates keys that look like bull:webhookIngestQueue:id). If you pass a custom jobId that also contains a colon, it breaks BullMQ's internal key-parsing logic, causing it to throw the Custom Id cannot contain : error.
      await webhookIngestQueue.addBulk(
        fresh.map((f) => ({
          name: 'process-webhook',
          data: { signature: f.signature },
          opts: { jobId: `wh-${f.signature}` }, // BullMQ dedup
        }))
      );

      console.log(`[QUEUE] ${fresh.length} job(s) accepted by webhookIngestQueue`);

      // Dedup marks go in LAST — only after both persistence layers succeeded
      await Promise.all(fresh.map((f) => markSeen(f.signature)));
    }

    console.log('[WEBHOOK] Payload processing completed successfully. Returning 200 OK');
    return res.status(200).json({ ok: true, received: transactions.length, enqueued: fresh.length });
  } catch (err) {
    console.error('[WEBHOOK] Fatal Error during webhook processing:', err);
    // Return 500 ONLY if DB/Queue layers fail entirely — Helius will catch this status code and trigger a retry sequence
    return res.status(500).json({ ok: false });
  }
});

export default router;