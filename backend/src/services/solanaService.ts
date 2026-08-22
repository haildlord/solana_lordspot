import {
  PublicKey,
  Connection,
  Keypair,
  Transaction,
  TransactionSignature,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN, BorshCoder, EventParser } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

import solana_idl from '../../solana_idl/solana_smart_contracts.json';
import { SolanaSmartContracts } from '../../solana_types/solana_smart_contracts';
import { config } from '../lib/config';

class SolanaService {
  private isMainnet: boolean;
  private connection: Connection;
  private wallet: Wallet;
  private program: Program<SolanaSmartContracts>;
  private statePda: PublicKey;
  /** Decodes the program's own events out of raw tx logs (claim discovery). */
  private eventParser: EventParser;
  /** signature → its WinningsClaimedEvents. Confirmed transactions never change. */
  private claimDecodeCache = new Map<string, { wallet: string; amount: bigint }[]>();
  private readonly CLAIM_CACHE_MAX = 5_000;

  private readonly FALLBACK_PRIORITY_FEE = 1000;
  // RAISED when LordsPotState grew from 60 to 246 bytes (relay economics +
  // version + 128 bytes of reserved headroom). Anchor deserializes AND
  // reserializes the whole account on every instruction that touches it, so
  // that growth costs CU on paths that never read the new fields at all.
  // Sized with deliberate margin per the "consumed 4700 of 4700" lesson —
  // priority-fee cost of a generous limit is lamports, a starved transaction
  // is a failed pause during an epoch rollover.
  private readonly CU_LIMIT_PAUSE = 25_000;
  private readonly CU_LIMIT_UNPAUSE_ONLY = 25_000;
  private readonly CU_LIMIT_UPDATE_UNPAUSE = 40_000;
  // Claim voucher: SPL transfer + constraint checks + possible ATA creation
  // (~20-25k CU by itself when it fires) — sized with real margin, per the
  // "consumed 4700 of 4700" lesson.
  private readonly CU_LIMIT_CLAIM = 100_000;

  constructor() {
    this.isMainnet =
      config.nodeEnv === 'production' ||
      config.solana.rpcUrl.includes('mainnet');

    const keypair = Keypair.fromSecretKey(
      bs58.decode(config.solana.privateKey)
    );
    this.wallet = new Wallet(keypair);
    this.connection = new Connection(config.solana.rpcUrl, 'confirmed');

    const provider = new AnchorProvider(this.connection, this.wallet, {
      preflightCommitment: 'confirmed',
    });
    this.program = new Program(
      solana_idl as SolanaSmartContracts,
      provider
    );
    this.statePda = PublicKey.findProgramAddressSync(
      [Buffer.from('lords_pot_state')],
      this.program.programId
    )[0];
    this.eventParser = new EventParser(
      this.program.programId,
      new BorshCoder(solana_idl as any)
    );
  }

