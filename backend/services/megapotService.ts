import { RoundState } from "../interfaces/types";
import { solanaService } from "./solanaService"; 

class MegapotService {
    private cachedRoundState: RoundState | null = null;
    private tryAfterSec = 1;
    private isSyncing = false;
    
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
        this.cachedRoundState = await this.fetchActiveRound();
    }

    private async transitionLoop() {
        // Step 1: Resilient Pause Execution
        try {
            await solanaService.pauseProtocol();
        } catch (error) {
            console.warn("[transitionLoop]: Pause transaction encountered a network error. Checking on-chain reality...");
            
            // Check if it was a phantom success
            const postPauseState = await solanaService.getOnChainState();
            if (!postPauseState.isLordsPotPaused) {
                console.error("[transitionLoop]: CRITICAL - Protocol is genuinely unpaused and transaction failed. Halting context.", error);
                // FUTURE: Trigger Discord/Slack Webhook here for PAUSE FAILURE
                return; // Genuine failure: Safe to exit since contract is still live
            }
            console.log("[transitionLoop]: Phantom Pause confirmed on-chain. Proceeding safely to polling phase.");
        }

        const oldData = this.getRoundState()!;
        let retryCount = 0;
    
        // Step 2: Isolated Polling & JIT Execution Phase
        while(true) {
            try {
                const fetchedData = await this.fetchActiveRound();
                const { bonusball_max, normals_max, id } = fetchedData;

                if (id > oldData.id) {
                    
                    // --- THE ELITE DEFENSE ---
                    // Verify actual on-chain reality before attempting to broadcast
                    const onChainState = await solanaService.getOnChainState();

                    if (!onChainState.isLordsPotPaused) {
                        console.log("[transitionLoop]: Phantom Success detected! Protocol is already unpaused on-chain. Recovering safely.");
                        this.cachedRoundState = fetchedData;
                        break; 
                    }
                    // -------------------------

                    // Clean, single-line evaluation
                    const needsUpdate = bonusball_max !== oldData.bonusball_max || normals_max !== oldData.normals_max;
                    
                    await solanaService.resumeAndTransitionEpoch(normals_max, bonusball_max, needsUpdate);
                    
                    this.cachedRoundState = fetchedData;
                    break;
                }

                retryCount = 0;

            } catch(error) {
                retryCount++;
                console.error(`[transitionLoop]: Loop failed. Attempt ${retryCount}. Error:`, error);
                
                if (retryCount >= 10) {
                    console.error("CRITICAL: Protocol is stuck frozen! Halting thread execution to prevent cascading infinite loops.");
                    // Elite approach: Trigger alerting, but DO NOT break/continue scheduling.
                    // Returning halts the thread so the container orchestration can restart it cleanly.
                    return; 
                }
            } finally {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Only schedule the next cycle if the transaction loop resolved successfully
        await this.setup_next_fetch_cron();
    }

    private async setup_next_fetch_cron() {
        const savedData = this.getRoundState();
        if(!savedData || !savedData.bonusball_max || !savedData.ended_at || !savedData.id || !savedData.normals_max){
            await this.startSync();
        }else{
            const { ended_at } = savedData;
            const time_now = Date.now();
            const end_time = new Date(ended_at).getTime();
            
            if (time_now >= end_time) {
                await this.transitionLoop();
            } else {
                const diffMs = end_time - time_now;
                setTimeout(async () => {
                    await this.transitionLoop();
                }, diffMs);
            }
        }
    }

    public async startSync() {
        if (this.isSyncing) {
            console.log("[startSync]: Sync already in progress. Ignoring duplicate trigger.");
            return;
        }
        this.isSyncing = true; // Engage the lock

        try {
            console.log("[startSync]: Trying to fetch and save megapot's active round data locally");
            await this.performUpdate();
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

    public getRoundState() {
        return this.cachedRoundState;
    }
}

export const megapotService = new MegapotService();