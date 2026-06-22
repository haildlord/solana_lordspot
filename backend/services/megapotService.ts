import { RoundState } from "../interfaces/types";
import { solanaService } from "./solanaService"; 
import { redisConnection } from "../lib/redis";

class MegapotService {
    private tryAfterSec = 1;
    private isSyncing = false;
    private readonly CACHE_KEY = "megapot:active_round";
    private readonly PAUSE_KEY = "megapot:is_paused";
    private readonly PRE_EMPTIVE_BUFFER_MS = 15 * 1000; // 15 seconds
    
    private async fetchActiveRound(): Promise<RoundState> {
        const response = await fetch('https://api.megapot.io/v1/rounds/active', {
            method: 'GET',
            headers: {
                authorization: `Bearer ${process.env.MEGAPOT_API_KEY}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch active round: ${response.statusText} with status code: ${response.status}`);
        }
        
        const data = await response.json() as any;

        if (!data || !data.ball_pool || !data.ended_at || !data.id) {
            throw new Error('Malformed API response: Missing ball_pool data structure');
        }

        const { ball_pool: { normals_max, bonusball_max }, ended_at, id } = data;

        if (typeof normals_max !== 'number' || typeof bonusball_max !== 'number' || typeof ended_at !== 'string' || typeof id !== 'string') {
            throw new Error('Invalid API data types: Expected numbers for ball pool bounds and string for timestamp');
        }

        return {
            normals_max,
            bonusball_max,
            ended_at,
            id: parseInt(id, 10)
        };
    }

    private async performUpdate() {
        const currentRoundInfo = await this.fetchActiveRound();
        await redisConnection.set(this.CACHE_KEY, JSON.stringify(currentRoundInfo));
    }

    // Reads the active round purely from Redis
    public async getRoundState(): Promise<RoundState | null> {
        const data = await redisConnection.get(this.CACHE_KEY);
        if (!data) return null;
        return JSON.parse(data) as RoundState;
    }

    // Helper for the Webhook Controller to check if we are paused
    public async isProtocolPaused(): Promise<boolean> {
        const isPaused = await redisConnection.get(this.PAUSE_KEY);
        return isPaused === "true";
    }

    private async transitionLoop() {
        // Step 1: Resilient Pause Execution
        try {
            await solanaService.pauseProtocol();
            await redisConnection.set(this.PAUSE_KEY, "true"); // Tell the webhook to drop payloads
        } catch (error) {
            console.warn("[transitionLoop]: Pause transaction encountered a network error. Checking on-chain reality...");
            
            const postPauseState = await solanaService.getOnChainState();
            if (!postPauseState.isLordsPotPaused) {
                console.error("[transitionLoop]: CRITICAL - Protocol is genuinely unpaused and transaction failed.", error);
                return; 
            }
            console.log("[transitionLoop]: Phantom Pause confirmed on-chain. Proceeding safely to polling phase.");
            await redisConnection.set(this.PAUSE_KEY, "true"); 
        }

        const oldData = await this.getRoundState();
        if (!oldData) return;

        let retryCount = 0;
    
        // Step 2: Isolated Polling & JIT Execution Phase
        while(true) {
            try {
                const fetchedData = await this.fetchActiveRound();
                const { bonusball_max, normals_max, id } = fetchedData;

                if (id > oldData.id) {
                    
                    const onChainState = await solanaService.getOnChainState();

                    if (!onChainState.isLordsPotPaused) {
                        console.log("[transitionLoop]: Phantom Success detected! Protocol is already unpaused on-chain. Recovering safely.");
                        await redisConnection.set(this.CACHE_KEY, JSON.stringify(fetchedData));
                        await redisConnection.set(this.PAUSE_KEY, "false"); // Tell Webhook to accept payloads again
                        break; 
                    }

                    const needsUpdate = bonusball_max !== oldData.bonusball_max || normals_max !== oldData.normals_max;
                    
                    await solanaService.resumeAndTransitionEpoch(normals_max, bonusball_max, needsUpdate);
                    
                    await redisConnection.set(this.CACHE_KEY, JSON.stringify(fetchedData));
                    await redisConnection.set(this.PAUSE_KEY, "false"); // Tell Webhook to accept payloads again
                    break;
                }

                retryCount = 0;

            } catch(error) {
                retryCount++;
                console.error(`[transitionLoop]: Loop failed. Attempt ${retryCount}. Error:`, error);
                
                if (retryCount >= 10) {
                    console.error("CRITICAL: Protocol is stuck frozen! Halting thread execution.");
                    return; 
                }
            } finally {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        await this.setup_next_fetch_cron();
    }

    private async setup_next_fetch_cron() {
        // Must use await here!
        const savedData = await this.getRoundState();

        if(!savedData || !savedData.bonusball_max || !savedData.ended_at || !savedData.id || !savedData.normals_max){
            await this.startSync();
            return;
        }

        const { ended_at } = savedData;
        const time_now = Date.now();
        const end_time = new Date(ended_at).getTime();
        
        // Perfect calculation of the Danger Zone
        const diffMs = (end_time - time_now) - this.PRE_EMPTIVE_BUFFER_MS;
        
        if (diffMs <= 0) {
            console.log("[CRON]: Inside danger zone! Initiating immediate protocol pause.");
            await this.transitionLoop();
        } else {
            console.log(`[CRON]: Safe. Scheduling Pre-Emptive Pause in ${diffMs / 1000} seconds.`);
            setTimeout(async () => {
                await this.transitionLoop();
            }, diffMs);
        }
    }

    public async startSync() {
        if (this.isSyncing) {
            console.log("[startSync]: Sync already in progress. Ignoring duplicate trigger.");
            return;
        }
        this.isSyncing = true; 

        try {
            console.log("[startSync]: Trying to fetch and save megapot's active round data locally");
            await this.performUpdate();
            await redisConnection.set(this.PAUSE_KEY, "false"); // Default to false on boot
            
            console.log("[startSync]: Successfully saved megapot's data locally");
            await this.setup_next_fetch_cron();
            this.tryAfterSec = 1;
            
            this.isSyncing = false; 
        }catch(error){
            console.log("[startSync]: Error occured while saving the data locally :", error);
            this.tryAfterSec *= 2;
            if (this.tryAfterSec > 300){
                this.tryAfterSec = 300; 
                console.log("[startSync]: Max Delay of 5 mins reached, now will try every 5 mins");    
            }
            console.log(`[startSync]: Retrying in ${this.tryAfterSec} secs`);
            setTimeout(async () => {
                this.isSyncing = false; 
                await this.startSync();
            }, this.tryAfterSec * 1000);
        }
    }
}

export const megapotService = new MegapotService();





// hail_the_lord@j backend % npm run dev

// > backend@1.0.0 dev
// > tsx watch server.ts

// Server is running on port: 3000
// [SYSTEM]: Bootstrapping Megapot Sync Engine...
// [startSync]: Trying to fetch and save megapot's active round data locally
// [startSync]: Successfully saved megapot's data locally
// [CRON]: Safe. Scheduling Pre-Emptive Pause in 158.605 seconds.
// [SolanaService]: Devnet detected. Bypassing fee estimator. Using fallback.
// Failed to Pause Smart contract SendTransactionError: Simulation failed. 
// Message: Transaction simulation failed: Error processing Instruction 2: Program failed to complete. 
// Logs: 
// [
//   "Program ComputeBudget111111111111111111111111111111 invoke [1]",
//   "Program ComputeBudget111111111111111111111111111111 success",
//   "Program ComputeBudget111111111111111111111111111111 invoke [1]",
//   "Program ComputeBudget111111111111111111111111111111 success",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo invoke [1]",
//   "Program log: Instruction: PauseProtocol",
//   "Program log: Protocol Paused.",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo consumed 3900 of 3900 compute units",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo failed: exceeded CUs meter at BPF instruction"
// ]. 
// Catch the `SendTransactionError` and call `getLogs()` on it for full details.
//     at Connection.sendEncodedTransaction (/Users/hail_the_lord/code/project/solana_lordspot/backend/node_modules/@solana/web3.js/src/connection.ts:6053:13)
//     at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
//     at async Connection.sendRawTransaction (/Users/hail_the_lord/code/project/solana_lordspot/backend/node_modules/@solana/web3.js/src/connection.ts:6009:20)
//     at async SolanaService.pauseProtocol (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/solanaService.ts:129:27)
//     at async MegapotService.transitionLoop (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/megapotService.ts:65:13)
//     at async Timeout._onTimeout (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/megapotService.ts:150:17) {
//   signature: '',
//   transactionMessage: 'Transaction simulation failed: Error processing Instruction 2: Program failed to complete',
//   transactionLogs: [
//     'Program ComputeBudget111111111111111111111111111111 invoke [1]',
//     'Program ComputeBudget111111111111111111111111111111 success',
//     'Program ComputeBudget111111111111111111111111111111 invoke [1]',
//     'Program ComputeBudget111111111111111111111111111111 success',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo invoke [1]',
//     'Program log: Instruction: PauseProtocol',
//     'Program log: Protocol Paused.',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo consumed 3900 of 3900 compute units',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo failed: exceeded CUs meter at BPF instruction'
//   ]
// }
// [transitionLoop]: Pause transaction encountered a network error. Checking on-chain reality...
// [transitionLoop]: CRITICAL - Protocol is genuinely unpaused and transaction failed. SendTransactionError: Simulation failed. 
// Message: Transaction simulation failed: Error processing Instruction 2: Program failed to complete. 
// Logs: 
// [
//   "Program ComputeBudget111111111111111111111111111111 invoke [1]",
//   "Program ComputeBudget111111111111111111111111111111 success",
//   "Program ComputeBudget111111111111111111111111111111 invoke [1]",
//   "Program ComputeBudget111111111111111111111111111111 success",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo invoke [1]",
//   "Program log: Instruction: PauseProtocol",
//   "Program log: Protocol Paused.",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo consumed 3900 of 3900 compute units",
//   "Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo failed: exceeded CUs meter at BPF instruction"
// ]. 
// Catch the `SendTransactionError` and call `getLogs()` on it for full details.
//     at Connection.sendEncodedTransaction (/Users/hail_the_lord/code/project/solana_lordspot/backend/node_modules/@solana/web3.js/src/connection.ts:6053:13)
//     at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
//     at async Connection.sendRawTransaction (/Users/hail_the_lord/code/project/solana_lordspot/backend/node_modules/@solana/web3.js/src/connection.ts:6009:20)
//     at async SolanaService.pauseProtocol (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/solanaService.ts:129:27)
//     at async MegapotService.transitionLoop (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/megapotService.ts:65:13)
//     at async Timeout._onTimeout (/Users/hail_the_lord/code/project/solana_lordspot/backend/services/megapotService.ts:150:17) {
//   signature: '',
//   transactionMessage: 'Transaction simulation failed: Error processing Instruction 2: Program failed to complete',
//   transactionLogs: [
//     'Program ComputeBudget111111111111111111111111111111 invoke [1]',
//     'Program ComputeBudget111111111111111111111111111111 success',
//     'Program ComputeBudget111111111111111111111111111111 invoke [1]',
//     'Program ComputeBudget111111111111111111111111111111 success',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo invoke [1]',
//     'Program log: Instruction: PauseProtocol',
//     'Program log: Protocol Paused.',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo consumed 3900 of 3900 compute units',
//     'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo failed: exceeded CUs meter at BPF instruction'
//   ]
// }