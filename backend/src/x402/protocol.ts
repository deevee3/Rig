import {
  getAddress,
  isAddress,
  isHex,
  parseSignature,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import type { RigBackendConfig } from '../config.js';

export type X402SettlementMethod =
  | 'permit'
  | 'receiveWithAuthorization'
  | 'transferWithAuthorization'
  | 'txProof';

export interface X402PaymentAccept {
  scheme: 'exact';
  network: string;
  asset: Address;
  amount: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: {
    symbol: string;
    settlementMethod: X402SettlementMethod;
    tokenName?: string;
    tokenVersion?: string;
  };
}

export interface X402PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: X402PaymentAccept[];
}

export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface Eip2612PermitAuthorization {
  owner: Address;
  spender: Address;
  value: string;
  nonce: string;
  deadline: string;
}

export interface X402PaymentPayload {
  x402Version: 2;
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    extra?: {
      settlementMethod?: X402SettlementMethod;
    };
  };
  payload: {
    authorization?: Eip3009Authorization;
    permit?: Eip2612PermitAuthorization;
    signature?: Hex;
    txHash?: Hex;
    invoiceId?: Hex;
    agentId?: string;
  };
}

export interface X402SettlementResponse {
  success: boolean;
  network: string;
  transaction: Hex;
  payer: Address;
  asset: Address;
  grossAmount: string;
  burnedAmount?: string;
  recycledAmount?: string;
  vaultedAmount?: string;
  invoiceId: Hex;
  agentId: string;
  errorReason?: string;
}

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export const EIP2612_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function encodeX402Header(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodeX402Header<T>(headerValue: string): T {
  const decoded = Buffer.from(headerValue.trim(), 'base64').toString('utf8');
  return JSON.parse(decoded) as T;
}

export function buildPaymentRequired(
  config: RigBackendConfig,
  resourceUrl: string,
  error?: string,
  rggSettlementMethod: X402SettlementMethod = 'permit'
): X402PaymentRequired {
  const accepts: X402PaymentAccept[] = [];
  const payTo = config.routerAddress ?? config.vaultAddress;

  if (config.rggTokenAddress && payTo) {
    accepts.push({
      scheme: 'exact',
      network: config.caip2Network,
      asset: config.rggTokenAddress,
      amount: config.x402RggPriceAtomic.toString(),
      payTo,
      maxTimeoutSeconds: 300,
      extra: {
        symbol: 'RGG',
        settlementMethod: rggSettlementMethod,
        tokenName: config.rggTokenName,
        tokenVersion: config.rggTokenVersion,
      },
    });
  }

  if (config.usdcTokenAddress && payTo) {
    accepts.push({
      scheme: 'exact',
      network: config.caip2Network,
      asset: config.usdcTokenAddress,
      amount: config.x402UsdcPriceAtomic.toString(),
      payTo,
      maxTimeoutSeconds: 300,
      extra: {
        symbol: 'USDC',
        settlementMethod: 'transferWithAuthorization',
        tokenName: config.usdcTokenName,
        tokenVersion: config.usdcTokenVersion,
      },
    });
  }

  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: resourceUrl,
      description: 'The Rig autonomous cluster compute execution',
      mimeType: 'application/json',
    },
    accepts,
  };
}

export function splitHexSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity + 27;
  return { v, r: parsed.r, s: parsed.s };
}

export interface AuthorizationCheckResult {
  valid: boolean;
  reason?: string;
  primaryType?: 'ReceiveWithAuthorization' | 'TransferWithAuthorization';
  from?: Address;
  to?: Address;
  value?: bigint;
  validAfter?: bigint;
  validBefore?: bigint;
  nonce?: Hex;
}

