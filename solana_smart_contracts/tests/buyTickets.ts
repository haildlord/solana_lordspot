import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SolanaSmartContracts } from "../target/types/solana_smart_contracts";
import "dotenv/config";

async function main() {

  // 1. Tell Anchor to automatically use the default environment configuration
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const buyerProgram = anchor.workspace.SolanaSmartContracts as Program<SolanaSmartContracts>;
  const buyer = provider.wallet; 

  function generateLottery() {
    const numbers = new Set<number>();
    while (numbers.size < 5) {
      numbers.add(Math.floor(Math.random() * 30) + 1);
    }
    const special = Math.floor(Math.random() * 10) + 1;
    return {
      numbers: [...numbers].sort((a, b) => a - b),
      special,
    };
  }

  console.log(`\n👤 Signer Wallet (CLI Default): ${buyer.publicKey.toBase58()}`);
  
  let tickets_to_buy = [];

  tickets_to_buy = [
    // Tier 11
    { normalBall: Buffer.from([3,10,16,22,23]), bonusBall: 5 },
  
    // Tier 10
    { normalBall: Buffer.from([3,10,16,22,23]), bonusBall: 7 },
  
    // Tier 9
    { normalBall: Buffer.from([3,10,16,22,25]), bonusBall: 5 },
  
    // Tier 8
    { normalBall: Buffer.from([3,10,16,22,25]), bonusBall: 8 },
  
    // Tier 7
    { normalBall: Buffer.from([3,10,16,27,28]), bonusBall: 5 },
  
    // Tier 6
    { normalBall: Buffer.from([3,10,16,27,28]), bonusBall: 9 },
  
    // Tier 5
    { normalBall: Buffer.from([1,3,10,29,30]), bonusBall: 5 },
  
    // Tier 4
    { normalBall: Buffer.from([1,3,10,29,30]), bonusBall: 6 },
  
    // Tier 3
    { normalBall: Buffer.from([3,11,12,13,14]), bonusBall: 5 },
  
    // Tier 2
    { normalBall: Buffer.from([3,11,12,13,14]), bonusBall: 7 },
  
    // Tier 1
    { normalBall: Buffer.from([6,7,8,9,11]), bonusBall: 5 },
  
    // Tier 0
    { normalBall: Buffer.from([6,7,8,9,11]), bonusBall: 4 },
  ];

    // // Loop 3 times to generate 3 unique tickets
    // for (let i = 0; i < 3; i++) {
    //     const { numbers, special } = generateLottery();
    //     tickets_to_buy.push({
    //       normalBall: Buffer.from(numbers),
    //       bonusBall: special,
    //     });
    //   }

  console.log("🎟️ Buying Ticket:", tickets_to_buy);

  try {
    const buyTx = await buyerProgram.methods
      .buyTicket(tickets_to_buy)
      .accounts({
        signer: buyer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`\n✅ [SUCCESS]: Ticket purchased!`);
    console.log(`🔍 Transaction Signature: ${buyTx}\n`);
  } catch (error) {
    console.error("\n❌ [ERROR]: Transaction failed!");
    console.error(error);
  }
}

main().catch(console.error);


  // anchor test --skip-local-validator --skip-deploy
  
  // const pauseTx = await program.methods
  // .pauseProtocol()
  // .accounts({
  //   admin: solanaKeyPair.publicKey
  // }).rpc();
  // console.log(`[Success]: Megapot Protocol Paused! Transaction: ${pauseTx}`);


  // const updateTx = await program.methods
  // .updateEpoch(9, 9)
  // .accounts({
  //   admin: solanaKeyPair.publicKey
  // }).rpc();

  // console.log(`[Success]: Megapot Protocol Updated! Transaction: ${updateTx}`);


  // const resumetx = await program.methods
  // .resumeProtocol()
  // .accounts({
  //   admin: solanaKeyPair.publicKey,
  // }).rpc();

  // console.log(`[Success]: Megapot Protocol Resumed! Transaction: ${resumetx}`);


//   const buyerProgram = new Program<SolanaSmartContracts>(idl, provider);
//   const buyer = provider.wallet;

//   function generateLottery() {
//     const numbers = new Set<number>();

//     while (numbers.size < 5) {
//         numbers.add(Math.floor(Math.random() * 30) + 1);
//     }

//     const special = Math.floor(Math.random() * 12) + 1;

//     return {
//         numbers: [...numbers].sort((a, b) => a - b),
//         special
//     };
// }

  // let tickets_to_buy = [];

  // for (let i = 0; i < 1; i++){
  //   const {numbers, special} = generateLottery();
  //   tickets_to_buy.push(
  //     { normalBall: Buffer.from(numbers), 
  //       bonusBall: special
  //     }
  //   );
  // }

  // console.log(tickets_to_buy);
 
  // ! CUs Consumed / Limit -> 16,856 / 200,000
  // const buyTx = await buyerProgram.methods
  // .buyTicket(tickets_to_buy)
  // .accounts({
  //   signer : buyer.publicKey,
  //   tokenProgram: TOKEN_PROGRAM_ID
  // })
  // .rpc();

  // console.log(`[Success]: LordsPot Protocol boought ticket! Transaction: ${buyTx}`);