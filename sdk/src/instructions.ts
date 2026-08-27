import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { Ticket } from './ticket';
import { getLordsPotStatePda, getUserUsdcAta, getVaultAuthorityPda, getVaultUsdcAta } from './pdas';

/**
 * Instruction encoding, done by hand rather than through Anchor's client.
 *
 * Deliberate: this SDK signs transactions that move money, so every dependency
 * is attack surface worth questioning. Anchor's client would pull in a large
 * tree and force an AnchorProvider (which expects a browser wallet) just to
 * build an instruction. The encoding below is a fixed, verifiable byte layout,
 * so we own it directly and the SDK's entire runtime dependency set stays at
 * @solana/web3.js + @solana/spl-token.
 *
 * Discriminators are Anchor's standard 8-byte instruction tags, copied verbatim
 * from the program's generated IDL. They are a property of the deployed program
 * and must match exactly.
 */

/** sha256("global:buy_ticket")[0..8] — from the program IDL. */
export const BUY_TICKET_DISCRIMINATOR = Buffer.from([11, 24, 17, 193, 168, 116, 164, 169]);

/** sha256("global:claim_winnings")[0..8] — from the program IDL. */
export const CLAIM_WINNINGS_DISCRIMINATOR = Buffer.from([161, 215, 24, 59, 14, 236, 242, 221]);

/** Bytes one encoded ticket occupies: 4 (Vec<u8> length prefix) + 5 normals + 1 bonus. */
const BYTES_PER_TICKET = 10;

/**
 * Borsh-encodes `Vec<Ticket>` where `Ticket { normal_ball: Vec<u8>, bonus_ball: u8 }`.
 *
 * Layout, all little-endian:
 *   u32  ticket count
 *   per ticket:
 *     u32  normals length (always 5)
 *     u8   x5  normals
 *     u8       bonus
 *
 * Verified against real transactions: an N-ticket instruction is exactly
 * 8 + 4 + N*10 bytes, which matches measured on-chain instruction sizes
 * (e.g. 73 tickets -> 742 bytes).
 */
function encodeTickets(tickets: Ticket[]): Buffer {
  const buf = Buffer.alloc(4 + tickets.length * BYTES_PER_TICKET);
  let o = 0;
  buf.writeUInt32LE(tickets.length, o);
  o += 4;

  for (const t of tickets) {
    buf.writeUInt32LE(t.normals.length, o);
    o += 4;
    for (const n of t.normals) {
      buf.writeUInt8(n, o);
      o += 1;
    }
    buf.writeUInt8(t.bonus, o);
    o += 1;
  }
  return buf;
}

export interface BuyTicketAccountsInput {
  programId: PublicKey;
  usdcMint: PublicKey;
  buyer: PublicKey;
  /** Owner of the fee destination, read from on-chain state — never guessed. */
  feeRecipient: PublicKey;
}

/**
 * Builds one `buy_ticket` instruction.
 *
 * Account ORDER is significant and must match the program's `BuyTicket` struct
 * exactly. Every address here is derived locally from the program id and mint,
 * so none of it can be influenced by an API response.
 */
export function buildBuyTicketInstruction(
  tickets: Ticket[],
  accounts: BuyTicketAccountsInput
): TransactionInstruction {
  const { programId, usdcMint, buyer, feeRecipient } = accounts;

  const keys = [
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: getLordsPotStatePda(programId), isSigner: false, isWritable: false },
    { pubkey: getUserUsdcAta(buyer, usdcMint), isSigner: false, isWritable: true },
    { pubkey: getVaultUsdcAta(programId, usdcMint), isSigner: false, isWritable: true },
    { pubkey: getUserUsdcAta(feeRecipient, usdcMint), isSigner: false, isWritable: true },
    { pubkey: getVaultAuthorityPda(programId), isSigner: false, isWritable: false },
    { pubkey: usdcMint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([BUY_TICKET_DISCRIMINATOR, encodeTickets(tickets)]),
  });
}

/** Exact byte size of a buy_ticket instruction's data, for size planning. */
export function buyTicketDataSize(ticketCount: number): number {
  return BUY_TICKET_DISCRIMINATOR.length + 4 + ticketCount * BYTES_PER_TICKET;
}
