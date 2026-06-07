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
        
        const data = await response.json();

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
        try {
            await solanaService.pauseProtocol();
        } catch (error) {
            console.error("[transitionLoop]: CRITICAL - Failed to pause contract. Manual intervention required!", error);
            return; 
        }

        const oldData = this.getRoundState()!;
        
        let hasUpdatedContract = false;
        let retryCount = 0;
    
        while(true){
            try{
                
                const fetchedData = await this.fetchActiveRound();
                const {bonusball_max, normals_max, id, ended_at} = fetchedData;

                if(id > oldData.id){
                    if(bonusball_max != oldData.bonusball_max || normals_max != oldData.normals_max){

                        if (!hasUpdatedContract) {
                            await solanaService.updateEpochBounds(normals_max, bonusball_max);
                            hasUpdatedContract = true; 
                        }
                    }
                    
                    await solanaService.unpauseProtocol();
                    this.cachedRoundState = fetchedData;
                    break;
                }

                retryCount = 0;

            }catch(error){
                retryCount++;
                console.error(`[transitionLoop]: Loop failed. Attempt ${retryCount}. Error:`, error.message);
                
                if (retryCount >= 10) {
                    console.error("CRITICAL: Protocol is stuck in a paused state! Intervention required immediately!");
                    // FUTURE: Trigger Discord/Slack Webhook here
                }
            } finally{
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        await this.setup_next_fetch_cron();
    }

    private async setup_next_fetch_cron() {

        const savedData = this.getRoundState();
        if(!savedData || !savedData.bonusball_max || !savedData.ended_at || !savedData.id || !savedData.normals_max){
            await this.startSync();
        }else{
            const {bonusball_max, normals_max, id, ended_at} = savedData;
            const time_now = Date.now();
            const end_time = new Date(ended_at).getTime();
            
            if (time_now >= end_time) {
                await this.transitionLoop();
            } else {
                const diffMs = new Date(ended_at).getTime() - Date.now();
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