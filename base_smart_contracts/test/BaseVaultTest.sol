// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {LordsPotBaseVault, IJackpot} from "../src/LordsPotBaseVault.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}

contract BaseVaultTest is Test {
    LordsPotBaseVault public vault;

    // --- Environment & Test Variables ---
    address public owner;
    address public relayer;
    address public megapotAddress;
    address public usdcAddress;
    address public referrerAddress;

    function setUp() public {
        vault = LordsPotBaseVault(vm.envAddress("LORDSPOT_BASE_VAULT"));
        usdcAddress = vm.envAddress("USDC_BASE_ADDRESS");
    }

    function test_LiveDeploymentState() public view {
        console2.log(IERC20(usdcAddress).balanceOf(address(vault))); // 10_882 * 1e6 USDC
    }
}