  private async getPriorityFeeEstimate(
    serializedTransaction: string,
    priorityLevel = 'Medium'
  ): Promise<number> {
    if (!this.isMainnet) {
      return this.FALLBACK_PRIORITY_FEE;
    }

    try {
      const response = await fetch(this.connection.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'getPriorityFeeEstimate',
          params: [
            {
              transaction: serializedTransaction,
              options: { priorityLevel },
            },
          ],
        }),
      });

      const result = (await response.json()) as {
        error?: unknown;
        result?: { priorityFeeEstimate: number };
      };

      if (result.error || !result.result) {
        throw new Error('Fee estimation failed');
      }

      return Math.floor(result.result.priorityFeeEstimate);
    } catch {
      return this.FALLBACK_PRIORITY_FEE;
    }
  }

  public async pauseProtocol(): Promise<TransactionSignature> {

    const pauseInstruction = await this.program.methods
      .pauseProtocol()
      .accounts({ admin: this.wallet.publicKey })
      .instruction();

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    const dummyMessage = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [pauseInstruction],
    }).compileToV0Message();

    const priorityFee = await this.getPriorityFeeEstimate(
      Buffer.from(new VersionedTransaction(dummyMessage).serialize()).toString(
        'base64'
      )
    );

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: this.CU_LIMIT_PAUSE,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee,
          }),
          pauseInstruction,
        ],
      }).compileToV0Message()
    );

    const signed = await this.wallet.signTransaction(tx);
    const txSig = await this.connection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, maxRetries: 3 }
    );

    // Callers (e.g. boot-time epoch reconciliation) may immediately build and
    // simulate a follow-up transaction that requires the paused state to
    // already be visible on-chain — wait for confirmation rather than just
    // the broadcast accept, or that follow-up's simulation can race against
    // a not-yet-landed pause and see stale (unpaused) state.
    await this.connection.confirmTransaction(
      { signature: txSig, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    console.log('[solana] Protocol paused:', txSig);
    return txSig;
  }

  public async resumeAndTransitionEpoch(
    normals_max: number,
    bonus_max: number,
    needsUpdate: boolean,
    next_epoch: bigint
  ): Promise<TransactionSignature> {
    const coreInstructions: TransactionInstruction[] = [];
    const nextEpochBN = new BN(next_epoch.toString());

    if (needsUpdate) {
      const updateIx = await this.program.methods
        .updateEpoch(normals_max, bonus_max)
        .accounts({ admin: this.wallet.publicKey })
        .instruction();
      coreInstructions.push(updateIx);
    }

    const unpauseIx = await this.program.methods
      .resumeProtocol(nextEpochBN)
      .accounts({ admin: this.wallet.publicKey })
      .instruction();
    coreInstructions.push(unpauseIx);

    const { blockhash } = await this.connection.getLatestBlockhash();

    const priorityFee = await this.getPriorityFeeEstimate(
      Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: this.wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: coreInstructions,
          }).compileToV0Message()
        ).serialize()
      ).toString('base64')
    );

    const cuLimit = needsUpdate
      ? this.CU_LIMIT_UPDATE_UNPAUSE
      : this.CU_LIMIT_UNPAUSE_ONLY;

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: priorityFee,
          }),
          ...coreInstructions,
        ],
      }).compileToV0Message()
    );

    const signed = await this.wallet.signTransaction(tx);
    const txSig = await this.connection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, maxRetries: 3 }
    );

    console.log('[solana] Protocol resumed:', txSig);
    return txSig;
  }

  public async getOnChainState() {
    return this.program.account.lordsPotState.fetch(this.statePda);
  }

  public getConnection(): Connection {
    return this.connection;
  }

  /** Our own admin/relayer wallet — never a buyer, only pause/resume/update_epoch/claim fee-payer. */
  public getAdminPublicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /**
   * Builds a claim VOUCHER: a claim_winnings transaction carrying the exact
   * amount owed, PARTIALLY SIGNED by the admin key. The user counter-signs in
   * their wallet and submits. Two deliberate choices:
   *
   * - THE USER IS THE FEE PAYER, so the protocol spends nothing on claims —
   *   matching what the program's own docs have always described (see
   *   ClaimWinnings in lib.rs). The consequence is architectural, not
   *   cosmetic: on Solana the transaction signature IS the fee payer's
   *   signature, so the final signature is UNKNOWABLE here — it does not exist
   *   until the user signs. The payout confirmer therefore cannot poll a
   *   known signature and instead DISCOVERS landed claims by scanning the
   *   chain for the admin co-signature (see payoutConfirmer.ts). That keeps
   *   the "never trust a frontend callback" guarantee intact; it just pays for
   *   it in RPC work instead of lamports.
   *
   *   Because the user now pays, a winner needs a small amount of SOL to
   *   claim — plus ATA rent on their first-ever claim (payer = user on-chain).
   *
   * - LEGACY Transaction (not v0): the partial-sign → serialize(requireAll:
   *   false) → wallet co-sign flow is the battle-tested path every wallet
   *   adapter supports.
   *
   * NOTE: `claimWinnings` appears in the IDL only after `anchor build` +
   * `npm run build:program` — the `as any` cast is removable once the
   * regenerated types land.
   */
  public async buildClaimVoucher(
    userWallet: string,
    amount: bigint
  ): Promise<{ transactionBase64: string; lastValidBlockHeight: number }> {
    const user = new PublicKey(userWallet);

    // ATAs + PDAs resolve automatically from the IDL's account constraints —
    // EXCEPT tokenProgram: it's declared as an `Interface` (Token vs
    // Token-2022) on-chain so Anchor can't infer a single default for it,
    // unlike a plain `Program<Token>`. Must be passed explicitly or the
    // whole instruction build throws "Account `tokenProgram` not provided."
    const claimIx: TransactionInstruction = await (this.program.methods as any)
      .claimWinnings(new BN(amount.toString()))
      .accounts({ user, admin: this.wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction();

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    const priorityFee = await this.getPriorityFeeEstimate(
      Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: user,
            recentBlockhash: blockhash,
            instructions: [claimIx],
          }).compileToV0Message()
        ).serialize()
      ).toString('base64')
    );

    const tx = new Transaction({
      feePayer: user,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: this.CU_LIMIT_CLAIM }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
      claimIx
    );

    // Admin co-signature only. tx.signature stays null here — it belongs to the
    // fee payer (the user), who has not signed yet. Nothing downstream may
    // assume a signature exists at issuance time.
    tx.partialSign(this.wallet.payer);

    const adminSigned = tx.signatures.some(
      (s) => s.publicKey.equals(this.wallet.publicKey) && s.signature !== null
    );
    if (!adminSigned) throw new Error('Voucher signing failed — no admin signature produced');

    return {
      transactionBase64: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      lastValidBlockHeight,
    };
  }

  /**
   * Discovers claim_winnings transactions that have actually LANDED, by walking
   * the admin key's own signature history backwards from the chain tip.
   *
   * This is the replacement for polling a known signature. Every claim carries
   * the admin co-signature by construction (the program requires it), so the
   * admin's history is a complete record of every claim that can possibly
   * exist — nothing a frontend does or fails to do can hide one. Returned
   * entries are keyed by the winner's wallet, parsed out of the program's own
   * WinningsClaimedEvent rather than inferred from account positions.
   *
   * COMPLETENESS COMES FROM THE TIME BOUND, not from bookkeeping. A voucher's
   * transaction can only land inside its blockhash validity window (~60-90s
   * from issuance), so walking back to the oldest live voucher's creation time
   * is guaranteed to surface every claim that could possibly still be pending.
   * Missing a landed claim is the one failure this must never have: it would
   * expire a voucher whose funds already moved, freeing its tickets to be
   * claimed a second time.
   *
   * There is deliberately NO incremental cursor. A "resume from last seen
   * signature" watermark would be faster, but it can only ever move forward:
   * any transaction it skipped past — including one this sweep saw but failed
   * to match — becomes permanently invisible, and an unmatched claim that later
   * expires releases its tickets for a second payout. Re-reading a ~2 minute
   * window every tick is cheap; a silent double-payment is not.
   */
  public async findLandedClaims(notBeforeUnixTime: number): Promise<{
    claims: {
      wallet: string;
      amount: bigint;
      signature: string;
      slot: number;
      blockTime: number | null;
      failed: boolean;
    }[];
    /**
     * True only if the walk actually reached `notBeforeUnixTime`. False means
     * the page ceiling cut it short, so "no claim found" is unproven for the
     * unreached stretch and MUST NOT be treated as "no claim exists".
     */
    complete: boolean;
  }> {
    const PAGE = 200;
    const MAX_PAGES = 25; // hard stop so a pathological window can't walk forever

    const collected: Awaited<ReturnType<SolanaService['findLandedClaims']>>['claims'] = [];
    let before: string | undefined;
    // Flipped true the moment we see a transaction older than the bound, or run
    // out of history — either way, everything in range has been examined.
    let complete = false;

    // A signature's decoded contents are immutable once confirmed, so the same
    // ~2 minute window being re-read every 10s costs one fetch, not nine.
    const decodeCached = async (signature: string) => {
      const cached = this.claimDecodeCache.get(signature);
      if (cached !== undefined) return cached;

      const parsed = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      const events: { wallet: string; amount: bigint }[] = [];
      const logs = parsed?.meta?.logMessages;
      if (logs) {
        for (const ev of this.eventParser.parseLogs(logs)) {
          // Anchor may emit PascalCase (IDL) or camelCase depending on version —
          // same ambiguity ticketWorker guards against.
          if (ev.name !== 'WinningsClaimedEvent' && ev.name !== 'winningsClaimedEvent') continue;
          events.push({
            wallet: new PublicKey(ev.data.user as PublicKey).toBase58(),
            amount: BigInt((ev.data.amount as BN).toString()),
          });
        }
      }

      // Only cache a definitive read. A transaction the RPC could not return
      // yet must be retried, never remembered as "has no claim in it".
      if (parsed) {
        if (this.claimDecodeCache.size >= this.CLAIM_CACHE_MAX) {
          // Cheap bounded eviction — Map preserves insertion order.
          const oldest = this.claimDecodeCache.keys().next().value;
          if (oldest !== undefined) this.claimDecodeCache.delete(oldest);
        }
        this.claimDecodeCache.set(signature, events);
      }
      return events;
    };

    outer: for (let page = 0; page < MAX_PAGES; page++) {
      const sigs = await this.connection.getSignaturesForAddress(
        this.wallet.publicKey,
        { before, limit: PAGE },
        'confirmed'
      );
      if (sigs.length === 0) {
        complete = true; // walked the admin key's entire history
        break;
      }

      for (const s of sigs) {
        // Results are newest-first, so the first transaction older than the
        // bound means every remaining one is too. Anything this old cannot
        // belong to a still-live voucher.
        if (s.blockTime != null && s.blockTime < notBeforeUnixTime) {
          complete = true;
          break outer;
        }

        for (const ev of await decodeCached(s.signature)) {
          collected.push({
            wallet: ev.wallet,
            amount: ev.amount,
            signature: s.signature,
            slot: s.slot,
            blockTime: s.blockTime ?? null,
            // Defensive: a reverted claim never reaches its emit!, so this is
            // effectively unreachable — but if an event ever does surface on a
            // failed transaction, no funds moved, and the confirmer must
            // release rather than confirm.
            failed: s.err !== null,
          });
        }
      }

      if (sigs.length < PAGE) {
        complete = true; // last page — nothing older exists
        break;
      }
      before = sigs[sigs.length - 1].signature;
    }

    return { claims: collected, complete };
  }
}

export const solanaService = new SolanaService();
