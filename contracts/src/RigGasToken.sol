// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC3009} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC3009.sol";

/**
 * @title RigGasToken ($RGG)
 * @notice Throughput & Settlement Layer primitive for HTTP 402 (x402 v2) machine execution gas.
 * @dev Fixed genesis supply, 0% transfer tax, native burnable supply, EIP-2612 permit, and EIP-3009
 *      transferWithAuthorization/receiveWithAuthorization for gasless x402 v2 agent settlement.
 */
contract RigGasToken is ERC20, ERC20Burnable, ERC20Permit, ERC3009 {
    error ZeroRecipient();
    error ZeroSupply();

    uint256 public immutable GENESIS_SUPPLY;
    address public immutable CONTROLLER;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address initialRecipient_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (initialRecipient_ == address(0)) revert ZeroRecipient();
        if (totalSupply_ == 0) revert ZeroSupply();
        GENESIS_SUPPLY = totalSupply_;
        CONTROLLER = msg.sender;
        _mint(initialRecipient_, totalSupply_);
    }

    /**
     * @notice Total $RGG permanently burned since Block 0.
     */
    function totalBurned() external view returns (uint256) {
        return GENESIS_SUPPLY - totalSupply();
    }
}
