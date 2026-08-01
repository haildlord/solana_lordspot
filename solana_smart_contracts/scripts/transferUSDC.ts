import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  transferChecked,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SolanaSmartContracts } from "../target/types/solana_smart_contracts";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import bs58 from 'bs58';

// --- CONFIGURATION ---

// 1. Which direction to move funds this run.
//    "deposit"  -> plain SPL transfer INTO the vault's USDC account. No
//                  program instruction involved — the vault account is just
//                  a normal token account, anyone can send it funds.
//    "withdraw" -> admin-gated program call, funds OUT of the vault.
const MODE: "deposit" | "withdraw" = "deposit";

// 2. Amount to move, in standard UI units (applies to whichever MODE is active).
const USDC_AMOUNT = 20;

// 3. WITHDRAW ONLY: where withdrawn funds go.
// Change this to your Treasury, CCTP depositor, or personal devnet wallet address.
const WITHDRAW_DESTINATION_WALLET = new PublicKey("HpAYk14jYpomivS4F7oXySN81sdoPvTaHtFsPgiK2jzf");

// 4. Devnet USDC Mint
const USDC_MINT_ADDRESS = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

async function main() {
  // ----------------------------------------------------
  // STEP 1: Load Deployer Keypair strictly from file
  // ----------------------------------------------------
  const keypairPath = path.resolve(__dirname, "../deployer-keypair.json");
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`❌ Keypair file not found at: ${keypairPath}`);
  }
  
  // Your private key (base58 string)
  const privateKey = "5q4fcE1JKeb4XTUQtrrxEYUCxR8QjWC2mqY9JBgDwyKpUskaVWthuDaZn6hf87XmPMUawRSfPPJDwqTxxNFEtnDN";
  const secretKey = bs58.decode(privateKey);


  // const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")));
  const depositorsKeypair = Keypair.fromSecretKey(secretKey);

  // Set up provider using the loaded deployer keypair explicitly
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const wallet = new anchor.Wallet(depositorsKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaSmartContracts as Program<SolanaSmartContracts>;

  console.log("🔑 Loaded Admin Keypair:", depositorsKeypair.publicKey.toBase58());

  // ----------------------------------------------------
  // STEP 2: Derive Program PDAs
  // ----------------------------------------------------
  const [lordsPotState] = PublicKey.findProgramAddressSync(
    [Buffer.from("lords_pot_state")],
    program.programId
  );

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  // The vault's associated token account (Vault Authority is the owner)
  const vaultUsdcAccount = getAssociatedTokenAddressSync(
    USDC_MINT_ADDRESS,
    vaultAuthority,
    true // allowOwnerOffCurve: true because vaultAuthority is a PDA!
  );

  console.log("🏛️  Vault Authority PDA:", vaultAuthority.toBase58());
  console.log("🏦 Vault USDC Account (ATA):", vaultUsdcAccount.toBase58());

  const rawAmount = new BN(Math.floor(USDC_AMOUNT * 1_000_000));

  if (MODE === "deposit") {
    // ----------------------------------------------------
    // DEPOSIT: plain token transfer, no program call. Any wallet holding
    // this devnet USDC can send it straight into the vault's ATA — the
    // vault account doesn't care who sends it funds, only who's allowed to
    // move them back out (that's the withdraw path's job).
    // ----------------------------------------------------
    console.log(`💰 Depositing ${USDC_AMOUNT} USDC (${rawAmount.toString()} base units) into the vault...`);

    // Ensures the vault's ATA exists on-chain (harmless no-op if it already
    // does) — anyone can pay to create an ATA for any owner, PDA or not.
    await getOrCreateAssociatedTokenAccount(
      connection,
      depositorsKeypair, // fee payer for account creation, if needed
      USDC_MINT_ADDRESS,
      vaultAuthority,
      true // allowOwnerOffCurve
    );

    // The source: deployer's own USDC ATA. It must already hold at least
    // USDC_AMOUNT of this devnet mint — this script can't mint new tokens,
    // it can only move existing ones.
    const sourceAta = await getOrCreateAssociatedTokenAccount(
      connection,
      depositorsKeypair,
      USDC_MINT_ADDRESS,
      depositorsKeypair.publicKey
    );
    console.log("📤 Source USDC Account:", sourceAta.address.toBase58());

    try {
      const txHash = await transferChecked(
        connection,
        depositorsKeypair, // fee payer
        sourceAta.address,
        USDC_MINT_ADDRESS,
        vaultUsdcAccount,
        depositorsKeypair, // owner/authority of the source account
        BigInt(rawAmount.toString()),
        6 // USDC decimals
      );

      console.log("\n✅ [SUCCESS]: Deposited into the vault!");
      console.log(`🔍 Transaction Hash: ${txHash}`);
    } catch (error: any) {
      console.error("\n❌ [ERROR]: Vault deposit failed!");
      console.error(error);
    }
    return;
  }

  // ----------------------------------------------------
  // WITHDRAW: admin-gated program instruction, funds OUT of the vault.
  // ----------------------------------------------------
  console.log(`🎯 Destination Wallet: ${WITHDRAW_DESTINATION_WALLET.toBase58()}`);

  // Ensures destination ATA exists so transaction won't fail if receiving wallet hasn't initialized its USDC account
  const destinationAta = await getOrCreateAssociatedTokenAccount(
    connection,
    depositorsKeypair, // fee payer
    USDC_MINT_ADDRESS,
    WITHDRAW_DESTINATION_WALLET
  );

  console.log("📦 Destination USDC Account:", destinationAta.address.toBase58());
  console.log(`💸 Withdrawing ${USDC_AMOUNT} USDC (${rawAmount.toString()} base units)...`);

  try {
    const txHash = await program.methods
      .withdrawVaultFunds(rawAmount)
      .accountsStrict({
        admin: depositorsKeypair.publicKey,
        lordsPotState: lordsPotState,
        vaultUsdcAccount: vaultUsdcAccount,
        destinationUsdcAccount: destinationAta.address,
        vaultAuthority: vaultAuthority,
        usdcMint: USDC_MINT_ADDRESS,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositorsKeypair])
      .rpc();

    console.log("\n✅ [SUCCESS]: Vault funds successfully withdrawn!");
    console.log(`🔍 Transaction Hash: ${txHash}`);
  } catch (error: any) {
    console.error("\n❌ [ERROR]: Vault withdrawal failed!");
    console.error(error);
  }
}

main().catch(console.error);
