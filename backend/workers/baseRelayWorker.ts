import { Worker, Job } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/db";
import { ethers } from "ethers";
import LordsPotBaseVault from "../base_abi/LordsPotBaseVault.json";

// 1. Setup Anvil Fork Provider and Wallet
const ANVIL_RPC_URL = "http://127.0.0.1:8545"; 
const SIGNER_PRIVATE_KEY = process.env.RELAYER_BASE_SIGNER_PRIVATEKEY!;
const VAULT_ADDRESS = process.env.LORDSPOT_BASE_VAULT!;
const REWARD_WALLET = process.env.BASE_REWARD_WALLET_ADDRESS!;

const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, provider);

// Load the contract with the ABI from your compiled JSON artifact
const vaultContract = new ethers.Contract(VAULT_ADDRESS, LordsPotBaseVault.abi, wallet);

const baseRelayWorker = new Worker(
    "relay-to-base",
    async (job: Job) => {

        const { hash } = job.data;

        if (!hash) {
            console.error("[RELAYER CRITICAL]: Job received without a hash!");
            return;
        } 

        console.log(`\n[RELAYER]: Picked up job for order: ${hash.slice(0, 10)}...`);

        // A. Fetch the Order AND its connected Tickets
        const order = await prisma.relayOrder.findUnique({
            where: { hash: hash },
            include: { tickets: true }
        });

        // B. Idempotency Check (Prevent Double-Spends)
        if (!order || order.status !== "QUEUED") {
            console.log(`[RELAYER]: Order ${hash} is already processed or not found. Skipping.`);
            return; 
        }

        // C. Lock the Order State to prevent race conditions
        await prisma.relayOrder.update({
            where: { hash: hash },
            data: { status: "PROCESSING" }
        });

        console.log(`[RELAYER]: Order locked as PROCESSING. Tickets to buy: ${order.tickets.length}`);

        try {
            // D. Format the EVM Payload exactly as the ABI expects
            const formattedTickets = order.tickets.map(ticket => ({
                normals: ticket.normalBalls,
                bonusball: ticket.bonusBall 
            }));
            
            const referrers = [REWARD_WALLET];
            const referralSplitBps = [1000000000000000000n]; // 10% using BigInt (1e17)

            // E. Execute the Cross-Chain Transaction
            console.log(`[RELAYER]: Broadcasting transaction to Anvil EVM...`);
            const tx = await vaultContract.buyTickets(
                hash,               // _orderId (bytes32 - ethers.id generates exactly 32 bytes)
                formattedTickets,   // _tickets (tuple[])
                referrers,          // _referrers (address[])
                referralSplitBps,   // _referralSplitBps (uint256[])
                hash                // _source (bytes32)
            );

            console.log(`[RELAYER]: Tx broadcasted! Hash: ${tx.hash}. Waiting for block...`);

            // F. Wait for 1 block confirmation (Mining)
            await tx.wait(1);
            console.log(`[RELAYER]: Tx confirmed in block! Order ${hash.slice(0, 10)}... complete!`);

            // G. Finalize the Database State
            await prisma.relayOrder.update({
                where: { hash: hash },
                data: { status: "SUCCESS" }
            });

        } catch (error) {
            console.error(`[RELAYER ERROR]: EVM Transaction failed for order ${hash}`, error);
            
            // H. Revert the Database State so we know it failed
            await prisma.relayOrder.update({
                where: { hash: hash },
                data: { status: "FAILED" }
            });

            // I. THROW the error so BullMQ knows the job failed and triggers the retry backoff!
            throw error; 
        }

    }, {
        connection: redisConnection,
        concurrency: 1
    }
);

export default baseRelayWorker;