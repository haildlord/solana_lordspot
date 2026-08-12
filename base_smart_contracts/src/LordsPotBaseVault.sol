// SPDX-License-Identifier: MIT

/*
    Copyright (C) 2025 Coordination Inc.
    All rights reserved.

    This software is proprietary and confidential. Unauthorized copying,
    distribution, or use is strictly prohibited and may result in legal action.

    For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.20;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

    // -> uncomment it in production
    // function claimWinnings(uint256[] calldata _userTicketIds) external;
    function claimWinnings(uint256[] memory _userTicketIds, uint256[] memory _packedTickets, uint256 _winningPackedTicket, uint256 _winningBallMax, uint256 _winningAmount) external;
}
 
contract LordsPotBaseVault is Pausable, Ownable, IERC721Receiver {
    
    using SafeERC20 for IERC20;

    // --- Custom Errors ---
    error OnlyRelayerAllowed(address providedCaller);
    error OnlyReferrerAllowed(address providedCaller);
    error OldAddressProvided();
    error InvalidAddress();
    error OrderAlreadyProcessed();
    error NoTicketsToClaim();

    // --- State Storage ---
    mapping(bytes32 => bool) internal isOrderFulfilled;

    struct VaultInfo {
        address relayer;
        IJackpot megapotAddress;
        address usdcAddress;
        address referrerAddress;
    }

    VaultInfo internal vaultInfo;

    // --- Production Events ---
    event TicketsRouted(bytes32 indexed orderId, uint256 ticketCount, bytes32 indexed source, uint256[] ticketIds);
    event WinningsHarvested(uint256 ticketCount, uint256 amountHarvested);
    event UsdcWithdrawn(address indexed to, uint256 amount);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event MegapotAddressUpdated(address indexed oldMegapot, address indexed newMegapot);
    event UsdcAddressUpdated(address indexed oldUsdc, address indexed newUsdc);
    event ReferrerAddressUpdated(address indexed oldReferrer, address indexed newReferrer);
    
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
        address caller = _msgSender();
        if (caller != vaultInfo.relayer) {
            revert OnlyRelayerAllowed(caller);
        }
    }

    function _checkReferrer() internal view {
        address caller = _msgSender();
        if (caller != vaultInfo.referrerAddress) {
            revert OnlyReferrerAllowed(caller);
        }
    }

    constructor(
        address _initialOwner, 
        address _relayer, 
        address _megapotAddress, 
        address _usdcAddress, 
        address _referrerAddress
    ) Ownable(_initialOwner) {

        if (_initialOwner == address(0) || _relayer == address(0) || _megapotAddress == address(0) || _usdcAddress == address(0) || _referrerAddress == address(0)) {
            revert InvalidAddress();
        }

        vaultInfo.relayer = _relayer;
        vaultInfo.megapotAddress = IJackpot(_megapotAddress);
        vaultInfo.usdcAddress = _usdcAddress;
        vaultInfo.referrerAddress = _referrerAddress;

        // Safe approval for initial setup
        IERC20(_usdcAddress).forceApprove(_megapotAddress, type(uint256).max);
    }

    // --- Core Execution ---
    function buyTickets(
        bytes32 _orderId,
        IJackpot.Ticket[] calldata _tickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplitBps,
        bytes32 _source
    ) external whenNotPaused onlyRelayer {
        
        if (isOrderFulfilled[_orderId]) revert OrderAlreadyProcessed();         // 1. CHECK

        isOrderFulfilled[_orderId] = true;                                      // 2. EFFECT
        
        uint256[] memory _ticketIds = vaultInfo.megapotAddress.buyTickets(      // 3. INTERACTION
            _tickets, 
            address(this), 
            _referrers, 
            _referralSplitBps, 
            _source
        );

        emit TicketsRouted(_orderId, _tickets.length, _source, _ticketIds);
    }

    /**
     * @notice Harvests winnings for vault-owned Megapot ticket NFTs into this vault.
     * @dev Megapot pays `msg.sender` (this vault) and burns the NFTs, so a second
     *      call with the same ids reverts inside Megapot (NotTicketOwner) — Megapot's
     *      burn IS the idempotency guard; the vault needs no mapping of its own.
     *
     *      Deliberately NOT `whenNotPaused`: this function can only move USDC from
     *      Megapot INTO the vault — never out. During an incident you want to pause
     *      buys yet still be able to pull winnings to safety. A compromised relayer
     *      calling this gains nothing: funds land here, and only the owner can
     *      withdraw them (withdrawUsdc).
     *
     *      No reentrancy guard needed: no vault state is written, Megapot's
     *      claimWinnings is nonReentrant on its side, and USDC has no transfer hooks.
     *
     *      CALLER NOTE (backend): one invalid id (already burned / wrong drawing /
     *      not vault-owned) reverts the ENTIRE batch inside Megapot's loop —
     *      pre-validate every id with free view calls (ownerOf, getTicketInfo)
     *      and chunk batches to keep the blast radius small.
     * @param _ticketIds Megapot ticket NFT ids (NOT LordsPot order ids) to claim.
     */
    // -> this is gonna be in production :
    // function claimWinnings(uint256[] calldata _ticketIds) external onlyRelayer {
    function claimWinnings(uint256[] calldata _ticketIds, uint256[] calldata _packedTickets, uint256 _winningPackedTicket, uint256 _winningBallMax, uint256 _winningAmount) external onlyRelayer {
        if (_ticketIds.length == 0) revert NoTicketsToClaim();

        IERC20 usdc = IERC20(vaultInfo.usdcAddress);
        uint256 balanceBefore = usdc.balanceOf(address(this));      // 1. CHECK (snapshot)
        // -> uncomment this in production
        // vaultInfo.megapotAddress.claimWinnings(_ticketIds);      // 2. INTERACTION (trusted, nonReentrant)
        vaultInfo.megapotAddress.claimWinnings(_ticketIds, _packedTickets, _winningPackedTicket, _winningBallMax, _winningAmount);

        uint256 harvested = usdc.balanceOf(address(this)) - balanceBefore;
        emit WinningsHarvested(_ticketIds.length, harvested);
        // Per-ticket net amounts are NOT recomputed here — the backend reads them
        // from Megapot's own TicketWinningsClaimed events in this same receipt.
    }

    // --- Treasury Management ---
    function withdrawUsdc(address _to, uint256 _amount) external onlyOwner {
        if (_to == address(0)) revert InvalidAddress();
        IERC20(vaultInfo.usdcAddress).safeTransfer(_to, _amount);
        emit UsdcWithdrawn(_to, _amount);
    }

    function pause() public onlyOwner whenNotPaused {
        _pause();    
    }

    function unPause() public onlyOwner whenPaused {
        _unpause();    
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
        
        address oldRelayer = vaultInfo.relayer;
        vaultInfo.relayer = _newRelayer;
        
        emit RelayerUpdated(oldRelayer, _newRelayer);
    }

    function setVaultMegapotAddress(address _newMegapotAddress) external onlyOwner {
        if (_newMegapotAddress == address(0)) revert InvalidAddress();
        if (_newMegapotAddress == address(vaultInfo.megapotAddress)) revert OldAddressProvided();
        
        address oldMegapot = address(vaultInfo.megapotAddress);
        
        // Revoke old allowance, grant new allowance securely
        IERC20(vaultInfo.usdcAddress).forceApprove(oldMegapot, 0);
        IERC20(vaultInfo.usdcAddress).forceApprove(_newMegapotAddress, type(uint256).max);
        
        vaultInfo.megapotAddress = IJackpot(_newMegapotAddress);
        
        emit MegapotAddressUpdated(oldMegapot, _newMegapotAddress);
    }

    function setVaultUsdcAddress(address _newUsdcAddress) external onlyOwner {
        if (_newUsdcAddress == address(0)) revert InvalidAddress();
        if (_newUsdcAddress == vaultInfo.usdcAddress) revert OldAddressProvided();
        
        address oldUsdc = vaultInfo.usdcAddress;
        address currentMegapot = address(vaultInfo.megapotAddress);
        
        // Revoke allowance on old token, grant allowance on new token securely
        IERC20(oldUsdc).forceApprove(currentMegapot, 0);
        IERC20(_newUsdcAddress).forceApprove(currentMegapot, type(uint256).max);
        
        vaultInfo.usdcAddress = _newUsdcAddress;
        
        emit UsdcAddressUpdated(oldUsdc, _newUsdcAddress);
    }

    function setVaultReferrerAddress(address _referrerAddress) external onlyReferrer {
        if (_referrerAddress == address(0)) revert InvalidAddress();
        if (_referrerAddress == vaultInfo.referrerAddress) revert OldAddressProvided();
        
        address oldReferrer = vaultInfo.referrerAddress;
        vaultInfo.referrerAddress = _referrerAddress;
        
        emit ReferrerAddressUpdated(oldReferrer, _referrerAddress);
    }

    // Required handshake to receive ERC721 Tokens safely
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}