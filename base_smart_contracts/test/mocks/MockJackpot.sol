// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IJackpot} from "../../src/LordsPotBaseVault.sol";

/// TEST-ONLY stand-in for Megapot's real Jackpot contract, for local Anvil-fork
/// testing against a fast-forwarding mock epoch API. The real Megapot contract
/// tracks its own on-chain "current drawing" and rejects any ticket whose
/// drawing hasn't actually happened yet on real mainnet — which a fast mock
/// API can outrun in minutes. This mock has no such notion of time: every
/// claim always succeeds, paying a flat test amount per ticket.
///
/// Never point the vault at this on anything but a local fork. Wire it up via
/// script/DeployMockJackpot.s.sol, and point the vault back at the real
/// Megapot address (setVaultMegapotAddress) when done testing.
contract MockJackpot is IJackpot {
    IERC20 public immutable usdc;
    uint256 public nextTicketId = 1;
    uint256 public payoutPerTicket; // 6-decimal USDC units

    constructor(address _usdc, uint256 _payoutPerTicket) {
        usdc = IERC20(_usdc);
        payoutPerTicket = _payoutPerTicket;
    }

    function buyTickets(
        Ticket[] calldata _tickets,
        address /* _recipient */,
        address[] calldata /* _referrers */,
        uint256[] calldata /* _referralSplitBps */,
        bytes32 /* _source */
    ) external override returns (uint256[] memory ticketIds) {
        ticketIds = new uint256[](_tickets.length);
        for (uint256 i = 0; i < _tickets.length; i++) {
            ticketIds[i] = nextTicketId++;
        }
    }

    /// Always succeeds — no drawing-timing check at all, unlike the real contract.
function claimWinnings(
    uint256[] calldata _userTicketIds,
    uint256[] calldata /* _packedTickets */,
    uint256 /* _winningPackedTicket */,
    uint256 /* _winningBallMax */,
    uint256 /* _winningAmount */
) external override {
    uint256 amount = payoutPerTicket * _userTicketIds.length;
    require(usdc.transfer(msg.sender, amount), "MockJackpot: payout transfer failed");
}
}
