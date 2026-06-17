import { Request, Response } from "express";
import { Queue } from "bullmq";
import IoRedis from "ioredis";

// 1. Setup Redis Connection for the Queue
const redisConnection = new IoRedis({
    port: 6379,
    host: "127.0.0.1"
});

const ticketQueue = new Queue("ticket-ingestion", { connection: redisConnection });

// 2. Hardcoded Mock Payload
// let testReq = [
//     {
//         "blockTime": 1781408980,
//         "indexWithinBlock": 15,
//         "meta": {
//             "err": null,
//             "fee": 10000,
//             "innerInstructions": [{ "index": 0, "instructions": [{ "accounts": [2, 5, 3, 1], "data": "gvQzKgr3xhN2h", "programIdIndex": 10 }] }],
//             "loadedAddresses": { "readonly": [], "writable": [] },
//             "logMessages": [
//                 "Program 6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9 invoke [1]",
//                 "Program log: Instruction: BuyTicket",
//                 "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]",
//                 "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 105 of 183588 compute units",
//                 "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
//                 "Program data: ahyrVCd3TvPvoC75oMXB++kEd1zs7vyTYBhow6HLRgc4gn4oWiywaUBLTAAAAAAABQAAAAUAAAAFAAAABgcMEhMHBQAAAAIEDBcaDAUAAAAJCgwREgMFAAAAAQoPGh4DBQAAAAILDBMZCtQkLmoAAAAA",
//                 "Program 6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9 consumed 17868 of 200000 compute units",
//                 "Program 6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9 success"
//             ],
//             "postBalances": [996692920, 7894609972, 2039280, 2039280, 1, 344430958969, 1141440, 1252800, 0, 5938070540, 12091573357],
//             "postTokenBalances": [
//                 { "accountIndex": 2, "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "owner": "H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY", "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "uiTokenAmount": { "amount": "35000000", "decimals": 6, "uiAmount": 35, "uiAmountString": "35" } },
//                 { "accountIndex": 3, "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "owner": "9FbmTbmkrxYQp9Qka8sy3HdMVGDUx3tjaWeATvffq9T8", "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "uiTokenAmount": { "amount": "5000000", "decimals": 6, "uiAmount": 5, "uiAmountString": "5" } }
//             ],
//             "preBalances": [996702920, 7894609972, 2039280, 2039280, 1, 344430958969, 1141440, 1252800, 0, 5938070540, 12091573357],
//             "preTokenBalances": [
//                 { "accountIndex": 2, "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "owner": "H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY", "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "uiTokenAmount": { "amount": "40000000", "decimals": 6, "uiAmount": 40, "uiAmountString": "40" } },
//                 { "accountIndex": 3, "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "owner": "9FbmTbmkrxYQp9Qka8sy3HdMVGDUx3tjaWeATvffq9T8", "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "uiTokenAmount": { "amount": "0", "decimals": 6, "uiAmount": 0, "uiAmountString": "0" } }
//             ],
//             "rewards": []
//         },
//         "slot": 469294159,
//         "transaction": {
//             "message": {
//                 "accountKeys": ["AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS", "H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY", "7qo9uWHJmJ9mSPFdUCueUBQpwkyQ3RwimeZ4uvcbJoZ8", "F4dBmqgm6gT5z3ey26DRicuQcFgy5DkNtena3F7pFyZx", "11111111111111111111111111111111", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9", "7fXCYjg71RXkGGfhg7UWapG2nAsRFzaixPf3ZxJ7691E", "9FbmTbmkrxYQp9Qka8sy3HdMVGDUx3tjaWeATvffq9T8", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
//                 "addressTableLookups": null,
//                 "header": { "numReadonlySignedAccounts": 0, "numReadonlyUnsignedAccounts": 7, "numRequiredSignatures": 2 },
//                 "instructions": [{ "accounts": [1, 7, 2, 3, 8, 5, 4, 10, 9], "data": "fJRaCEAtS3He3xsj5TJ5T5eRFa3P7A45F8zqKrJ3de1TDxocmL24cUq2YDP1gGWKAn4NxKmVQQ3XrHXkejBf", "programIdIndex": 6 }],
//                 "recentBlockhash": "4pttJv3bPAw3i4L3PGHLJ6HdUJ2Yai8haBz1omRGrb9o"
//             },
//             "signatures": [
//                 "36pLSP8Myu6mXmYRqjTmeBZRH5HRUkxAe5hHZP8Ja4ExsxFZX7mVDJvP6f9S91nWwZeQ9VqHDWeKTn6RKDkSF82r",
//                 "cQFn1erzhWQPSDoc81WbiigJwZSLSPXq4zNJLEzkGEMtwigwqWRKRGeSpgBsK132U1SvjPSycNcttnm6YzfJDwx"
//             ]
//         },
//         "version": "legacy"
//     }
// ];

// 3. Controller Logic
export const webhookController = async (req: Request, res: Response) => {
    try { 
        const transactions = req.body;  
        
        if (!transactions || !Array.isArray(transactions) || transactions.length === 0){
            console.log("[webhookController] : Received empty or invalid webhook payload.");
            return res.status(200).send("Ok");
        }

        const transaction = transactions[0];

        if (!transaction?.meta?.logMessages) {
            console.log("No logs found in this transaction.");
            return res.status(200).send("Ok");     
        }

        console.log(`\n[webhookController]: Helius payload arrived via ngrok!`);

        const logs = transaction.meta.logMessages;
        const signature = transaction.transaction?.signatures?.[0] || "unknown_sig";

        await ticketQueue.add("process-solana-logs", {
            signature, logs
        }, {
            attempts: 3,  
            backoff: 5000 
        });

        console.log(`[webhookController]: Job successfully locked into Redis RAM. Transaction: ${signature.slice(0, 8)}...`);

        return res.status(200).send("Ok");

    } catch (error) {
        console.error("[webhookController] : Webhook Ingestion Error:", error);
        return res.status(500).send("Internal Server Error");
    }
}