import { ethers, Contract, Wallet, JsonRpcProvider } from 'ethers';
import LordsPotBaseVault from '../../base_abi/LordsPotBaseVault.json';
import { config } from '../lib/config';
import { redisConnection } from '../lib/redis';

const VAULT_BALANCE_CACHE_KEY = 'base-vault:usdc_balance';

/** What a Base-side failure means for the order lifecycle. */
export type RevertClass =
  | { kind: 'already_processed' }          // fulfilled by an earlier tx — recover receipt, don't retry
  | { kind: 'paused'; reason: string }     // vault paused — defer, reconciler re-queues later
  | { kind: 'permanent'; reason: string }  // bad ticket data / config — never retry
  | { kind: 'transient'; reason: string }; // network / nonce / funds — retry with backoff

// Megapot-side validation errors that can never succeed on retry
// (e.g. ball ranges changed between purchase epoch and fulfill epoch).
const PERMANENT_ERROR_PATTERNS =
  /InvalidNormalsCount|InvalidBonusball|InvalidTicketCount|InvalidTicketLength/;

class BaseService {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private vault: Contract;
  private usdc: Contract;

  // Gas limit formula, fit from real observed estimateGas numbers (not a guess):
  // 15 tickets raw-estimated at 12,233,182, 20 tickets at ~16,018,000 (avg of two
  // real runs). Linear fit from those two points: fixed overhead ~878,728,
  // ~756,964 gas/ticket. 15 tickets × that fit + 20% headroom = 14,679,818 —
  // the EXACT number that broadcast successfully for real (confirmed, not
  // theoretical). BASE_GAS_OVERHEAD/GAS_PER_TICKET below are rounded to sit
  // just under that proven-good ceiling, not just under EIP-7825's theoretical
  // 16,777,216-gas cap — the real provider-enforced ceiling for eth_sendRawTransaction
  // is confirmed somewhere between 14,679,818 (works) and 19,157,895 (rejected,
  // "gas limit too high"), i.e. tighter than the theoretical wall, and unconfirmed
  // in between — so anything above the proven-good number is guessing, even if
  // it's still under 16,777,216. At the 15-ticket chunk cap (config.relay.baseTicketChunkSize):
  // 1_200_000 + 15 * 880_000 = 14,400,000 — under the proven 14,679,818, not just under the theoretical wall.
  private static readonly BASE_GAS_OVERHEAD = 1_200_000n;
  private static readonly GAS_PER_TICKET = 880_000n;

  // ---- Nonce lane ----
  // Nonces must be sequential, not sequentially *confirmed*. We serialize only
  // {assign nonce → sign → broadcast} (~100ms), never the mining wait — that is
  // the confirmer's job. On any broadcast failure the lane resyncs from chain
  // ('pending' count), so a failed send can never leave a nonce gap behind.
  private nextNonce: number | null = null;
  private nonceLane: Promise<unknown> = Promise.resolve();

  constructor() {
    this.provider = new JsonRpcProvider(config.base.rpcUrl, config.base.chainId);
    this.wallet = new Wallet(config.base.relayerKey, this.provider);
    this.vault = new ethers.Contract(
      config.base.vaultAddress,
      LordsPotBaseVault.abi,
      this.wallet
    );
    this.usdc = new ethers.Contract(
      config.base.usdcAddress,
      ['function balanceOf(address) view returns (uint256)'],
      this.provider
    );
    console.log(`[SERVICE:base] Initialized with Vault Address: ${config.base.vaultAddress} and Relayer: ${this.wallet.address}`);
  }

  public getProvider(): JsonRpcProvider {
    return this.provider;
  }

  // ================= Vault balance (Redis-cached circuit info) =================
  // The cache is a circuit breaker, NOT a ledger: debited optimistically at
  // broadcast, overwritten with the real chain value by vaultMonitor every 5 min.

  /** Direct chain read. THROWS on RPC failure — callers decide the fallback; never fakes a 0. */
  public async fetchVaultUsdcBalanceFromChain(): Promise<bigint> {
    const balance = await this.usdc.balanceOf(config.base.vaultAddress);
    return BigInt(balance);
  }

