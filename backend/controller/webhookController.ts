import { Request, Response } from "express";
import { ticketQueue } from "../lib/redis";


let testReq = [
    {
      blockTime: 1782083345,
      indexWithinBlock: 78,
      meta: {
        err: null,
        fee: 5000,
        innerInstructions: [
          {
            index: 0,
            instructions: [
              {
                accounts: [ 1, 5, 2, 0 ],
                data: 'iZGR3oiPrKgtV',
                programIdIndex: 9
              }
            ]
          }
        ],
        loadedAddresses: { readonly: [], writable: [] },
        logMessages: [
          'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo invoke [1]',
          'Program log: Instruction: BuyTicket',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 105 of 182402 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program data: ahyrVCd3TvPvoC75oMXB++kEd1zs7vyTYBhow6HLRgc4gn4oWiywacDGLQAAAAAAAwAAAAMAAAAFAAAAAgYHERoIBQAAAA4SFx0eBQUAAAAFDRIaHQoRbzhqAAAAAFkAAAAAAAAA',
          'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo consumed 18954 of 200000 compute units',
          'Program 5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo success'
        ],
        postBalances: [
          6266826072,      2039280,
             2039280,            1,
             1308480, 349440958969,
             1141440,   5938070540,
                   0,  12107573357
        ],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            owner: 'H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            uiTokenAmount: {
              amount: '53000000',
              decimals: 6,
              uiAmount: 53,
              uiAmountString: '53'
            }
          },
          {
            accountIndex: 2,
            mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            owner: 'LgtTwqMcP9vtJ3L19AMgEho2LJ77zFmRwtPTYqbyPGK',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            uiTokenAmount: {
              amount: '6000000',
              decimals: 6,
              uiAmount: 6,
              uiAmountString: '6'
            }
          }
        ],
        preBalances: [
          6266831072,      2039280,
             2039280,            1,
             1308480, 349440958969,
             1141440,   5938070540,
                   0,  12107573357
        ],
        preTokenBalances: [
          {
            accountIndex: 1,
            mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            owner: 'H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            uiTokenAmount: {
              amount: '56000000',
              decimals: 6,
              uiAmount: 56,
              uiAmountString: '56'
            }
          },
          {
            accountIndex: 2,
            mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            owner: 'LgtTwqMcP9vtJ3L19AMgEho2LJ77zFmRwtPTYqbyPGK',
            programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            uiTokenAmount: {
              amount: '3000000',
              decimals: 6,
              uiAmount: 3,
              uiAmountString: '3'
            }
          }
        ],
        rewards: []
      },
      slot: 471056782,
      transaction: {
        message: {
          accountKeys: [
            'H8Q7CUvPigtSxfd13TKRuFrwdJtc6pJu9BMNhbXF9yAY',
            '7qo9uWHJmJ9mSPFdUCueUBQpwkyQ3RwimeZ4uvcbJoZ8',
            'A59FKpMApFfsKwEqrd5YWoEUyGefDWvJSd4CzS4X8Grb',
            '11111111111111111111111111111111',
            '13fJA2pmD837DpSMFGGzcpGw4jS1P1cbncEUGnstvEYz',
            '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            '5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo',
            'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
            'LgtTwqMcP9vtJ3L19AMgEho2LJ77zFmRwtPTYqbyPGK',
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ],
          addressTableLookups: null,
          header: {
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 7,
            numRequiredSignatures: 1
          },
          instructions: [
            {
              accounts: [
                0, 4, 1, 2, 8,
                5, 3, 9, 7
              ],
              data: 'BjrfqrU3xSkKxeqMCpdfq9Zvzd469NQJ2LGhdN6AricsFzLddLGnDQzZF',
              programIdIndex: 6
            }
          ],
          recentBlockhash: 'FA7D78geTMajZmWkSTiXxUzRKpFdWZuMVfV4d8SAKZUG'
        },
        signatures: [
          '2ZSvKPZeZLKr34wjCaxKkikSq3bhsnK9vjCsZqNHeeNiQKjtBPkPz4FkDEivfitrut1cQPHe18uTo27u6eqeC4X4'
        ]
      },
      version: 'legacy'
    }
  ]


export const webhookController = async (req: Request, res: Response) => {
    try { 
        // const transactions = req.body;  
        const transactions = testReq

        console.dir(transactions, { depth: null, colors: true });
        
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