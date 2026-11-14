// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RigController} from "../src/RigController.sol";
import {RigIndexToken} from "../src/RigIndexToken.sol";
import {RigGasToken} from "../src/RigGasToken.sol";
import {RigReserveVault} from "../src/RigReserveVault.sol";
import {RigX402Router} from "../src/RigX402Router.sol";

contract MockPlainERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_, address recipient, uint256 supply)
        ERC20(name_, symbol_)
    {
        _mint(recipient, supply);
    }
}

contract TwinGenesisTest is Test {
    bytes32 internal constant TRANSFER_WITH_AUTH_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant RECEIVE_WITH_AUTH_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint256 internal constant SUPPLY = 1_000_000_000e18;
    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal recycleTreasury = makeAddr("recycleTreasury");
    address internal externalCaller = makeAddr("externalCaller");

    RigController internal controller;
    RigIndexToken internal rig;
    RigGasToken internal rgg;
    RigReserveVault internal vault;
    RigX402Router internal router;

    function setUp() public {
        vm.warp(1_760_000_000);
        payer = vm.addr(payerKey);
        controller = new RigController();

        (address rigAddr, address rggAddr, address vaultAddr, address routerAddr) = controller.deployTwinGenesis(
            RigController.GenesisParams({
                rigTotalSupply: SUPPLY,
                rggTotalSupply: SUPPLY,
                rigRecipient: address(this),
                rggRecipient: payer,
                recycleTreasury: recycleTreasury,
                burnBps: 5000,
                recycleBps: 3500,
                vaultBps: 1500
            })
        );

        rig = RigIndexToken(rigAddr);
        rgg = RigGasToken(rggAddr);
        vault = RigReserveVault(payable(vaultAddr));
        router = RigX402Router(routerAddr);
    }

    function test_GenesisStateAndZeroTaxes() public {
        (
            bool isSealed,
            uint16 humanOverrideBps,
            address rigAddr,
            address rggAddr,
            address vaultAddr,
            address routerAddr,
            ,
        ) = controller.controllerState();

        assertTrue(isSealed);
        assertEq(humanOverrideBps, 0);
        assertEq(rigAddr, address(rig));
        assertEq(rggAddr, address(rgg));
        assertEq(vaultAddr, address(vault));
        assertEq(routerAddr, address(router));

        // 0% transfer tax invariant on $RIG and $RGG
        assertTrue(rig.transfer(payer, 1_000e18));
        assertEq(rig.balanceOf(payer), 1_000e18);

        vm.prank(payer);
        assertTrue(rgg.transfer(externalCaller, 250e18));
        assertEq(rgg.balanceOf(externalCaller), 250e18);
    }

    function test_CannotReinitializeOrFrontRunController() public {
        vm.expectRevert(RigController.UnauthorizedInitializer.selector);
        vm.prank(externalCaller);
        controller.bindExistingTwinGenesis(address(rig), address(rgg), recycleTreasury, 5000, 3500, 1500);

        vm.expectRevert(RigController.AlreadyInitialized.selector);
        controller.bindExistingTwinGenesis(address(rig), address(rgg), recycleTreasury, 5000, 3500, 1500);
    }

    function test_SettleRggWithReceiveAuthorization() public {
        uint256 amount = 1_000e18;
        bytes32 invoiceId = keccak256("inv-001");
        bytes32 nonce = keccak256("nonce-001");
        uint256 validAfter = block.timestamp - 10;
        uint256 validBefore = block.timestamp + 300;

        (uint8 v, bytes32 r, bytes32 s) = _signReceiveAuth(
            address(rgg),
            payerKey,
            payer,
            address(router),
            amount,
            validAfter,
            validBefore,
            nonce
        );

        vm.prank(externalCaller);
        router.settleRggWithReceiveAuth(
            invoiceId, "AGENT-01", payer, amount, validAfter, validBefore, nonce, v, r, s
        );

        assertEq(rgg.totalBurned(), 500e18);
        assertEq(rgg.balanceOf(recycleTreasury), 350e18);
        assertEq(rgg.balanceOf(address(vault)), 150e18);
        assertEq(router.totalSettlements(), 1);
        assertEq(router.totalRggBurned(), 500e18);
        assertEq(router.totalRggRecycled(), 350e18);
        assertEq(router.totalRggVaulted(), 150e18);

        // Replay protection on invoiceId
        vm.expectRevert(abi.encodeWithSelector(RigX402Router.InvoiceAlreadySettled.selector, invoiceId));
        router.settleRggWithReceiveAuth(
            invoiceId, "AGENT-01", payer, amount, validAfter, validBefore, nonce, v, r, s
        );
    }

    function test_SettleRggWithTransferAuthorization() public {
        uint256 amount = 200e18;
        bytes32 invoiceId = keccak256("inv-002");
        bytes32 nonce = keccak256("nonce-002");
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 600;

        (uint8 v, bytes32 r, bytes32 s) = _signTransferAuth(
            address(rgg),
            payerKey,
            payer,
            address(router),
            amount,
            validAfter,
            validBefore,
            nonce
        );

        router.settleRggWithTransferAuth(
            invoiceId, "AGENT-02", payer, amount, validAfter, validBefore, nonce, v, r, s
        );

        assertEq(rgg.totalBurned(), 100e18);
        assertEq(rgg.balanceOf(recycleTreasury), 70e18);
        assertEq(rgg.balanceOf(address(vault)), 30e18);
    }

    function test_BindExistingNonBurnableTokensAndSweepSpread() public {
        MockPlainERC20 extRig = new MockPlainERC20("Ext RIG", "RIG", address(this), SUPPLY);
        MockPlainERC20 extRgg = new MockPlainERC20("Ext RGG", "RGG", payer, SUPPLY);
        MockPlainERC20 mockUsdc = new MockPlainERC20("USD Coin", "USDC", address(this), 1_000_000e6);

        RigController extController = new RigController();
        (address vaultAddr, address routerAddr) = extController.bindExistingTwinGenesis(
            address(extRig), address(extRgg), recycleTreasury, 5000, 3500, 1500
        );

        RigX402Router extRouter = RigX402Router(routerAddr);
        RigReserveVault extVault = RigReserveVault(payable(vaultAddr));

        // Direct ERC-20 settlement falls back to DEAD_BURN_SINK when token has no burn()
        vm.startPrank(payer);
        extRgg.approve(address(extRouter), 100e18);
        extRouter.settleRggDirect(keccak256("ext-inv-1"), "AGENT-03", 100e18);
        vm.stopPrank();

        assertEq(extRgg.balanceOf(extRouter.DEAD_BURN_SINK()), 50e18);
        assertEq(extRgg.balanceOf(recycleTreasury), 35e18);
        assertEq(extRgg.balanceOf(address(extVault)), 15e18);

        // Spread sweep in USDC + native ETH into RigReserveVault
        mockUsdc.approve(address(extRouter), 450e6);
        extRouter.sweepSpreadDirect(keccak256("spread-1"), "VAULT-01", address(mockUsdc), 450e6);
        assertEq(extVault.reserveBalance(address(mockUsdc)), 450e6);
        assertEq(extVault.totalSwept(address(mockUsdc)), 450e6);

        vm.deal(address(this), 1 ether);
        extVault.sweepNative{value: 0.25 ether}(keccak256("eth-spread-1"));
        assertEq(extVault.reserveBalance(address(0)), 0.25 ether);
    }

    function test_SettleRggWithPermit() public {
        uint256 amount = 400e18;
        uint256 deadline = block.timestamp + 300;
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(permitTypehash, payer, address(router), amount, rgg.nonces(payer), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", rgg.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);

        router.settleRggWithPermit(keccak256("permit-inv-1"), "AGENT-04", payer, amount, deadline, v, r, s);
        assertEq(rgg.totalBurned(), 200e18);
        assertEq(rgg.balanceOf(recycleTreasury), 140e18);
        assertEq(rgg.balanceOf(address(vault)), 60e18);
    }

    function test_RevertsOnExpiredAuthAndInvalidSplitBps() public {
        bytes32 nonce = keccak256("expired-nonce");
        uint256 validAfter = block.timestamp - 100;
        uint256 validBefore = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signReceiveAuth(
            address(rgg), payerKey, payer, address(router), 10e18, validAfter, validBefore, nonce
        );

        vm.expectRevert();
        router.settleRggWithReceiveAuth(
            keccak256("expired-inv"), "AGENT-01", payer, 10e18, validAfter, validBefore, nonce, v, r, s
        );

        RigController badController = new RigController();
        vm.expectRevert(RigX402Router.InvalidSplitBps.selector);
        badController.deployTwinGenesis(
            RigController.GenesisParams({
                rigTotalSupply: SUPPLY,
                rggTotalSupply: SUPPLY,
                rigRecipient: address(this),
                rggRecipient: payer,
                recycleTreasury: recycleTreasury,
                burnBps: 5000,
                recycleBps: 4000,
                vaultBps: 2000
            })
        );
    }

    function _signTransferAuth(
        address tokenAddr,
        uint256 signerKey,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTH_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", RigGasToken(tokenAddr).DOMAIN_SEPARATOR(), structHash)
        );
        return vm.sign(signerKey, digest);
    }

    function _signReceiveAuth(
        address tokenAddr,
        uint256 signerKey,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_WITH_AUTH_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", RigGasToken(tokenAddr).DOMAIN_SEPARATOR(), structHash)
        );
        return vm.sign(signerKey, digest);
    }
}
