import {PublicKey, Connection, Keypair, TransactionSignature, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, TransactionInstruction} from  "@solana/web3.js";
import {Program, AnchorProvider, Wallet} from "@coral-xyz/anchor";
import bs58 from "bs58";

import solana_idl from "../solana_idl/solana_smart_contracts.json"

class SolanaService{
    private connection : Connection;
    private wallet : Wallet;
    private provider : AnchorProvider;
    private program : Program;
    private statePda: PublicKey;

    constructor() {

        const solana_private_key = process.env.SOLANA_PRIVATE_KEY;
        const solana_rpc_url = process.env.SOLANA_RPC_URL; 

        if(!solana_private_key || !solana_rpc_url) {
            throw Error("FATAL: Missing SOLANA_PRIVATE_KEY or SOLANA_RPC_URL in environment variables.");
        }

        const solana_private_key_byteArray = bs58.decode(solana_private_key);
        const solanaKeyPair: Keypair = Keypair.fromSecretKey(solana_private_key_byteArray);

        this.wallet = new Wallet(solanaKeyPair);
        this.connection = new Connection(solana_rpc_url, "confirmed");
        this.provider = new AnchorProvider(this.connection, this.wallet, { preflightCommitment: "confirmed" });
        this.program = new Program(solana_idl, this.provider);
        this.statePda = PublicKey.findProgramAddressSync([Buffer.from("lords_pot_state")], this.program.programId)[0];

    }

    public async pauseProtocol() : Promise<TransactionSignature> {
        try {
            const pauseInstruction : TransactionInstruction = await this.program.methods.pauseProtocol().accounts({
                admin: this.wallet.publicKey,
                lordsPotState: this.statePda,
            }).instruction();

    
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 });
            const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });

            const messageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,      
                recentBlockhash: blockhash,           
                instructions: [
                    modifyComputeUnits,               
                    addPriorityFee,                   
                    pauseInstruction                  
                ]
            }).compileToV0Message();


            let transaction = new VersionedTransaction(messageV0);


            transaction = await this.wallet.signTransaction(transaction);


            const txSig = await this.connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                maxRetries: 3
            });

            console.log("LordsPot Successfully Paused, tx sig:", txSig);

            return txSig;

        } catch(err){
            console.error("Failed to Pause Smart contract", err);
            throw err;
        }
    }

    public async unpauseProtocol() : Promise<TransactionSignature> {

        try {

            const unpauseInstruction : TransactionInstruction = await this.program.methods.resumeProtocol().accounts({
                admin : this.wallet.publicKey,
                lordsPotState: this.statePda
            }).instruction();

            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 });
            const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }); // ! need to chage to dynamic instead static. <@ can be number | bigInt

            const messageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: [
                    modifyComputeUnits,
                    priorityFee,
                    unpauseInstruction
                ]
            }).compileToV0Message();

            let versionedTx = new VersionedTransaction(messageV0);
            versionedTx = await this.wallet.signTransaction(versionedTx);

            const txSig = await this.connection.sendRawTransaction(versionedTx.serialize(), {
                skipPreflight: false,
                maxRetries: 3
            });

            console.log("LordsPot Successfully Resumed, tx sig:", txSig);

            return txSig;

        } catch(err){
            console.error("Failed to Unpause Smart contract", err);
            throw err;
        }
    }

    public async updateEpochBounds(normals_max: number, bonus_max: number) : Promise<TransactionSignature> {
        try{
            
            if (!Number.isInteger(normals_max) || normals_max <= 0 || !Number.isInteger(bonus_max) || bonus_max <= 0) {
                throw new Error(`[SolanaService]: Invalid bounds from API. Normals: ${normals_max}, Bonus: ${bonus_max}`);
            }

            const updateIx : TransactionInstruction = await this.program.methods.updateEpoch(normals_max, bonus_max).accounts({
                admin: this.wallet.publicKey,
                lordsPotState: this.statePda
            }).instruction();

            const {blockhash, lastValidBlockHeight} = await this.connection.getLatestBlockhash();
            const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({units: 15_000});
            const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({microLamports: 50_000});

            const messageV0 = new TransactionMessage({
                payerKey: this.wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: [
                    modifyComputeUnits,
                    priorityFee,
                    updateIx
                ]
            }).compileToV0Message();

            let versionedTx = new VersionedTransaction(messageV0);
            versionedTx = await this.wallet.signTransaction(versionedTx);

            const txSig = await this.connection.sendRawTransaction(versionedTx.serialize(), {
                skipPreflight: false,
                maxRetries: 3
            });

        console.log(`LordsPot Bounds Updated [${normals_max} / ${bonus_max}], tx sig:`, txSig);

            return txSig;
        }catch(error){
            console.error("Error while updating normal max & bonus max in solana:", error);
            throw error;
        }
    }
}

export const solanaService = new SolanaService();