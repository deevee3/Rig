// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title RigIndexToken ($RIG)
 * @notice Capital & Reserve Layer primitive for The Rig twin-genesis architecture.
 * @dev Fixed genesis supply, 0% buy/sell transfer tax, zero post-genesis minting, zero admin controls.
 */
contract RigIndexToken is ERC20, ERC20Permit {
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
}
