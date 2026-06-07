// SPDX-License-Identifier: MIT

/*
    Copyright (C) 2025 Coordination Inc.
    All rights reserved.

    This software is proprietary and confidential. Unauthorized copying,
    distribution, or use is strictly prohibited and may result in legal action.

    For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IJackpot {
    struct Ticket {
        uint8[] normals;
        uint8 bonusball;
    }

    function buyTickets(
        Ticket[] calldata _tickets,
        address _recipient,
        address[] calldata _referrers,
        uint256[] calldata _referralSplitBps,
        bytes32 _source
    ) external returns (uint256[] memory ticketIds);
}
 
contract LordsPotBaseVault is OwnableUpgradeable, UUPSUpgradeable, IERC721Receiver {

    // --- Custom Errors ---
    error OnlyRelayerAllowed(address providedCaller);
    error OnlyReferrerAllowed(address providedCaller);
    error OldAddressProvided();
    error InvalidAddress();
    error OrderAlreadyProcessed();

    // --- State Storage ---
    mapping(string => bool) internal isOrderFulfilled;

    struct VaultInfo {
        address relayer;
        IJackpot megapotAddress;
        address usdcAddress;
        address referrerAddress;
    }

    VaultInfo internal vaultInfo;
    
    // --- Modifiers ---
    modifier onlyRelayer() {
        _checkRelayer();
        _;
    }

    modifier onlyReferrer() {
        _checkReferrer();
        _;
    }

    function _checkRelayer() internal view {
        if (msg.sender != vaultInfo.relayer) {
            revert OnlyRelayerAllowed(msg.sender);
        }
    }

    function _checkReferrer() internal view {
        if (msg.sender != vaultInfo.referrerAddress) {
            revert OnlyReferrerAllowed(msg.sender);
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // --- Initialization ---
    function initialize(
        address _initialOwner, 
        address _relayer, 
        address _megapotAddress, 
        address _usdcAddress, 
        address _referrerAddress
    ) public initializer {
        
        // Zero-address sanity checks for initial deployment
        if (_relayer == address(0) || _megapotAddress == address(0) || _usdcAddress == address(0)) {
            revert InvalidAddress();
        }

        __Ownable_init(_initialOwner);

        vaultInfo.relayer = _relayer;
        vaultInfo.megapotAddress = IJackpot(_megapotAddress);
        vaultInfo.usdcAddress = _usdcAddress;
        vaultInfo.referrerAddress = _referrerAddress;

        IERC20(_usdcAddress).approve(_megapotAddress, type(uint256).max);
    }

    // --- Core Execution ---
    function buyTickets(
        string calldata _orderId,
        IJackpot.Ticket[] calldata _tickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplitBps,
        bytes32 _source
    ) external onlyRelayer {
        
        if (isOrderFulfilled[_orderId]) revert OrderAlreadyProcessed();
        
        isOrderFulfilled[_orderId] = true;
        
        vaultInfo.megapotAddress.buyTickets(
            _tickets, 
            address(this), 
            _referrers, 
            _referralSplitBps, 
            _source
        );
    }

    // --- Treasury Management ---
    function withdrawUsdc(address _to, uint256 _amount) external onlyOwner {
        if (_to == address(0)) revert InvalidAddress();
        IERC20(vaultInfo.usdcAddress).transfer(_to, _amount);
    }

    // --- Getters ---
    function getVaultRelayer() external view returns (address) {
        return vaultInfo.relayer;
    }
 
    function getVaultMegapotAddress() external view returns (IJackpot) {
        return vaultInfo.megapotAddress;
    }

    function getVaultUsdcAddress() external view returns (address) {
        return vaultInfo.usdcAddress;
    }

    function getVaultReferrerAddress() external view returns (address) {
        return vaultInfo.referrerAddress;
    }

    // --- Configuration Admin Operations ---
    function setVaultRelayer(address _newRelayer) external onlyOwner {
        if (_newRelayer == address(0)) revert InvalidAddress();
        if (_newRelayer == vaultInfo.relayer) revert OldAddressProvided();
        
        vaultInfo.relayer = _newRelayer;
    }

    function setVaultMegapotAddress(address _newMegapotAddress) external onlyOwner {
        if (_newMegapotAddress == address(0)) revert InvalidAddress();
        if (_newMegapotAddress == address(vaultInfo.megapotAddress)) revert OldAddressProvided();
        
        IERC20(vaultInfo.usdcAddress).approve(address(vaultInfo.megapotAddress), 0);
        IERC20(vaultInfo.usdcAddress).approve(_newMegapotAddress, type(uint256).max);
        
        vaultInfo.megapotAddress = IJackpot(_newMegapotAddress);
    }

    function setVaultUsdcAddress(address _newUsdcAddress) external onlyOwner {
        if (_newUsdcAddress == address(0)) revert InvalidAddress();
        if (_newUsdcAddress == vaultInfo.usdcAddress) revert OldAddressProvided();
        
        IERC20(vaultInfo.usdcAddress).approve(address(vaultInfo.megapotAddress), 0);
        IERC20(_newUsdcAddress).approve(address(vaultInfo.megapotAddress), type(uint256).max);
        
        vaultInfo.usdcAddress = _newUsdcAddress;
    }

    function setVaultReferrerAddress(address _referrerAddress) external onlyReferrer {
        if (_referrerAddress == address(0)) revert InvalidAddress();
        if (_referrerAddress == vaultInfo.referrerAddress) revert OldAddressProvided();
        
        vaultInfo.referrerAddress = _referrerAddress;
    }

    // --- Infrastructure Handlers ---
    
    // UUPS Upgrade Authorization Door Guard
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Required handshake to receive ERC721 Tokens safely
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

// @openzeppelin/contracts/=base_smart_contracts/lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/
// @openzeppelin/contracts-upgradeable/=base_smart_contracts/lib/openzeppelin-contracts-upgradeable/contracts/
// forge-std/=base_smart_contracts/lib/forge-std/src/