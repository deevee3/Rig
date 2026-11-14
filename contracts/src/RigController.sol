// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {RigIndexToken} from "./RigIndexToken.sol";
import {RigGasToken} from "./RigGasToken.sol";
import {RigReserveVault} from "./RigReserveVault.sol";
import {RigX402Router} from "./RigX402Router.sol";

/**
 * @title RigController
 * @notice Canonical Twin-Genesis registry & deployer binding $RIG, $RGG, RigReserveVault, and RigX402Router.
 * @dev Single-shot initialization seals the topology permanently with 0.00% human override (HUMAN_OVERRIDE_BPS == 0).
 */
contract RigController {
    error AlreadyInitialized();
    error UnauthorizedInitializer();
    error ZeroAddress();

    uint16 public constant HUMAN_OVERRIDE_BPS = 0;

    address public immutable INITIALIZER;

    bool public genesisSealed;
    address public rigToken;
    address public rggToken;
    address public vault;
    address public router;
    uint256 public genesisBlock;
    uint256 public genesisTimestamp;

    constructor() {
        INITIALIZER = msg.sender;
    }

    event TwinGenesisInitialized(
        address indexed controller,
        address indexed rigToken,
        address indexed rggToken,
        address vault,
        address router,
        bool deployedNewTokens,
        uint256 blockNumber,
        uint256 timestamp
    );

    struct GenesisParams {
        uint256 rigTotalSupply;
        uint256 rggTotalSupply;
        address rigRecipient;
        address rggRecipient;
        address recycleTreasury;
        uint16 burnBps;
        uint16 recycleBps;
        uint16 vaultBps;
    }

    /**
     * @notice Deploys $RIG, $RGG, RigReserveVault, and RigX402Router atomically in one genesis call and seals.
     */
    function deployTwinGenesis(GenesisParams calldata params)
        external
        returns (address rig_, address rgg_, address vault_, address router_)
    {
        if (msg.sender != INITIALIZER) revert UnauthorizedInitializer();
        if (genesisSealed) revert AlreadyInitialized();

        RigIndexToken rigContract = new RigIndexToken(
            "The Rig Hardware Index",
            "RIG",
            params.rigTotalSupply,
            params.rigRecipient
        );
        RigGasToken rggContract = new RigGasToken(
            "The Rig Execution Gas",
            "RGG",
            params.rggTotalSupply,
            params.rggRecipient
        );

        RigReserveVault vaultContract = new RigReserveVault(address(this), address(rigContract));
        RigX402Router routerContract = new RigX402Router(
            address(rggContract),
            payable(address(vaultContract)),
            params.recycleTreasury,
            params.burnBps,
            params.recycleBps,
            params.vaultBps
        );

        _seal(
            address(rigContract),
            address(rggContract),
            address(vaultContract),
            address(routerContract),
            true
        );

        return (address(rigContract), address(rggContract), address(vaultContract), address(routerContract));
    }

    /**
     * @notice Binds pre-deployed $RIG and $RGG ERC-20 contracts to a fresh canonical Vault + x402 Router and seals.
     */
    function bindExistingTwinGenesis(
        address existingRigToken,
        address existingRggToken,
        address recycleTreasury,
        uint16 burnBps,
        uint16 recycleBps,
        uint16 vaultBps
    ) external returns (address vault_, address router_) {
        if (msg.sender != INITIALIZER) revert UnauthorizedInitializer();
        if (genesisSealed) revert AlreadyInitialized();
        if (existingRigToken == address(0) || existingRggToken == address(0)) revert ZeroAddress();

        RigReserveVault vaultContract = new RigReserveVault(address(this), existingRigToken);
        RigX402Router routerContract = new RigX402Router(
            existingRggToken,
            payable(address(vaultContract)),
            recycleTreasury,
            burnBps,
            recycleBps,
            vaultBps
        );

        _seal(existingRigToken, existingRggToken, address(vaultContract), address(routerContract), false);
        return (address(vaultContract), address(routerContract));
    }

    /**
     * @notice Returns complete canonical genesis metadata for frontend/indexer verification.
     */
    function controllerState()
        external
        view
        returns (
            bool isSealed,
            uint16 humanOverrideBps,
            address rig,
            address rgg,
            address reserveVault,
            address x402Router,
            uint256 blockNum,
            uint256 timestamp
        )
    {
        return (
            genesisSealed,
            HUMAN_OVERRIDE_BPS,
            rigToken,
            rggToken,
            vault,
            router,
            genesisBlock,
            genesisTimestamp
        );
    }

    function _seal(
        address rig_,
        address rgg_,
        address vault_,
        address router_,
        bool deployedNewTokens_
    ) internal {
        genesisSealed = true;
        rigToken = rig_;
        rggToken = rgg_;
        vault = vault_;
        router = router_;
        genesisBlock = block.number;
        genesisTimestamp = block.timestamp;

        emit TwinGenesisInitialized(
            address(this),
            rig_,
            rgg_,
            vault_,
            router_,
            deployedNewTokens_,
            block.number,
            block.timestamp
        );
    }
}
