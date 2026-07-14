import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync 
} from "@solana/spl-token";
import bs58 from "bs58";

import {SolanaSmartContracts} from "../target/types/solana_smart_contracts";

import { configDotenv } from "dotenv";

configDotenv();

module.exports = async function (provider: anchor.AnchorProvider) {

  // 1. Provider :
  // CLI : anchor migrate --provider.cluster "https://devnet.helius-rpc.com/?api-key=XYZ" --provider.wallet ./deployer-keypair.json ( AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS )
  anchor.setProvider(provider);

  // 2. Get IDL of LordsPot
  const workspaceProgram = anchor.workspace.SolanaSmartContracts;
  const idl = workspaceProgram.idl;

  // 3. RELAYER_SOLANA_PRIVATE_KEY of `AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS`
  const solana_private_key_byteArray = bs58.decode(`${process.env.RELAYER_SOLANA_PRIVATE_KEY}`);
  const solanaKeyPair: Keypair = Keypair.fromSecretKey(solana_private_key_byteArray);

  // 4. Create a Provider -> ( RELAYER_SOLANA_PRIVATE_KEY, CLI "https://devnet.helius-rpc.com/?api-key=XYZ" )
  const customWallet = new anchor.Wallet(solanaKeyPair);
  const customProvider = new anchor.AnchorProvider(
    provider.connection, 
    customWallet, 
    anchor.AnchorProvider.defaultOptions()
  );

  // 5. attach the provider to anchor
  anchor.setProvider(customProvider);

  // 6. Attach the Created Provider, to sign for the programs, using RELAYER_SOLANA_PRIVATE_KEY & program
  const program = new Program<SolanaSmartContracts>(idl, customProvider);

  // console.log("--------------------------------------------------");
  console.log(`[Deploy]: Target Program ID: ${program.programId.toBase58()}`);
  console.log(`[Deploy]: New Fee Payer / Admin Authority: ${customProvider.wallet.publicKey.toBase58()}`);

  // Game rules configuration parameters
  const NORMAL_MAX = 10; 
  const BONUS_MAX = 12;
  const TICKET_PRICE = new anchor.BN(1_000_000); // $1.00 USDC (6 decimals)
  const INIT_EPOCH = new anchor.BN(112);
  console.log("--------------------------------------------------");


  // 2. Derive Program Derived Addresses (PDAs)
  const [lordsPotStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lords_pot_state")],
    program.programId
  );

  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  // Define constants matching your constants.rs / env -- ! change this when Mainnet
  const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  // Derive the Vault Associated Token Account (ATA) owned by our Vault Authority PDA
  const vaultUsdcAccount = getAssociatedTokenAddressSync(
    DEVNET_USDC_MINT,
    vaultAuthorityPda,
    true, // Allow owner to be a PDA
    TOKEN_PROGRAM_ID
  );


  console.log("--------------------------------------------------");
  console.log(`[PDA] Lords Pot State:  ${lordsPotStatePda.toBase58()}`);
  console.log(`[PDA] Vault Authority:  ${vaultAuthorityPda.toBase58()}`);
  console.log(`[ATA] Vault USDC Token: ${vaultUsdcAccount.toBase58()}`);
  console.log("--------------------------------------------------");

  try {
    const tx = await program.methods
      .initialize(NORMAL_MAX, BONUS_MAX, TICKET_PRICE, INIT_EPOCH)
      .accounts({
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

    console.log(`[Success]: Megapot Protocol Initialized! Transaction: ${tx}`);
  
  } catch (error) {
    console.error("[Error]: Failed to initialize protocol:", error);
    throw error;
  }


  try {
    // 3. Double-check if the contract state has already been initialized
    const stateAccount = await program.account.lordsPotState.fetch(lordsPotStatePda);
    
    console.log("\n=== 🟢 PROTOCOL ALREADY INITIALIZED ===");
    console.log(`Admin:           ${stateAccount.admin.toBase58()}`);
    console.log(`Normal Max:      ${stateAccount.normalMax}`);
    console.log(`Bonus Max:       ${stateAccount.bonusMax}`);
    
    // u64 types become BN (BigNumber) in JS, so we must use .toString()
    console.log(`Ticket Price:    ${stateAccount.ticketPrice.toString()} (Raw Units)`);
    console.log(`Ongoing Epoch:   ${stateAccount.ongoingEpoch.toString()}`);
    
    console.log(`Is Paused:       ${stateAccount.isLordsPotPaused}`);
    console.log(`PDA Bump:        ${stateAccount.bump}`);
    console.log("=======================================\n");
    
  } catch (err) {
    console.log("[Deploy]: PDA state not found. Executing fresh initialization transaction...");
  }

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

}








