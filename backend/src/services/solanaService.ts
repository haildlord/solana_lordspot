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
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
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

  private readonly FALLBACK_PRIORITY_FEE = 1000;
  private readonly CU_LIMIT_PAUSE = 15_000;
  private readonly CU_LIMIT_UNPAUSE_ONLY = 15_000;
  private readonly CU_LIMIT_UPDATE_UNPAUSE = 25_000;
  // Claim voucher: SPL transfer + constraint checks + possible ATA creation
  // (~20-25k CU by itself when it fires) — sized with real margin, per the
  // "consumed 4700 of 4700" lesson.
  private readonly CU_LIMIT_CLAIM = 80_000;

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

    const { blockhash } = await this.connection.getLatestBlockhash();

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

  /**
   * Builds a claim VOUCHER: a claim_winnings transaction carrying the exact
   * amount owed, PARTIALLY SIGNED by the admin key. The user counter-signs in
   * their wallet and submits. Two deliberate choices:
   *
   * - ADMIN IS THE FEE PAYER. On Solana the tx signature IS the fee payer's
   *   signature — so we know the final signature the moment we partial-sign,
   *   BEFORE the user ever sees the voucher. That lets the payout confirmer
   *   poll the chain directly (getSignatureStatuses) with zero trust in
   *   frontend callbacks. Cost: ~5000 lamports (~$0.001) per LANDED claim,
   *   nothing for unused vouchers. (Also means winners need no SOL to claim,
   *   unless their USDC ATA was closed — ATA re-creation rent is theirs.)
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
  ): Promise<{ transactionBase64: string; txSignature: string; lastValidBlockHeight: number }> {
    const user = new PublicKey(userWallet);

    // ATAs + PDAs resolve automatically from the IDL's account constraints.
    const claimIx: TransactionInstruction = await (this.program.methods as any)
      .claimWinnings(new BN(amount.toString()))
      .accounts({ user, admin: this.wallet.publicKey })
      .instruction();

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

    const priorityFee = await this.getPriorityFeeEstimate(
      Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: this.wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: [claimIx],
          }).compileToV0Message()
        ).serialize()
      ).toString('base64')
    );

    const tx = new Transaction({
      feePayer: this.wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: this.CU_LIMIT_CLAIM }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
      claimIx
    );

    tx.partialSign(this.wallet.payer);

    const sigBytes = tx.signature; // fee payer's signature = THE tx signature
    if (!sigBytes) throw new Error('Voucher signing failed — no admin signature produced');

    return {
      transactionBase64: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      txSignature: bs58.encode(sigBytes),
      lastValidBlockHeight,
    };
  }
}

export const solanaService = new SolanaService();
