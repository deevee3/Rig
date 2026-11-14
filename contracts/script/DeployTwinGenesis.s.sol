// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {RigController} from "../src/RigController.sol";

/**
 * @title DeployTwinGenesis
 * @notice Deterministic Base / Base Sepolia / Anvil deployment script for The Rig ($RIG + $RGG).
 * @dev Set EXISTING_RIG_TOKEN and EXISTING_RGG_TOKEN to bind pre-deployed ERC-20 tokens instead of minting new ones.
 */
contract DeployTwinGenesis is Script {
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000e18;

    function run() external {
        uint256 deployerKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerKey);

        address existingRig = vm.envOr("EXISTING_RIG_TOKEN", address(0));
        address existingRgg = vm.envOr("EXISTING_RGG_TOKEN", address(0));
        address rigRecipient = vm.envOr("RIG_RECIPIENT", deployer);
        address rggRecipient = vm.envOr("RGG_RECIPIENT", deployer);
        address recycleTreasury = vm.envOr("RECYCLE_TREASURY", deployer);

        uint16 burnBps = uint16(vm.envOr("RGG_BURN_BPS", uint256(5000)));
        uint16 recycleBps = uint16(vm.envOr("RGG_RECYCLE_BPS", uint256(3500)));
        uint16 vaultBps = uint16(vm.envOr("RGG_VAULT_BPS", uint256(1500)));

        vm.startBroadcast(deployerKey);

        RigController controller = new RigController();
        address rigAddr;
        address rggAddr;
        address vaultAddr;
        address routerAddr;

        if (existingRig != address(0) && existingRgg != address(0)) {
            (vaultAddr, routerAddr) = controller.bindExistingTwinGenesis(
                existingRig, existingRgg, recycleTreasury, burnBps, recycleBps, vaultBps
            );
            rigAddr = existingRig;
            rggAddr = existingRgg;
        } else {
            (rigAddr, rggAddr, vaultAddr, routerAddr) = controller.deployTwinGenesis(
                RigController.GenesisParams({
                    rigTotalSupply: DEFAULT_SUPPLY,
                    rggTotalSupply: DEFAULT_SUPPLY,
                    rigRecipient: rigRecipient,
                    rggRecipient: rggRecipient,
                    recycleTreasury: recycleTreasury,
                    burnBps: burnBps,
                    recycleBps: recycleBps,
                    vaultBps: vaultBps
                })
            );
        }

        vm.stopBroadcast();

        console2.log("RIG_CONTROLLER=", address(controller));
        console2.log("RIG_TOKEN=", rigAddr);
        console2.log("RGG_TOKEN=", rggAddr);
        console2.log("RIG_VAULT=", vaultAddr);
        console2.log("RIG_X402_ROUTER=", routerAddr);
    }
}
