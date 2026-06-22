// script/DeployVault.s.sol
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/LordsPotBaseVault.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; 

contract DeployVault is Script { 
    function run() external {

        uint256 ownerPrivateKey =
            0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address owner = vm.addr(ownerPrivateKey);

        // 1. Load your deployer/owner key from the .env
        uint256 relayerPrivateKey = vm.envUint("RELAYER_BASE_SIGNER_PRIVATEKEY");
        address relayer = vm.addr(relayerPrivateKey);
        address megapotAddress = vm.envAddress("MEGAPOT_BASE_ADDRESS");
        address usdcAddress = vm.envAddress("USDC_BASE_ADDRESS");
        address referrerAddress = vm.envAddress("BASE_REWARD_WALLET_ADDRESS");

        vm.startBroadcast(ownerPrivateKey);
        payable(relayer).call{value: 10 ether}("");
        vm.stopBroadcast();

        // 3. Broadcast the deployment to BuildBear
        vm.startBroadcast(relayerPrivateKey);

        LordsPotBaseVault vault = new LordsPotBaseVault(
            owner,           
            relayer,         
            megapotAddress,  
            usdcAddress,     
            referrerAddress  
        );

        vm.stopBroadcast();

        // 4. Log the output
        console2.log("\n--- BuildBear Deployment Successful ---");
        console2.log("Vault deployed at: ", address(vault));
        console2.log("Owner Address:     ", owner);
        console2.log("Relayer Address:   ", relayer);
        console2.log("\n>>> COPY VAULT ADDRESS -> GO TO BUILDBEAR FAUCET -> MINT USDC <<<");
    }
}


// == Logs ==
  
// --- BuildBear Deployment Successful ---
//   Vault deployed at:  0x1889658017e76EC4BCB6C92A06D0ba7F9c9CfF71
//   Owner Address:      0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
//   Relayer Address:    0x43848A2e9CDa31d1CD9Cc6abfAa90A36afE91295
  
// >>> COPY VAULT ADDRESS -> GO TO BUILDBEAR FAUCET -> MINT USDC <<<

// ## Setting up 1 EVM.

// ==========================

// Chain 8453

// Estimated gas price: 0.011 gwei

// Estimated total gas used for script: 2646781

// Estimated amount required: 0.000029114591 ETH

// ==========================

// ##### base
// ✅  [Success] Hash: 0xa6242c667e3fcbc43f448351c7478becc305fec872d8bd301180ae94eb48ac84
// Block: 47608324
// Paid: 0.000000113967798 ETH (21000 gas * 0.005427038 gwei)


// ##### base
// ✅  [Success] Hash: 0xf009c35b2090e0c39cbe921214897f186398463a3d52b1a5273b79bfe40bd1f1
// Contract Address: 0x1889658017e76EC4BCB6C92A06D0ba7F9c9CfF71
// Block: 47608325
// Paid: 0.000009814077206258 ETH (2013674 gas * 0.004873717 gwei)

// ✅ Sequence #1 on base | Total Paid: 0.000009928045004258 ETH (2034674 gas * avg 0.005150377 gwei)


// 🐋

// hail_the_lord@j base_smart_contracts % cast send 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 "transfer(address,uint256)" 0x1889658017e76EC4BCB6C92A06D0ba7F9c9CfF71 10000000 --from 0x33a7A26d9C6C799a02E4870137dE647674371FfC --unlocked

// blockHash            0x55da5848eba707e741502a6aaba26c4c0656437121ac2dbe174877125d5fb77c
// blockNumber          47608326
// contractAddress      
// cumulativeGasUsed    62159
// effectiveGasPrice    4394378
// from                 0x33a7A26d9C6C799a02E4870137dE647674371FfC
// gasUsed              62159
// logs                 [{"address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef","0x00000000000000000000000033a7a26d9c6c799a02e4870137de647674371ffc","0x0000000000000000000000001889658017e76ec4bcb6c92a06d0ba7f9c9cff71"],"data":"0x0000000000000000000000000000000000000000000000000000000000989680","blockHash":"0x55da5848eba707e741502a6aaba26c4c0656437121ac2dbe174877125d5fb77c","blockNumber":"0x2d67206","blockTimestamp":"0x6a37426b","transactionHash":"0x3679ea639a6a5c853d333f2cbee5855ce436ea490a49a6e5b2b26f4e433f2ee6","transactionIndex":"0x0","logIndex":"0x0","removed":false}]
// logsBloom            0x00000000000020000000000000000000000000000000000000000000000000000000200000000000000000000000100000000000000000000008000000000000000000000000000000000008000000000000000000080000000000000000000000800000000000000000000000000000000000000010000000010010000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
// root                 
// status               1 (success)
// transactionHash      0x3679ea639a6a5c853d333f2cbee5855ce436ea490a49a6e5b2b26f4e433f2ee6
// transactionIndex     0
// type                 2
// blobGasPrice         1
// blobGasUsed          
// to                   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913