  public async refreshVaultBalanceCache(): Promise<bigint> {
    const balance = await this.fetchVaultUsdcBalanceFromChain();
    await redisConnection.set(VAULT_BALANCE_CACHE_KEY, balance.toString());
    return balance;
  }

  /** Cached balance; falls back to a chain read only on cache miss. */
  public async getCachedVaultUsdcBalance(): Promise<bigint> {
    const cached = await redisConnection.get(VAULT_BALANCE_CACHE_KEY);
    if (cached !== null) return BigInt(cached);
    return this.refreshVaultBalanceCache();
  }

  /** Optimistic debit at broadcast time; monitor reconcile heals any drift. */
  public async debitVaultBalanceCache(amount: bigint): Promise<void> {
    try {
      const exists = await redisConnection.exists(VAULT_BALANCE_CACHE_KEY);
      if (exists === 1) {
        await redisConnection.decrby(VAULT_BALANCE_CACHE_KEY, Number(amount));
      }
    } catch (err) {
      console.warn('[SERVICE:base] Balance cache debit failed (non-fatal):', err);
    }
  }

  // ================= Nonce lane =================

  /** Force a resync from chain on the next submit — heals gaps after drops/errors. */
  public resetNonceLane(): void {
    this.nextNonce = null;
  }

  private async withNonceLane<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.nonceLane;
    let release!: () => void;
    this.nonceLane = new Promise<void>((r) => { release = r; });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ================= Submit (no confirmation wait — confirmer owns that) =================

  /**
   * Broadcasts buyTickets and returns IMMEDIATELY after the tx enters the mempool.
   * No estimateGas pre-flight — gasLimit is a hardcoded, generous formula instead
   * (see BASE_GAS_OVERHEAD/GAS_PER_TICKET above). Deliberate tradeoff: this drops
   * the free "would this revert?" simulation estimateGas used to provide (paused /
   * already-processed / bad tickets), on the reasoning that pause state is already
   * checked server-side before this is ever called, and ticket data is already
   * validated before it reaches Base. A genuinely doomed transaction now costs
   * real gas to discover instead of failing for free — acceptable given the
   * above, revisit if that stops being true. Errors still bubble up raw —
   * callers classify via classifyError().
   */
  public async submitBuyTickets(params: {
    orderId: string;
    tickets: { normals: number[]; bonusball: number }[];
    source: string;
  }): Promise<{ txHash: string; nonce: number }> {

    const referrers = [config.base.rewardWallet];
    const referralSplit = [config.base.referralSplit];

    const gasLimit =
      BaseService.BASE_GAS_OVERHEAD + BaseService.GAS_PER_TICKET * BigInt(params.tickets.length);

    return this.withNonceLane(async () => {

      if (this.nextNonce === null) {
        this.nextNonce = await this.provider.getTransactionCount(
          this.wallet.address,
          'pending'
        );
      }

      const nonce = this.nextNonce;

      try {
        
        const tx = await this.vault.buyTickets(
          params.orderId,
          params.tickets,
          referrers,
          referralSplit,
          params.source,
          { gasLimit, nonce }
        );

        this.nextNonce = nonce + 1;
        console.log(`[SERVICE:base] Broadcast order ${params.orderId.slice(0, 10)}… nonce=${nonce} gasLimit=${gasLimit} tx=${tx.hash}`);
        return { txHash: tx.hash as string, nonce };

      } catch (err) {
        // Broadcast failed — nonce may or may not have reached the mempool.
        // Resync from chain next time instead of guessing (prevents gaps).
        this.resetNonceLane();
        throw err;
      }

    });
  }

  // ================= Harvest (claim winnings from Megapot into the vault) =================

