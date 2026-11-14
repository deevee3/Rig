// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC3009} from "@openzeppelin/contracts/interfaces/draft-IERC3009.sol";
import {RigReserveVault} from "./RigReserveVault.sol";

interface IBurnable {
    function burn(uint256 value) external;
}

/**
 * @title RigX402Router
 * @notice Atomic HTTP 402 (x402 v2) settlement router for $RGG execution gas and $RIG reserve sweeps.
 * @dev Immutable split parameters set at genesis; supports EIP-3009, EIP-2612 Permit, direct ERC-20
 *      settlement from msg.sender, and USDC/WETH spread sweeps to RigReserveVault.
 */
contract RigX402Router is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidSplitBps();
    error InvoiceAlreadySettled(bytes32 invoiceId);
    error InvalidSignatureLength();

    uint16 public constant BPS_DENOMINATOR = 10_000;
    address public constant DEAD_BURN_SINK = 0x000000000000000000000000000000000000dEaD;

    address public immutable RGG_TOKEN;
    RigReserveVault public immutable VAULT;
    address public immutable RECYCLE_TREASURY;

    uint16 public immutable BURN_BPS;
    uint16 public immutable RECYCLE_BPS;
    uint16 public immutable VAULT_BPS;

    uint256 public totalSettlements;
    uint256 public totalRggSettled;
    uint256 public totalRggBurned;
    uint256 public totalRggRecycled;
    uint256 public totalRggVaulted;

    mapping(bytes32 invoiceId => bool settled) public settledInvoices;

    event X402Settled(
        bytes32 indexed invoiceId,
        string agentId,
        address indexed payer,
        address indexed asset,
        uint256 grossAmount,
        uint256 burnedAmount,
        uint256 recycledAmount,
        uint256 vaultedAmount
    );

    event SpreadSweptToVault(
        bytes32 indexed invoiceId,
        string agentId,
        address indexed payer,
        address indexed asset,
        uint256 amount
    );

    constructor(
        address rggToken_,
        address payable vault_,
        address recycleTreasury_,
        uint16 burnBps_,
        uint16 recycleBps_,
        uint16 vaultBps_
    ) {
        if (rggToken_ == address(0) || vault_ == address(0) || recycleTreasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (uint256(burnBps_) + uint256(recycleBps_) + uint256(vaultBps_) != BPS_DENOMINATOR) {
            revert InvalidSplitBps();
        }
        RGG_TOKEN = rggToken_;
        VAULT = RigReserveVault(vault_);
        RECYCLE_TREASURY = recycleTreasury_;
        BURN_BPS = burnBps_;
        RECYCLE_BPS = recycleBps_;
        VAULT_BPS = vaultBps_;
    }

    /**
     * @notice Settles an x402 v2 $RGG invoice using EIP-3009 ReceiveWithAuthorization (front-run safe).
     */
    function settleRggWithReceiveAuth(
        bytes32 invoiceId,
        string calldata agentId,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _claimInvoice(invoiceId, amount);
        IERC3009(RGG_TOKEN).receiveWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        _distributeRgg(invoiceId, agentId, payer, amount);
    }

    /**
     * @notice Settles an x402 v2 $RGG invoice using EIP-3009 TransferWithAuthorization.
     */
    function settleRggWithTransferAuth(
        bytes32 invoiceId,
        string calldata agentId,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _claimInvoice(invoiceId, amount);
        IERC3009(RGG_TOKEN).transferWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        _distributeRgg(invoiceId, agentId, payer, amount);
    }

    /**
     * @notice Settles an x402 v2 $RGG invoice using EIP-2612 Permit + SafeERC20 transferFrom.
     */
    function settleRggWithPermit(
        bytes32 invoiceId,
        string calldata agentId,
        address payer,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _claimInvoice(invoiceId, amount);
        IERC20Permit(RGG_TOKEN).permit(payer, address(this), amount, deadline, v, r, s);
        IERC20(RGG_TOKEN).safeTransferFrom(payer, address(this), amount);
        _distributeRgg(invoiceId, agentId, payer, amount);
    }

    /**
     * @notice Direct settlement from msg.sender for pre-deployed ERC-20s lacking EIP-3009/Permit.
     */
    function settleRggDirect(bytes32 invoiceId, string calldata agentId, uint256 amount) external nonReentrant {
        _claimInvoice(invoiceId, amount);
        IERC20(RGG_TOKEN).safeTransferFrom(msg.sender, address(this), amount);
        _distributeRgg(invoiceId, agentId, msg.sender, amount);
    }

    /**
     * @notice Settles an EIP-3009 asset (e.g., Base USDC) directly into RigReserveVault as protocol spread.
     */
    function settleSpreadWithTransferAuth(
        bytes32 invoiceId,
        string calldata agentId,
        address asset,
        address payer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (asset == address(0) || payer == address(0)) revert ZeroAddress();
        _claimInvoice(invoiceId, amount);

        IERC3009(asset).transferWithAuthorization(
            payer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
        IERC20(asset).forceApprove(address(VAULT), amount);
        VAULT.sweepAsset(asset, amount, invoiceId);

        totalSettlements += 1;
        emit SpreadSweptToVault(invoiceId, agentId, payer, asset, amount);
    }

    /**
     * @notice Sweeps an ERC-20 spread (e.g., USDC or WETH) from msg.sender directly to RigReserveVault.
     */
    function sweepSpreadDirect(
        bytes32 invoiceId,
        string calldata agentId,
        address asset,
        uint256 amount
    ) external nonReentrant {
        if (asset == address(0)) revert ZeroAddress();
        _claimInvoice(invoiceId, amount);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(address(VAULT), amount);
        VAULT.sweepAsset(asset, amount, invoiceId);

        totalSettlements += 1;
        emit SpreadSweptToVault(invoiceId, agentId, msg.sender, asset, amount);
    }

    /**
     * @notice Splits an EIP-712 65-byte compact signature into (v, r, s) for off-chain clients.
     */
    function splitSignature(bytes calldata signature) external pure returns (uint8 v, bytes32 r, bytes32 s) {
        if (signature.length != 65) revert InvalidSignatureLength();
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
    }

    function _claimInvoice(bytes32 invoiceId, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (settledInvoices[invoiceId]) revert InvoiceAlreadySettled(invoiceId);
        settledInvoices[invoiceId] = true;
    }

    function _distributeRgg(bytes32 invoiceId, string calldata agentId, address payer, uint256 amount) internal {
        uint256 burnAmount = (amount * BURN_BPS) / BPS_DENOMINATOR;
        uint256 recycleAmount = (amount * RECYCLE_BPS) / BPS_DENOMINATOR;
        uint256 vaultAmount = amount - burnAmount - recycleAmount;

        if (burnAmount > 0) {
            // Attempt ERC20Burnable.burn; fall back to 0x...dEaD sink for external non-burnable tokens.
            try IBurnable(RGG_TOKEN).burn(burnAmount) {} catch {
                IERC20(RGG_TOKEN).safeTransfer(DEAD_BURN_SINK, burnAmount);
            }
        }
        if (recycleAmount > 0) {
            IERC20(RGG_TOKEN).safeTransfer(RECYCLE_TREASURY, recycleAmount);
        }
        if (vaultAmount > 0) {
            IERC20(RGG_TOKEN).forceApprove(address(VAULT), vaultAmount);
            VAULT.sweepAsset(RGG_TOKEN, vaultAmount, invoiceId);
        }

        totalSettlements += 1;
        totalRggSettled += amount;
        totalRggBurned += burnAmount;
        totalRggRecycled += recycleAmount;
        totalRggVaulted += vaultAmount;

        emit X402Settled(
            invoiceId,
            agentId,
            payer,
            RGG_TOKEN,
            amount,
            burnAmount,
            recycleAmount,
            vaultAmount
        );
    }
}
