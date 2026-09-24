// script/RestoreRealJackpot.s.sol
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/LordsPotBaseVault.sol";

/// Points the vault back at the real Megapot contract after testing against
/// MockJackpot (see DeployMockJackpot.s.sol).
///
///   forge script script/RestoreRealJackpot.s.sol --broadcast --rpc-url http://localhost:8545
contract RestoreRealJackpot is Script {
    uint256 constant OWNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        address vaultAddress = vm.envAddress("LORDSPOT_BASE_VAULT");
        address realMegapotAddress = vm.envAddress("MEGAPOT_BASE_ADDRESS");

        LordsPotBaseVault vault = LordsPotBaseVault(vaultAddress);

        vm.startBroadcast(OWNER_KEY);
        vault.setVaultMegapotAddress(realMegapotAddress);
        vm.stopBroadcast();

        console2.log("Vault now points back at the real Megapot contract:", realMegapotAddress);
    }
}