export async function verifyEip3009Authorization(params: {
  chainId: number;
  verifyingContract: Address;
  tokenName: string;
  tokenVersion: string;
  expectedPayTo: Address;
  minimumAmount: bigint;
  primaryType: 'ReceiveWithAuthorization' | 'TransferWithAuthorization';
  authorization: Eip3009Authorization;
  signature: Hex;
  nowSeconds?: bigint;
}): Promise<AuthorizationCheckResult> {
  const { authorization, signature } = params;
  if (!isAddress(authorization.from) || !isAddress(authorization.to)) {
    return { valid: false, reason: 'Invalid from/to address in authorization' };
  }
  if (!isHex(authorization.nonce) || authorization.nonce.length !== 66) {
    return { valid: false, reason: 'Invalid bytes32 nonce' };
  }
  if (!isHex(signature) || signature.length !== 132) {
    return { valid: false, reason: 'Invalid 65-byte EIP-712 signature' };
  }

  const from = getAddress(authorization.from);
  const to = getAddress(authorization.to);
  if (to !== getAddress(params.expectedPayTo)) {
    return { valid: false, reason: `Authorization recipient ${to} != expected payTo ${params.expectedPayTo}` };
  }

  let value: bigint;
  let validAfter: bigint;
  let validBefore: bigint;
  try {
    value = BigInt(authorization.value);
    validAfter = BigInt(authorization.validAfter);
    validBefore = BigInt(authorization.validBefore);
  } catch {
    return { valid: false, reason: 'Non-numeric authorization amount or window' };
  }

  if (value < params.minimumAmount) {
    return { valid: false, reason: `Insufficient payment value ${value} < ${params.minimumAmount}` };
  }

  const now = params.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (now <= validAfter || now >= validBefore) {
    return { valid: false, reason: 'Authorization outside validAfter/validBefore window' };
  }

  const ok = await verifyTypedData({
    address: from,
    domain: {
      name: params.tokenName,
      version: params.tokenVersion,
      chainId: params.chainId,
      verifyingContract: getAddress(params.verifyingContract),
    },
    types: {
      [params.primaryType]: EIP3009_TYPES[params.primaryType],
    },
    primaryType: params.primaryType,
    message: {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce: authorization.nonce,
    },
    signature,
  });

  if (!ok) {
    return { valid: false, reason: 'Invalid EIP-3009 typed-data signature' };
  }

  return {
    valid: true,
    primaryType: params.primaryType,
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce: authorization.nonce,
  };
}

export interface PermitCheckResult {
  valid: boolean;
  reason?: string;
  owner?: Address;
  spender?: Address;
  value?: bigint;
  nonce?: bigint;
  deadline?: bigint;
}

export async function verifyEip2612Permit(params: {
  chainId: number;
  verifyingContract: Address;
  tokenName: string;
  tokenVersion: string;
  expectedSpender: Address;
  minimumAmount: bigint;
  permit: Eip2612PermitAuthorization;
  signature: Hex;
  nowSeconds?: bigint;
}): Promise<PermitCheckResult> {
  const { permit, signature } = params;
  if (!isAddress(permit.owner) || !isAddress(permit.spender)) {
    return { valid: false, reason: 'Invalid owner/spender address in EIP-2612 permit' };
  }
  if (!isHex(signature) || signature.length !== 132) {
    return { valid: false, reason: 'Invalid 65-byte EIP-712 signature' };
  }

  const owner = getAddress(permit.owner);
  const spender = getAddress(permit.spender);
  if (spender !== getAddress(params.expectedSpender)) {
    return { valid: false, reason: `Permit spender ${spender} != expected router ${params.expectedSpender}` };
  }

  let value: bigint;
  let nonce: bigint;
  let deadline: bigint;
  try {
    value = BigInt(permit.value);
    nonce = BigInt(permit.nonce);
    deadline = BigInt(permit.deadline);
  } catch {
    return { valid: false, reason: 'Non-numeric permit value, nonce, or deadline' };
  }

  if (value < params.minimumAmount) {
    return { valid: false, reason: `Insufficient permit value ${value} < ${params.minimumAmount}` };
  }

  const now = params.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000));
  if (now > deadline) {
    return { valid: false, reason: 'EIP-2612 permit deadline expired' };
  }

  const ok = await verifyTypedData({
    address: owner,
    domain: {
      name: params.tokenName,
      version: params.tokenVersion,
      chainId: params.chainId,
      verifyingContract: getAddress(params.verifyingContract),
    },
    types: EIP2612_TYPES,
    primaryType: 'Permit',
    message: {
      owner,
      spender,
      value,
      nonce,
      deadline,
    },
    signature,
  });

  if (!ok) {
    return { valid: false, reason: 'Invalid EIP-2612 permit signature' };
  }

  return { valid: true, owner, spender, value, nonce, deadline };
}
