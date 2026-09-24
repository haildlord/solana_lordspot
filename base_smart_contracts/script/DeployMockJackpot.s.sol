// script/DeployMockJackpot.s.sol
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/LordsPotBaseVault.sol";
import "../test/mocks/MockJackpot.sol";

/// Deploys the test-only MockJackpot and points the vault at it, so local
/// harvest/claim testing no longer depends on the real Megapot contract's
/// actual drawing progress on the forked chain. See MockJackpot.sol for why.
///
/// Run against your local Anvil fork:
///   forge script script/DeployMockJackpot.s.sol --broadcast --rpc-url http://localhost:8545
///
/// To go back to the real Megapot contract later, call setVaultMegapotAddress
/// again with MEGAPOT_BASE_ADDRESS (see script/RestoreRealJackpot.s.sol).
contract DeployMockJackpot is Script {
    // Anvil's well-known default account #0 — same owner key DeployVault.s.sol uses.
    uint256 constant OWNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    // Flat test payout per claimed ticket (6-decimal USDC units) — 5 USDC.
    uint256 constant PAYOUT_PER_TICKET = 5_000_000;

    function run() external {
        address vaultAddress = vm.envAddress("LORDSPOT_BASE_VAULT");
        address usdcAddress = vm.envAddress("USDC_BASE_ADDRESS");

        LordsPotBaseVault vault = LordsPotBaseVault(vaultAddress);

        vm.startBroadcast(OWNER_KEY);

        MockJackpot mock = new MockJackpot(usdcAddress, PAYOUT_PER_TICKET);
        vault.setVaultMegapotAddress(address(mock));

        vm.stopBroadcast();

        console2.log("\n--- Mock Jackpot Deployed ---");
        console2.log("MockJackpot address: ", address(mock));
        console2.log("Vault now points at the mock instead of the real Megapot.");
        console2.log("\n>>> Next: fund it with test USDC (it holds none yet) - see docs/testing-with-mock-jackpot.md");
    }
}
