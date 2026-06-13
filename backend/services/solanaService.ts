import {
    PublicKey, 
    Connection, 
    Keypair, 
    TransactionSignature, 
    ComputeBudgetProgram, 
    TransactionMessage, 
    VersionedTransaction, 
    TransactionInstruction
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";

import solana_idl from "../solana_idl/solana_smart_contracts.json";
import { SolanaSmartContracts } from "../solana_types/solana_smart_contracts";

// # Pause : 3,874; Unpause: 3,877 CUs; Update: 4,357 CUs  -- dont delete it 
class SolanaService {

    private isMainnet: boolean; // ! for testing purpose only
    private connection: Connection;
    private wallet: Wallet;
    private provider: AnchorProvider;
    private program: Program<SolanaSmartContracts>;
    private statePda: PublicKey;

    private readonly FALLBACK_PRIORITY_FEE = 1000;
    private readonly CU_LIMIT_PAUSE = 4200;
    private readonly CU_LIMIT_UNPAUSE_ONLY = 4500;
    private readonly CU_LIMIT_UPDATE_UNPAUSE = 9500;

    constructor() {
        const solana_private_key = process.env.SOLANA_PRIVATE_KEY;
        const solana_rpc_url = process.env.SOLANA_RPC_URL; 
        const environment = process.env.NODE_ENV || 'development';

        if (!solana_private_key || !solana_rpc_url) {
            throw Error("FATAL: Missing SOLANA_PRIVATE_KEY or SOLANA_RPC_URL in environment variables.");
        }

        this.isMainnet = environment === 'production' || solana_rpc_url.includes('mainnet');

        const solana_private_key_byteArray = bs58.decode(solana_private_key);
        const solanaKeyPair: Keypair = Keypair.fromSecretKey(solana_private_key_byteArray);

        this.wallet = new Wallet(solanaKeyPair);
        
        // Single connection instance
        this.connection = new Connection(solana_rpc_url, "confirmed");
        this.provider = new AnchorProvider(this.connection, this.wallet, { preflightCommitment: "confirmed" });
        
        // Cast the IDL to the strict type to satisfy the compiler
        this.program = new Program(solana_idl as SolanaSmartContracts, this.provider);
        this.statePda = PublicKey.findProgramAddressSync([Buffer.from("lords_pot_state")], this.program.programId)[0];
    }

    private async getPriorityFeeEstimate(serializedTransaction: string, priorityLevel = "Medium"): Promise<number> {

        if (!this.isMainnet) {
            console.log(`[SolanaService]: Devnet detected. Bypassing fee estimator. Using fallback.`);
            return this.FALLBACK_PRIORITY_FEE;
        }

        try {
            const response = await fetch(this.connection.rpcEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: "1",
                    method: "getPriorityFeeEstimate",
                    params: [{
                        transaction: serializedTransaction,
                        options: { priorityLevel: priorityLevel }
                    }]
                })
            });
            
            const result = await response.json();
            
            if (result.error) {
                throw new Error(`Fee estimation failed: ${JSON.stringify(result.error)}`);
            }
            
            return Math.floor(result.result.priorityFeeEstimate);
        } catch (error) {
            console.error("[SolanaService]: Mainnet priority fee fetch failed, using fallback.", error);
            return this.FALLBACK_PRIORITY_FEE;
        }
    }

    public async pauseProtocol(): Promise<TransactionSignature> {
        try {
            const pauseInstruction: TransactionInstruction = await this.program.methods.pauseProtocol().accounts({
                admin: this.wallet.publicKey,
                // Anchor auto-resolves lordsPotState
            }).instruction();

            const { blockhash } = await this.connection.getLatestBlockhash();
            
            const dummyMessage = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: [pauseInstruction]
            }).compileToV0Message();

            const dummyTransaction = new VersionedTransaction(dummyMessage);
            const serializedDummyTx = Buffer.from(dummyTransaction.serialize()).toString('base64');

            // The method handles Devnet bypass AND Mainnet error fallbacks internally
            const priorityFee = await this.getPriorityFeeEstimate(serializedDummyTx, "Medium");
    
            const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: this.CU_LIMIT_PAUSE });
            const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee });

            const finalMessageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,      
                recentBlockhash: blockhash,           
                instructions: [
                    modifyComputeUnits,              
                    addPriorityFee,                   
                    pauseInstruction                  
                ]
            }).compileToV0Message();

            let transaction = new VersionedTransaction(finalMessageV0);
            transaction = await this.wallet.signTransaction(transaction);

            const txSig = await this.connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                maxRetries: 3
            });

            console.log("LordsPot Successfully Paused, tx sig:", txSig);
            return txSig;

        } catch (err) {
            console.error("Failed to Pause Smart contract", err);
            throw err;
        }
    }

    public async resumeAndTransitionEpoch(normals_max: number, bonus_max: number, needsUpdate: boolean): Promise<TransactionSignature> {
        try {
            const coreInstructions: TransactionInstruction[] = [];

            if (needsUpdate) {
                if (!Number.isInteger(normals_max) || normals_max <= 0 || !Number.isInteger(bonus_max) || bonus_max <= 0) {
                    throw new Error(`[SolanaService]: Invalid bounds from API. Normals: ${normals_max}, Bonus: ${bonus_max}`);
                }

                console.log(`[SolanaService]: Bounds changed. Including Update Instruction [${normals_max} / ${bonus_max}]`);
                
                const updateIx = await this.program.methods.updateEpoch(normals_max, bonus_max).accounts({
                    admin: this.wallet.publicKey,
                    // Anchor auto-resolves lordsPotState
                }).instruction();

                coreInstructions.push(updateIx);
            } else {
                console.log(`[SolanaService]: Bounds unchanged. Skipping Update Instruction.`);
            }

            const unpauseInstruction = await this.program.methods.resumeProtocol().accounts({
                admin: this.wallet.publicKey,
                // Anchor auto-resolves lordsPotState
            }).instruction();

            coreInstructions.push(unpauseInstruction);

            const { blockhash } = await this.connection.getLatestBlockhash();

            const dummyMessage = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: coreInstructions 
            }).compileToV0Message();

            const dummyTransaction = new VersionedTransaction(dummyMessage);
            const serializedDummyTx = Buffer.from(dummyTransaction.serialize()).toString('base64');

            // The method handles Devnet bypass AND Mainnet error fallbacks internally
            const priorityFee = await this.getPriorityFeeEstimate(serializedDummyTx, "Medium");

            const exactComputeLimit = needsUpdate ? this.CU_LIMIT_UPDATE_UNPAUSE : this.CU_LIMIT_UNPAUSE_ONLY;
            
            const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: exactComputeLimit });
            const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee });

            const finalInstructions = [modifyComputeUnits, addPriorityFee, ...coreInstructions];

            const finalMessageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: finalInstructions
            }).compileToV0Message();

            let versionedTx = new VersionedTransaction(finalMessageV0);
            versionedTx = await this.wallet.signTransaction(versionedTx);

            const txSig = await this.connection.sendRawTransaction(versionedTx.serialize(), {
                skipPreflight: false,
                maxRetries: 3
            });

            console.log(`LordsPot Successfully Resumed (Update Included: ${needsUpdate}), tx sig:`, txSig);
            return txSig;

        } catch (err) {
            console.error("Failed to execute Epoch Transition & Unpause", err);
            throw err;
        }
    }

    public async getOnChainState() {
        try {
            return await this.program.account.lordsPotState.fetch(this.statePda);
        } catch (error) {
            console.error("[SolanaService]: Failed to fetch on-chain state", error);
            throw error;
        }
    }
}

export const solanaService = new SolanaService();


