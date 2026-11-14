// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RigReserveVault
 * @notice Non-custodial reserve vault backing The Rig ($RIG) with immutable zero-override accounting.
 * @dev Contains zero human withdrawal or admin drain functions; reserves remain publicly auditable on-chain.
 */
contract RigReserveVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();

    address public immutable CONTROLLER;
    address public immutable RIG_TOKEN;

    uint256 public totalNativeSwept;
    mapping(address asset => uint256 cumulativeAmount) public totalSwept;

    event VaultSwept(
        address indexed asset,
        address indexed caller,
        uint256 amount,
        bytes32 indexed invoiceId
    );

    event NativeVaultSwept(
        address indexed caller,
        uint256 amount,
        bytes32 indexed invoiceId
    );

    constructor(address controller_, address rigToken_) {
        if (controller_ == address(0) || rigToken_ == address(0)) revert ZeroAddress();
        CONTROLLER = controller_;
        RIG_TOKEN = rigToken_;
    }

    receive() external payable {
        if (msg.value == 0) revert ZeroAmount();
        totalNativeSwept += msg.value;
        emit NativeVaultSwept(msg.sender, msg.value, bytes32(0));
    }

    /**
     * @notice Sweeps ERC-20 reserve assets (e.g., USDC, WETH, or $RGG) into the vault.
     */
    function sweepAsset(address asset, uint256 amount, bytes32 invoiceId) external nonReentrant {
        if (asset == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        totalSwept[asset] += amount;

        emit VaultSwept(asset, msg.sender, amount, invoiceId);
    }

    /**
     * @notice Sweeps native ETH into the vault with an invoice reference for telemetry indexing.
     */
    function sweepNative(bytes32 invoiceId) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        totalNativeSwept += msg.value;
        emit NativeVaultSwept(msg.sender, msg.value, invoiceId);
    }

    /**
     * @notice Returns current reserve balance for an ERC-20 (`asset != address(0)`) or native ETH (`asset == address(0)`).
     */
    function reserveBalance(address asset) external view returns (uint256) {
        if (asset == address(0)) {
            return address(this).balance;
        }
        return IERC20(asset).balanceOf(address(this));
    }
}