  /**
   * Free pre-flight for a harvest batch. Reverts if ANY id in the batch is
   * unclaimable (already burned / wrong drawing / not vault-owned) — Megapot's
   * loop is all-or-nothing. The harvest worker uses this to bisect out bad ids
   * before spending real gas.
   */
  // -> Uncomment below code in production & use the below one :
  // public async estimateClaimGas(nftIds: bigint[]): Promise<bigint> {
  //   return BigInt(await this.vault.claimWinnings.estimateGas(nftIds));
  // }
    public async estimateClaimGas(
      nftIds: bigint[],
      packedTickets: bigint[],
      winningPackedTicket: bigint,
      winningBallMax: bigint,
      winningAmount: bigint
    ): Promise<bigint> {
      return BigInt(await this.vault.claimWinnings.estimateGas(nftIds, packedTickets, winningPackedTicket, winningBallMax, winningAmount));
    }

  /**
   * Broadcasts vault.claimWinnings(nftIds) on the shared nonce lane and
   * returns as soon as it hits the mempool — the harvest worker owns receipt
   * polling (one in-flight batch at a time, so no confirmer split needed).
   */
  // -> Uncomment this as well & remove below one
  // public async submitClaimWinnings(nftIds: bigint[]): Promise<{ txHash: string; nonce: number }> {

  //   const estimated: bigint = await this.vault.claimWinnings.estimateGas(nftIds);
  //   const gasLimit = (estimated * 12n) / 10n; // 20% headroom

  //   return this.withNonceLane(async () => {
      
  //     if (this.nextNonce === null) {
  //       this.nextNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
  //     }

  //     const nonce = this.nextNonce;

  //     try {
  //       const tx = await this.vault.claimWinnings(nftIds, { gasLimit, nonce });
  //       this.nextNonce = nonce + 1;
  //       console.log(`[SERVICE:base] Harvest broadcast: ${nftIds.length} ticket(s), nonce=${nonce}, tx=${tx.hash}`);
  //       return { txHash: tx.hash as string, nonce };
  //     } catch (err) {
  //       this.resetNonceLane();
  //       throw err;
  //     }
  //   });
  // }

  public async submitClaimWinnings(
    nftIds: bigint[],
    packedTickets: bigint[],
    winningPackedTicket: bigint,
    winningBallMax: bigint,
    winningAmount: bigint
  ): Promise<{ txHash: string; nonce: number }> {
  
    const estimated: bigint = await this.vault.claimWinnings.estimateGas(nftIds, packedTickets, winningPackedTicket, winningBallMax, winningAmount);
    const gasLimit = (estimated * 12n) / 10n; // 20% headroom
  
    return this.withNonceLane(async () => {
      
      if (this.nextNonce === null) {
        this.nextNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
      }
  
      const nonce = this.nextNonce;
  
      try {
        const tx = await this.vault.claimWinnings(nftIds, packedTickets, winningPackedTicket, winningBallMax, winningAmount, { gasLimit, nonce });
        this.nextNonce = nonce + 1;
        console.log(`[SERVICE:base] Harvest broadcast: ${nftIds.length} ticket(s), nonce=${nonce}, tx=${tx.hash}`);
        return { txHash: tx.hash as string, nonce };
      } catch (err) {
        this.resetNonceLane();
        throw err;
      }
  
    });
  }

