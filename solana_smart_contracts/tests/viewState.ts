import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSmartContracts } from "../target/types/solana_smart_contracts";
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

async function main() {
  // 1. Initialize Anchor using local environment settings (.env or Anchor.toml)
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // 2. Load the workspace program typed definitions
  const program = anchor.workspace.SolanaSmartContracts as Program<SolanaSmartContracts>;

  // 3. Derive the exact State PDA address matching the contract seeds
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lords_pot_state")],
    program.programId
  );

  console.log(`\n📡 Querying Devnet Solana RPC Node...`);
  console.log(`🎯 Program ID: ${program.programId.toBase58()}`);
  console.log(`🔍 State PDA : ${statePda.toBase58()}`);

  try {
    // 4. Read the raw account state directly from the blockchain
    const state = await program.account.lordsPotState.fetch(statePda);

    // 5. Render out the data points clearly
    console.log("\n==================================================");
    console.log("🔮 LORDS POT LIVE CONTRACT STATE");
    console.log("==================================================");
    console.log(`▶️  Ongoing Epoch       : ${state.ongoingEpoch.toString()}`);
    console.log(`⏸️  Is Protocol Paused  : ${state.isLordsPotPaused ? "⚠️ YES (Paused)" : "✅ NO (Active)"}`);
    console.log(`👑 Admin PublicKey     : ${state.admin.toBase58()}`);
    console.log(`🎫 Ticket Price (Raw)  : ${state.ticketPrice.toString()}`);
    console.log(`🎯 Normal Balls Max    : ${state.normalMax}`);
    console.log(`⭐ Bonus Ball Max      : ${state.bonusMax}`);
    console.log(`🧬 State Account Bump  : ${state.bump}`);
    console.log("==================================================\n");

  } catch (error) {
    console.error("\n❌ [ERROR] Could not fetch state data!");
    console.error("This usually means the program is not deployed at this address or hasn't been initialized yet.");
    console.error(error);
  }
}

main().catch(console.error);