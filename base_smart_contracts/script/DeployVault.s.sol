// script/DeployVault.s.sol
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/LordsPotBaseVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 

contract DeployVault is Script { 

    function run() external {

        uint256 ownerPrivateKey = vm.envUint("RELAYER_BASE_SIGNER_PRIVATEKEY"); // My Test Relayer
        // ANVIL 1st key : 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 & 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
        // RELAYER       : 0x43848A2e9CDa31d1CD9Cc6abfAa90A36afE91295
        address owner = vm.addr(ownerPrivateKey);

        // 1. Load your deployer/owner key from the .env
        uint256 relayerPrivateKey = vm.envUint("RELAYER_BASE_SIGNER_PRIVATEKEY");
        address relayer = vm.addr(relayerPrivateKey);                               // 0x43848A2e9CDa31d1CD9Cc6abfAa90A36afE91295
        address megapotAddress = vm.envAddress("MEGAPOT_BASE_SEPOLIA_ADDRESS");             // 0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2
        address usdcAddress = vm.envAddress("USDC_BASE_SEPOLIA_ADDRESS");                   // 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
        address referrerAddress = vm.envAddress("BASE_REWARD_WALLET_ADDRESS");      // 0x3e2Cce5C52918081721b6cF47c7CB306aCb99c6d

        // 2. ANVIL key donating some ether to the relayer so that we can deploy our smart contract & call later buyTickets !
        // vm.startBroadcast(ownerPrivateKey);
        //     payable(relayer).call{value: 10 ether}("");
        // vm.stopBroadcast();

        // 3. RELAYER deploying our Base Vault, & passing itself, as later only relayer can buyTickets
        vm.startBroadcast(relayerPrivateKey);

            uint256 gasStart = gasleft();

            LordsPotBaseVault vault = new LordsPotBaseVault(
                owner,           
                relayer,         
                megapotAddress,  
                usdcAddress,     
                referrerAddress  
            );

            uint256 gasUsed = gasStart - gasleft();

        vm.stopBroadcast();

        uint256 ethSpent = gasUsed * tx.gasprice;


        // 4. Log the output
        console2.log("\n--- Base Vault Deployment Successful ---");
        console2.log("Vault deployed at: ", address(vault));
        console2.log("Owner Address:     ", owner);
        console2.log("Relayer Address:   ", relayer);

        console2.log("\n--- Deployment Cost ---");
        console2.log("Gas Units Used: ", gasUsed);
        console2.log("Wei Spent:      ", ethSpent);


        console2.log("\n>>> COPY VAULT ADDRESS -> GO TO Base Vault FAUCET -> MINT USDC <<<");
    }
}