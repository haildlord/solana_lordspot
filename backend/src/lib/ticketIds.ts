import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * Deterministic ids for tickets and for the orderId each Base `buyTickets`
 * call is made under.
 *
 * WHY THIS EXISTS
 * The Base vault's replay guard is `isOrderFulfilled[orderId]`, and the orderId
 * we send is derived from the ids of the tickets in each chunk
 * (deriveChunkOrderId). If ticket ids are random (the old `uuid()` default),
 * the guard only holds while our database rows survive: lose or restore the DB,
 * re-ingest the same Solana transaction, and every ticket comes back with a NEW
 * id — so every chunk gets a NEW orderId and the vault would happily buy the
 * same tickets again with its own USDC.
 *
 * So a ticket's id is derived from the Solana transaction itself:
 *
 *     <solana tx signature>:<index of the ticket within that tx>
 *
 * Same Solana purchase in -> same ticket ids out -> same chunk orderIds ->
 * the vault rejects the duplicate (OrderAlreadyProcessed) no matter what state
 * our database is in.
 */

/** Digits in the zero-padded ticket index. 5 digits -> up to 100,000 tickets in one tx. */
const INDEX_WIDTH = 5;
const MAX_INDEX = 10 ** INDEX_WIDTH - 1;

/**
 * `<signature>:<zero-padded index>`.
 *
 * - `:` never appears in a base58 signature, so ids can't collide across txs.
 * - Zero-padding makes plain string order == purchase order, which
 *   baseRelayWorker relies on (`orderBy: { id: 'asc' }`) to cut chunks at the
 *   same boundaries every time. Do not change the width of an existing deploy.
 * - `index` is the ticket's position in the order's ticket list: events in log
 *   order, each event's tickets in order. That is fixed by the chain, so a
 *   re-ingest reproduces it exactly.
 */
export function makeTicketId(signature: string, index: number): string {
  if (!signature) {
    throw new Error('makeTicketId: signature is required');
  }
  if (!Number.isInteger(index) || index < 0 || index > MAX_INDEX) {
    throw new Error(`makeTicketId: index ${index} is outside 0..${MAX_INDEX}`);
  }
  return `${signature}:${String(index).padStart(INDEX_WIDTH, '0')}`;
}

/**
 * The vault's isOrderFulfilled[orderId] guard is per-orderId, not per-order-hash
 * — reusing the order's own hash for every chunk would mean chunk 1 marks it
 * fulfilled and every later chunk of the SAME order reverts with
 * OrderAlreadyProcessed. Each chunk needs its own id.
 *
 * Derived from the sorted ticket ids actually in the chunk (not e.g. a chunk
 * index) so it's stable across retries: if the exact same set of tickets ends
 * up bundled together again after a crash/retry, it gets the same id, and the
 * OrderAlreadyProcessed recovery path in baseRelayWorker can find and recover a
 * landed-but-lost-track-of tx.
 *
 * DO NOT change this algorithm: orders already in flight (tickets with old
 * uuid ids) were submitted under ids computed this way, and recovery has to
 * keep reproducing them byte for byte.
 */
export function deriveChunkOrderId(chunk: { id: string }[]): string {
  const key = chunk.map((t) => t.id).sort().join(',');
  return keccak256(toUtf8Bytes(key));
}
