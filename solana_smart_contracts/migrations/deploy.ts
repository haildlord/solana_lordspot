import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
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
  const NORMAL_MAX = 30;
  const BONUS_MAX = 10;
  const TICKET_PRICE = new anchor.BN(1_000_000); // $1.00 USDC (6 decimals)
  const INIT_EPOCH = new anchor.BN(152);

  // Relay economics. Keep RELAY_FEE_* in sync with frontend/src/solana/constants.ts
  // (the UI quotes from those; the program is what actually charges).
  //
  // ZERO BY DESIGN. LordsPot is Megapot's referrer and earns ~10% of every $1
  // ticket — roughly 10x the ~$0.01 of Base gas it costs to relay one. Charging
  // a fee on top would suppress the volume that actually pays for the protocol.
  // The mechanism stays in place (set_relay_config can raise it without a
  // redeploy) as the lever if Base gas ever spikes past break-even, ~0.06 gwei.
  const RELAY_FEE_BASE = new anchor.BN(0);
  const RELAY_FEE_PER_TICKET = new anchor.BN(0);
  // Where relay fees land. Its USDC ATA must EXIST before the first purchase —
  // buy_ticket does not create it, and the constraint is checked even when the
  // fee is zero. Must NOT be a wallet that also buys tickets: buyer and fee
  // recipient resolving to the same account fails with
  // ConstraintDuplicateMutableAccount.
  const FEE_RECIPIENT = customProvider.wallet.publicKey;
  // Bounded by SOLANA'S 1232-byte transaction limit (~75 tickets bare, ~70 with
  // compute-budget instructions), NOT by Base. The relayer re-chunks to Base's
  // own limit independently, so these two numbers are deliberately decoupled.
  const MAX_TICKETS_PER_PURCHASE = 65;
  // Plausibility ceiling on a single payout — raise deliberately if a real
  // jackpot win legitimately exceeds it (it fails closed, blocking the claim).
  const MAX_CLAIM_AMOUNT = new anchor.BN(100_000_000_000); // $100,000 USDC

  // ⚠️ THE COLD KEY — the ONLY key that can withdraw the vault.
  //
  // On devnet this points at the deployer for convenience. BEFORE MAINNET this
  // MUST become a separate key that never touches the backend: a hardware
  // wallet or a Squads multisig. The whole point of the split is that the hot
  // admin key (which sits in the server's env and auto-signs claim vouchers
  // every few minutes) cannot move the treasury. Pointing both at the same
  // wallet gives that protection up entirely.
  //
  // Rotate later with set_treasury_authority — it needs the CURRENT treasury
  // key to sign, so admin alone can never reassign it.
  const TREASURY_AUTHORITY = customProvider.wallet.publicKey; // ! change to a cold key before mainnet
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

  // A v1 state account (deployed before the relay-economics fields existed)
  // holds 60 bytes. The current struct needs 246. Decide by SIZE, never by
  // trying to decode — decoding a v1 account with the current IDL is exactly
  // the RangeError this migration exists to fix.
  const LEGACY_STATE_SIZE = 60;
  const existing = await provider.connection.getAccountInfo(lordsPotStatePda);

  try {
    if (existing === null) {
      // ---- Fresh deployment: born at the current layout, no migration ever ----
      const tx = await program.methods
        .initialize(
          NORMAL_MAX,
          BONUS_MAX,
          TICKET_PRICE,
          INIT_EPOCH,
          RELAY_FEE_BASE,
          RELAY_FEE_PER_TICKET,
          FEE_RECIPIENT,
          MAX_TICKETS_PER_PURCHASE,
          MAX_CLAIM_AMOUNT,
          TREASURY_AUTHORITY
        )
        .accounts({
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();

      console.log(`[Success]: Megapot Protocol Initialized! Transaction: ${tx}`);

    } else if (existing.data.length === LEGACY_STATE_SIZE) {
      // ---- Live v1 account: grow it in place, preserving admin/epoch/price ----
      console.log(`[Migrate]: v1 state detected (${existing.data.length} bytes) — upgrading in place.`);
      console.log(`[Migrate]: admin, epoch, ticket price and pause flag are preserved; only new fields are written.`);

      const tx = await program.methods
        .migrateState(
          RELAY_FEE_BASE,
          RELAY_FEE_PER_TICKET,
          FEE_RECIPIENT,
          MAX_TICKETS_PER_PURCHASE,
          MAX_CLAIM_AMOUNT,
          TREASURY_AUTHORITY
        )
        .accounts({
          admin: customProvider.wallet.publicKey,
        } as never).rpc();

      console.log(`[Success]: State migrated to the current layout! Transaction: ${tx}`);

    } else {
      console.log(`[Skip]: State account already at ${existing.data.length} bytes — nothing to initialize or migrate.`);

      // BOOTSTRAP: an account migrated to v2 BEFORE treasury_authority existed
      // carries all-zero bytes there (they were still part of _reserved). Left
      // that way, withdraw_vault_funds can never be signed by anyone and the
      // vault is stranded — migrate_state cannot help, it no-ops at full size.
      // set_treasury_authority's admin-bootstrap branch is the only way out.
      const state = await program.account.lordsPotState.fetch(lordsPotStatePda);

      if (state.treasuryAuthority.equals(PublicKey.default)) {
        console.log(`[Bootstrap]: treasury_authority is unset (all-zero) — setting it now.`);
        console.log(`[Bootstrap]: without this, NOBODY could ever withdraw from the vault.`);

        const tx = await program.methods
          .setTreasuryAuthority()
          .accounts({
            authority: customProvider.wallet.publicKey,
            newTreasury: TREASURY_AUTHORITY,
          } as never)
          .rpc();

        console.log(`[Success]: Treasury authority set to ${TREASURY_AUTHORITY.toBase58()}! Transaction: ${tx}`);
      }

      // SYNC RELAY CONFIG. The constants above are the source of truth; the
      // live account may predate a change to them. Only sends a transaction
      // when something actually differs, so re-running this is free and safe.
      const fresh = await program.account.lordsPotState.fetch(lordsPotStatePda);
      const drift =
        !fresh.relayFeeBase.eq(RELAY_FEE_BASE) ||
        !fresh.relayFeePerTicket.eq(RELAY_FEE_PER_TICKET) ||
        !fresh.feeRecipient.equals(FEE_RECIPIENT) ||
        fresh.maxTicketsPerPurchase !== MAX_TICKETS_PER_PURCHASE ||
        !fresh.maxClaimAmount.eq(MAX_CLAIM_AMOUNT);

      if (drift) {
        console.log(`[Config]: on-chain relay config differs from deploy.ts — syncing.`);
        console.log(`  fee/ticket : ${fresh.relayFeePerTicket.toString()} -> ${RELAY_FEE_PER_TICKET.toString()}`);
        console.log(`  fee/base   : ${fresh.relayFeeBase.toString()} -> ${RELAY_FEE_BASE.toString()}`);
        console.log(`  max tkts/ix: ${fresh.maxTicketsPerPurchase} -> ${MAX_TICKETS_PER_PURCHASE}`);

        const tx = await program.methods
          .setRelayConfig(
            RELAY_FEE_BASE,
            RELAY_FEE_PER_TICKET,
            FEE_RECIPIENT,
            MAX_TICKETS_PER_PURCHASE,
            MAX_CLAIM_AMOUNT
          )
          .accounts({ admin: customProvider.wallet.publicKey } as never)
          .rpc();

        console.log(`[Success]: Relay config synced! Transaction: ${tx}`);
      } else {
        console.log(`[Config]: on-chain relay config already matches deploy.ts — nothing to sync.`);
      }
    }
  } catch (error) {
    console.error("[Error]: Failed to initialize/migrate protocol:", error);
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
    console.log(`State Version:   v${stateAccount.version}`);
    console.log("--- Relay economics ---");
    console.log(`Relay Fee Base:  ${stateAccount.relayFeeBase.toString()} (Raw Units)`);
    console.log(`Relay Fee/Ticket:${stateAccount.relayFeePerTicket.toString()} (Raw Units)`);
    console.log(`Fee Recipient:   ${stateAccount.feeRecipient.toBase58()}`);
    console.log(`Max Tickets/Ix:  ${stateAccount.maxTicketsPerPurchase}`);
    console.log(`Max Claim:       ${stateAccount.maxClaimAmount.toString()} (Raw Units)`);
    console.log(`Treasury (cold): ${stateAccount.treasuryAuthority.toBase58()}`);
    if (stateAccount.treasuryAuthority.equals(stateAccount.admin)) {
      console.log(`  ⚠️  Treasury == admin. Fine on devnet; on MAINNET this means the`);
      console.log(`      always-online hot key can drain the vault. Rotate with set_treasury_authority.`);
    }
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








