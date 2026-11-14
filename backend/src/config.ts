import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

export interface RigBackendConfig {
  port: number;
  host: string;
  corsOrigin: string;
  chainId: number;
  caip2Network: string;
  networkLabel: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  controllerAddress: Address | null;
  rigTokenAddress: Address | null;
  rggTokenAddress: Address | null;
  vaultAddress: Address | null;
  routerAddress: Address | null;
  usdcTokenAddress: Address | null;
  settlementPrivateKey: Hex | null;
  x402RggPriceAtomic: bigint;
  x402UsdcPriceAtomic: bigint;
  rggTokenName: string;
  rggTokenVersion: string;
  usdcTokenName: string;
  usdcTokenVersion: string;
  pollIntervalMs: number;
  lookbackBlocks: number;
  maxTelemetryEvents: number;
}

const DEFAULT_BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function optionalAddress(raw: string | undefined): Address | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

function optionalPrivateKey(raw: string | undefined): Hex | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!isHex(prefixed) || prefixed.length !== 66) return null;
  return prefixed;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNonNegativeBigInt(raw: string | undefined, fallback: bigint): bigint {
  if (!raw || !raw.trim()) return fallback;
  try {
    const v = BigInt(raw.trim());
    return v >= 0n ? v : fallback;
  } catch {
    return fallback;
  }
}

export function networkLabelForChain(chainId: number): string {
  switch (chainId) {
    case 8453:
      return 'BASE MAINNET';
    case 84532:
      return 'BASE SEPOLIA';
    case 31337:
      return 'LOCAL ANVIL';
    default:
      return `EVM-${chainId}`;
  }
}

export function loadConfig(overrides: Partial<RigBackendConfig> = {}): RigBackendConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  const envFromFile = parseEnvFile(resolve(here, '../.env'));
  const env = { ...envFromFile, ...process.env };

  const chainId = overrides.chainId ?? parsePositiveInt(env.CHAIN_ID, 8453);
  const defaultExplorer =
    chainId === 84532
      ? 'https://sepolia.basescan.org'
      : chainId === 31337
        ? ''
        : 'https://basescan.org';

  return {
    port: overrides.port ?? parsePositiveInt(env.PORT, 8787),
    host: overrides.host ?? (env.HOST?.trim() || '127.0.0.1'),
    corsOrigin: overrides.corsOrigin ?? (env.CORS_ORIGIN?.trim() || '*'),
    chainId,
    caip2Network: `eip155:${chainId}`,
    networkLabel: overrides.networkLabel ?? networkLabelForChain(chainId),
    rpcUrl: overrides.rpcUrl ?? (env.BASE_RPC_URL?.trim() || 'https://mainnet.base.org'),
    explorerBaseUrl: overrides.explorerBaseUrl ?? (env.EXPLORER_BASE_URL?.trim() ?? defaultExplorer),
    controllerAddress:
      overrides.controllerAddress !== undefined
        ? overrides.controllerAddress
        : optionalAddress(env.RIG_CONTROLLER_ADDRESS),
    rigTokenAddress:
      overrides.rigTokenAddress !== undefined
        ? overrides.rigTokenAddress
        : optionalAddress(env.RIG_TOKEN_ADDRESS),
    rggTokenAddress:
      overrides.rggTokenAddress !== undefined
        ? overrides.rggTokenAddress
        : optionalAddress(env.RGG_TOKEN_ADDRESS),
    vaultAddress:
      overrides.vaultAddress !== undefined
        ? overrides.vaultAddress
        : optionalAddress(env.RIG_VAULT_ADDRESS),
    routerAddress:
      overrides.routerAddress !== undefined
        ? overrides.routerAddress
        : optionalAddress(env.RIG_X402_ROUTER_ADDRESS),
    usdcTokenAddress:
      overrides.usdcTokenAddress !== undefined
        ? overrides.usdcTokenAddress
        : optionalAddress(env.USDC_TOKEN_ADDRESS || (chainId === 8453 ? DEFAULT_BASE_USDC : '')),
    settlementPrivateKey:
      overrides.settlementPrivateKey !== undefined
        ? overrides.settlementPrivateKey
        : optionalPrivateKey(env.SETTLEMENT_PRIVATE_KEY),
    x402RggPriceAtomic:
      overrides.x402RggPriceAtomic ??
      parseNonNegativeBigInt(env.X402_RGG_PRICE_ATOMIC, 1_000_000_000_000_000_000n),
    x402UsdcPriceAtomic:
      overrides.x402UsdcPriceAtomic ?? parseNonNegativeBigInt(env.X402_USDC_PRICE_ATOMIC, 250_000n),
    rggTokenName: overrides.rggTokenName ?? (env.RGG_TOKEN_NAME?.trim() || 'RIG'),
    rggTokenVersion: overrides.rggTokenVersion ?? (env.RGG_TOKEN_VERSION?.trim() || '1'),
    usdcTokenName: overrides.usdcTokenName ?? (env.USDC_TOKEN_NAME?.trim() || 'USD Coin'),
    usdcTokenVersion: overrides.usdcTokenVersion ?? (env.USDC_TOKEN_VERSION?.trim() || '2'),
    pollIntervalMs: overrides.pollIntervalMs ?? parsePositiveInt(env.POLL_INTERVAL_MS, 3000),
    lookbackBlocks: overrides.lookbackBlocks ?? parsePositiveInt(env.INDEXER_LOOKBACK_BLOCKS, 25),
    maxTelemetryEvents: overrides.maxTelemetryEvents ?? parsePositiveInt(env.MAX_TELEMETRY_EVENTS, 200),
  };
}
