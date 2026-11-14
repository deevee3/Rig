import { parseAbi } from 'viem';

export const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export const RIG_GAS_TOKEN_ABI = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

export const RIG_CONTROLLER_ABI = parseAbi([
  'function controllerState() view returns (bool isSealed, uint16 humanOverrideBps, address rig, address rgg, address reserveVault, address x402Router, uint256 blockNum, uint256 timestamp)',
  'function genesisSealed() view returns (bool)',
  'function HUMAN_OVERRIDE_BPS() view returns (uint16)',
]);

export const RIG_VAULT_ABI = parseAbi([
  'function reserveBalance(address asset) view returns (uint256)',
  'function totalSwept(address asset) view returns (uint256)',
  'function totalNativeSwept() view returns (uint256)',
  'event VaultSwept(address indexed asset, address indexed caller, uint256 amount, bytes32 indexed invoiceId)',
  'event NativeVaultSwept(address indexed caller, uint256 amount, bytes32 indexed invoiceId)',
]);

export const RIG_X402_ROUTER_ABI = parseAbi([
  'function BURN_BPS() view returns (uint16)',
  'function RECYCLE_BPS() view returns (uint16)',
  'function VAULT_BPS() view returns (uint16)',
  'function totalSettlements() view returns (uint256)',
  'function totalRggSettled() view returns (uint256)',
  'function totalRggBurned() view returns (uint256)',
  'function totalRggRecycled() view returns (uint256)',
  'function totalRggVaulted() view returns (uint256)',
  'function settledInvoices(bytes32 invoiceId) view returns (bool)',
  'function settleRggWithReceiveAuth(bytes32 invoiceId, string agentId, address payer, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function settleRggWithTransferAuth(bytes32 invoiceId, string agentId, address payer, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function settleRggWithPermit(bytes32 invoiceId, string agentId, address payer, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function settleSpreadWithTransferAuth(bytes32 invoiceId, string agentId, address asset, address payer, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'event X402Settled(bytes32 indexed invoiceId, string agentId, address indexed payer, address indexed asset, uint256 grossAmount, uint256 burnedAmount, uint256 recycledAmount, uint256 vaultedAmount)',
  'event SpreadSweptToVault(bytes32 indexed invoiceId, string agentId, address indexed payer, address indexed asset, uint256 amount)',
]);