  /** Total USDC pulled into the vault, from OUR WinningsHarvested event. Null if absent. */
  public parseHarvestedFromReceipt(receipt: ethers.TransactionReceipt): bigint | null {
    const iface = new ethers.Interface(LordsPotBaseVault.abi);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'WinningsHarvested') {
          return BigInt((parsed.args.amountHarvested ?? parsed.args[1]).toString());
        }
      } catch { /* other contracts' logs (Megapot, USDC) — skip */ }
    }
    return null;
  }

  // ================= Revert classification =================

  public classifyError(err: any): RevertClass {
    const data: unknown = err?.data ?? err?.info?.error?.data ?? err?.error?.data;

    // Preferred path: decode the custom error selector against the vault ABI.
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
      try {
        const parsed = this.vault.interface.parseError(data);
        if (parsed) {
          if (parsed.name === 'OrderAlreadyProcessed') return { kind: 'already_processed' };
          if (parsed.name === 'EnforcedPause') return { kind: 'paused', reason: 'Base vault is paused' };
          if (parsed.name === 'OnlyRelayerAllowed') {
            return { kind: 'transient', reason: 'OnlyRelayerAllowed — relayer key/vault config mismatch, fix ops config' };
          }
          return { kind: 'permanent', reason: `Vault revert: ${parsed.name}` };
        }
      } catch { /* unknown selector (e.g. Megapot's own errors) — fall through */ }
    }

    // Fallback: string matching on whatever ethers surfaced. Checks the nested
    // provider error message too (err.info.error.message / err.error.message) —
    // ethers sometimes wraps a real, specific provider error (e.g. "gas limit
    // too high") in a generic top-level message like "could not coalesce error",
    // and the useful text only survives one level down.
    const msg: string =
      err?.reason ??
      err?.shortMessage ??
      err?.info?.error?.message ??
      err?.error?.message ??
      err?.message ??
      String(err);
    if (msg.includes('OrderAlreadyProcessed')) return { kind: 'already_processed' };
    if (msg.includes('EnforcedPause')) return { kind: 'paused', reason: msg };
    if (PERMANENT_ERROR_PATTERNS.test(msg)) return { kind: 'permanent', reason: msg };
    return { kind: 'transient', reason: msg };
  }

  // ================= Receipt / recovery helpers =================

  public parseTicketIdsFromReceipt(receipt: ethers.TransactionReceipt): bigint[] {
    const iface = new ethers.Interface(LordsPotBaseVault.abi);

    if (receipt.logs.length === 0) {
      console.warn(`[RECEIPT:parser] 0 logs in receipt ${receipt.hash} — contract emitted no TicketsRouted. Gas used: ${receipt.gasUsed}`);
    }

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'TicketsRouted') {
          const ids = parsed.args.ticketIds ?? parsed.args[3];
          const mappedIds = (ids as bigint[]).map((id) => BigInt(id.toString()));
          console.log(`[RECEIPT:parser] Extracted Ticket IDs: [${mappedIds.join(', ')}]`);
          return mappedIds;
        }
      } catch (error: any) {
        console.error(`[RECEIPT:parser] Failed to parse a log in ${receipt.hash}:`, error?.message ?? error);
      }
    }

    console.warn(`[RECEIPT:parser] No TicketsRouted event found in receipt ${receipt.hash}`);
    return [];
  }

  /**
   * Last-resort recovery: scan recent blocks for this order's TicketsRouted event.
   * Range is bounded to what public RPCs accept for eth_getLogs. The primary
   * recovery path is getTransactionReceipt(baseTxHash) — this exists for the
   * rare case where the tx hash was never persisted (crash mid-write).
   */
  public async findExistingFulfillment(
    orderId: string
  ): Promise<{ txHash: string; ticketIds: bigint[] } | null> {
    try {
      const latest = await this.provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 9_500); // ≈5.3h of Base blocks, under typical getLogs caps
      const filter = this.vault.filters.TicketsRouted(orderId);
      const events = await this.vault.queryFilter(filter, fromBlock, latest);

      if (events.length === 0) {
        console.log(`[CONTRACT] No historical TicketsRouted found for Order ID: ${orderId} in last ${latest - fromBlock} blocks`);
        return null;
      }

      const latestEvent = events[events.length - 1];
      const args = (latestEvent as ethers.EventLog).args;
      const ticketIds = (args?.ticketIds ?? args?.[3]) as bigint[];

      console.log(`[CONTRACT] Historical fulfillment located in Tx: ${latestEvent.transactionHash}`);
      return {
        txHash: latestEvent.transactionHash,
        ticketIds: [...ticketIds],
      };
    } catch (err: any) {
      console.error(`[CONTRACT] Error querying historical fulfillment for order ${orderId}:`, err?.message ?? err);
      return null;
    }
  }
}

export const baseService = new BaseService();
