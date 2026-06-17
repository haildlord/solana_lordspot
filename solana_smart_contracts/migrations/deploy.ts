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
  // // 1. Establish the default workspace provider context
  anchor.setProvider(provider);

  // // 2. Extract the compiled IDL from the workspace before the swap
  const workspaceProgram = anchor.workspace.SolanaSmartContracts;
  const idl = workspaceProgram.idl;

  // // 3. Decode your specific private key from your backend environment variables
  const solana_private_key_byteArray = bs58.decode(`${process.env.SOLANA_PRIVATE_KEY}`);
  const solanaKeyPair: Keypair = Keypair.fromSecretKey(solana_private_key_byteArray);

  // // 4. Wrap your custom keypair into a new wallet and provider session
  const customWallet = new anchor.Wallet(solanaKeyPair);
  const customProvider = new anchor.AnchorProvider(
    provider.connection, 
    customWallet, 
    anchor.AnchorProvider.defaultOptions()
  );

  console.log(provider.connection.rpcEndpoint);

  // 5. Re-bind the global anchor context to your elite custom provider
  anchor.setProvider(customProvider);

  // 6. Instantiate the program instance using the modern two-argument signature
  const program = new Program<SolanaSmartContracts>(idl, customProvider);

  // console.log("--------------------------------------------------");
  console.log(`[Deploy]: Target Program ID: ${program.programId.toBase58()}`);
  console.log(`[Deploy]: New Fee Payer / Admin Authority: ${customProvider.wallet.publicKey.toBase58()}`);

  // Game rules configuration parameters
  const NORMAL_MAX = 30; 
  const BONUS_MAX = 12;
  const TICKET_PRICE = new anchor.BN(1_000_000); // $1.00 USDC (6 decimals)
  console.log("--------------------------------------------------");

  // 1. Define constants matching your constants.rs / env
  const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  // 2. Derive Program Derived Addresses (PDAs)
  const [lordsPotStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lords_pot_state")],
    program.programId
  );

  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

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

  // try {
  //   const tx = await program.methods
  //     .initialize(NORMAL_MAX, BONUS_MAX, TICKET_PRICE)
  //     .accounts({
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     }).rpc();

  //   console.log(`[Success]: Megapot Protocol Initialized! Transaction: ${tx}`);
  
  // } catch (error) {
  //   console.error("[Error]: Failed to initialize protocol:", error);
  //   throw error;
  // }

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

  // try {
  //   // 3. Double-check if the contract state has already been initialized
  //   const stateAccount = await program.account.lordsPotState.fetch(lordsPotStatePda);
  //   console.log(`[Deploy]: Protocol already initialized! Admin is currently: ${stateAccount.admin.toBase58()}`);
  //   console.log(`[Deploy]: Protocol already initialized! Admin is currently: ${stateAccount.bonusMax}`);
  // } catch (err) {
  //   console.log("[Deploy]: PDA state not found. Executing fresh initialization transaction...");
  // }


  const buyerProgram = new Program<SolanaSmartContracts>(idl, provider);
  const buyer = provider.wallet;

  function generateLottery() {
    const numbers = new Set<number>();

    while (numbers.size < 5) {
        numbers.add(Math.floor(Math.random() * 30) + 1);
    }

    const special = Math.floor(Math.random() * 12) + 1;

    return {
        numbers: [...numbers].sort((a, b) => a - b),
        special
    };
}

  let tickets_to_buy = [];

  for (let i = 0; i < 1; i++){
    const {numbers, special} = generateLottery();
    tickets_to_buy.push(
      { normalBall: Buffer.from(numbers), 
        bonusBall: special
      }
    );
  }

  console.log(tickets_to_buy);
 
  // ! CUs Consumed / Limit -> 16,856 / 200,000
  const buyTx = await buyerProgram.methods
  .buyTicket(tickets_to_buy)
  .accounts({
    signer : buyer.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID
  })
  .rpc();

  console.log(`[Success]: LordsPot Protocol boought ticket! Transaction: ${buyTx}`);

}








