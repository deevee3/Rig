import { EventEmitter } from 'node:events';
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  formatEther,
  formatUnits,
  http,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  ERC20_ABI,
  RIG_CONTROLLER_ABI,
  RIG_GAS_TOKEN_ABI,
  RIG_VAULT_ABI,
  RIG_X402_ROUTER_ABI,
} from '../abis.js';
import type { RigBackendConfig } from '../config.js';

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;
const ZERO_ADDRESS = zeroAddress;

export type TelemetryPrimitive = 'RIG_VAULT' | 'RGG_GAS' | 'SYSTEM';

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  blockNumber: number;
  txHash: Hex;
  explorerUrl: string;
  agentId: string;
  primitive: TelemetryPrimitive;
  action: string;
  summary: string;
  asset?: Address;
  grossFormatted?: string;
  burnedFormatted?: string;
  vaultedFormatted?: string;
}

export interface TokenMarketStats {
  priceUsd: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: number | null;
  pairAddress: string | null;
  dexId: string | null;
}

export interface TelemetrySnapshot {
  status: 'live' | 'awaiting_genesis' | 'rpc_error';
  lastError: string | null;
  updatedAt: string;
  chainId: number;
  networkLabel: string;
  caip2Network: string;
  explorerBaseUrl: string;
  blockNumber: number | null;
  contracts: {
    controller: Address | null;
    rigToken: Address | null;
    rggToken: Address | null;
    vault: Address | null;
    router: Address | null;
    usdcToken: Address | null;
  };
  controller: {
    genesisSealed: boolean | null;
    humanOverrideBps: number | null;
    genesisBlock: number | null;
    genesisTimestamp: number | null;
  };
  metrics: {
    rigTotalSupply: string | null;
    rggTotalSupply: string | null;
    rggTotalBurned: string;
    vaultEthReserve: string;
    vaultUsdcReserve: string;
    vaultRggReserve: string;
    totalSettlements: string;
    totalRggSettled: string;
    totalRggRecycled: string;
  };
  market: {
    rig: TokenMarketStats | null;
    rgg: TokenMarketStats | null;
  };
  events: TelemetryEvent[];
}

export function buildBaseChain(config: RigBackendConfig) {
  return defineChain({
    id: config.chainId,
    name: config.networkLabel,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
  });
}

export function txExplorerUrl(explorerBaseUrl: string, txHash: string): string {
  if (!explorerBaseUrl) return '';
  return `${explorerBaseUrl.replace(/\/$/, '')}/tx/${txHash}`;
}

export function safeFormatUnits(value: bigint, decimals: number, precision = 4): string {
  const raw = formatUnits(value, decimals);
  const [whole, frac = ''] = raw.split('.');
  if (!frac) return whole;
  const clipped = frac.slice(0, precision).replace(/0+$/, '');
  return clipped ? `${whole}.${clipped}` : whole;
}

export class TelemetryIndexer extends EventEmitter {
  readonly config: RigBackendConfig;
  readonly client: PublicClient;

  private events: TelemetryEvent[] = [];
  private seenEventIds = new Set<string>();
  private lastScannedBlock: bigint | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private blockTimestampCache = new Map<bigint, string>();
  private lastMarketFetchAt = 0;
  private logBackoffUntil = 0;
  private snapshot: TelemetrySnapshot;

  constructor(config: RigBackendConfig) {
    super();
    this.config = config;
    this.client = createPublicClient({
      chain: buildBaseChain(config),
      transport: http(config.rpcUrl, { timeout: 8000 }),
    });

    const hasAnyContract = Boolean(
      config.controllerAddress ||
        config.rigTokenAddress ||
        config.rggTokenAddress ||
        config.vaultAddress ||
        config.routerAddress
    );

    this.snapshot = {
      status: hasAnyContract ? 'live' : 'awaiting_genesis',
      lastError: null,
      updatedAt: new Date().toISOString(),
      chainId: config.chainId,
      networkLabel: config.networkLabel,
      caip2Network: config.caip2Network,
      explorerBaseUrl: config.explorerBaseUrl,
      blockNumber: null,
      contracts: {
        controller: config.controllerAddress,
        rigToken: config.rigTokenAddress,
        rggToken: config.rggTokenAddress,
        vault: config.vaultAddress,
        router: config.routerAddress,
        usdcToken: config.usdcTokenAddress,
      },
      controller: {
        genesisSealed: null,
        humanOverrideBps: null,
        genesisBlock: null,
        genesisTimestamp: null,
      },
      metrics: {
        rigTotalSupply: null,
        rggTotalSupply: null,
        rggTotalBurned: '0',
        vaultEthReserve: '0',
        vaultUsdcReserve: '0',
        vaultRggReserve: '0',
        totalSettlements: '0',
        totalRggSettled: '0',
        totalRggRecycled: '0',
      },
      market: {
        rig: null,
        rgg: null,
      },
      events: [],
    };
  }

  getSnapshot(): TelemetrySnapshot {
    return {
      ...this.snapshot,
      events: [...this.events],
    };
  }

  start(): void {
    if (this.pollTimer) return;
    void this.syncOnce();
    this.pollTimer = setInterval(() => {
      void this.syncOnce();
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  recordEvent(event: TelemetryEvent): boolean {
    if (this.seenEventIds.has(event.id)) return false;
    this.seenEventIds.add(event.id);
    this.events.unshift(event);
    if (this.events.length > this.config.maxTelemetryEvents) {
      const removed = this.events.pop();
      if (removed) this.seenEventIds.delete(removed.id);
    }
    this.snapshot = {
      ...this.snapshot,
      updatedAt: new Date().toISOString(),
      events: [...this.events],
    };
    this.emit('telemetry', event);
    return true;
  }

  async syncOnce(): Promise<TelemetrySnapshot> {
    if (this.polling) return this.getSnapshot();
    this.polling = true;

    try {
      const latestBlock = await this.client.getBlockNumber();
      const contractsConfigured = Boolean(
        this.config.controllerAddress ||
          this.config.rigTokenAddress ||
          this.config.rggTokenAddress ||
          this.config.vaultAddress ||
          this.config.routerAddress
      );

      if (!contractsConfigured) {
        this.snapshot = {
          ...this.snapshot,
          status: 'awaiting_genesis',
          lastError: null,
          updatedAt: new Date().toISOString(),
          blockNumber: Number(latestBlock),
        };
        this.emit('snapshot', this.getSnapshot());
        return this.getSnapshot();
      }

      await this.refreshContractState();
      await this.refreshMarketStats();

      if (Date.now() >= this.logBackoffUntil) {
        try {
          await this.scanNewLogs(latestBlock);
        } catch (logErr) {
          const msg = logErr instanceof Error ? logErr.message : String(logErr);
          if (msg.includes('429') || msg.toLowerCase().includes('limit')) {
            this.logBackoffUntil = Date.now() + 30_000;
          } else {
            throw logErr;
          }
        }
      }

      this.snapshot = {
        ...this.snapshot,
        status: 'live',
        lastError: null,
        updatedAt: new Date().toISOString(),
        blockNumber: Number(latestBlock),
        events: [...this.events],
      };
      this.emit('snapshot', this.getSnapshot());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.snapshot = {
        ...this.snapshot,
        status: 'rpc_error',
        lastError: message,
        updatedAt: new Date().toISOString(),
      };
      this.emit('snapshot', this.getSnapshot());
    } finally {
      this.polling = false;
    }

    return this.getSnapshot();
  }

  private async refreshContractState(): Promise<void> {
    const c = this.config;

    if (c.controllerAddress) {
      try {
        const state = await this.client.readContract({
          address: c.controllerAddress,
          abi: RIG_CONTROLLER_ABI,
          functionName: 'controllerState',
        });
        this.snapshot.controller = {
          genesisSealed: state[0],
          humanOverrideBps: Number(state[1]),
          genesisBlock: Number(state[6]),
          genesisTimestamp: Number(state[7]),
        };
      } catch {
        // Non-standard controller contract; leave null rather than failing sync.
      }
    }

    if (c.rigTokenAddress) {
      const supply = await this.client.readContract({
        address: c.rigTokenAddress,
        abi: ERC20_ABI,
        functionName: 'totalSupply',
      });
      this.snapshot.metrics.rigTotalSupply = safeFormatUnits(supply, 18, 2);
    }

    if (c.rggTokenAddress) {
      const supply = await this.client.readContract({
        address: c.rggTokenAddress,
        abi: ERC20_ABI,
        functionName: 'totalSupply',
      });
      this.snapshot.metrics.rggTotalSupply = safeFormatUnits(supply, 18, 2);

      let burned = 0n;
      try {
        burned = await this.client.readContract({
          address: c.rggTokenAddress,
          abi: RIG_GAS_TOKEN_ABI,
          functionName: 'totalBurned',
        });
      } catch {
        const [deadBal, zeroBal] = await Promise.all([
          this.client.readContract({
            address: c.rggTokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [DEAD_ADDRESS],
          }),
          this.client.readContract({
            address: c.rggTokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [ZERO_ADDRESS],
          }),
        ]);
        burned = deadBal + zeroBal;
      }
      this.snapshot.metrics.rggTotalBurned = safeFormatUnits(burned, 18, 4);
    }

    if (c.vaultAddress) {
      const ethBalance = await this.client.getBalance({ address: c.vaultAddress });
      this.snapshot.metrics.vaultEthReserve = safeFormatUnits(ethBalance, 18, 5);

      if (c.usdcTokenAddress) {
        try {
          const usdcBalance = await this.client.readContract({
            address: c.usdcTokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [c.vaultAddress],
          });
          this.snapshot.metrics.vaultUsdcReserve = safeFormatUnits(usdcBalance, 6, 2);
        } catch {
          // Ignore if USDC contract does not exist on local/testnet.
        }
      }

      if (c.rggTokenAddress) {
        const rggVaultBal = await this.client.readContract({
          address: c.rggTokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [c.vaultAddress],
        });
        this.snapshot.metrics.vaultRggReserve = safeFormatUnits(rggVaultBal, 18, 2);
      }
    }

    if (c.routerAddress) {
      try {
        const [settlements, rggSettled, rggBurned, rggRecycled] = await Promise.all([
          this.client.readContract({
            address: c.routerAddress,
            abi: RIG_X402_ROUTER_ABI,
            functionName: 'totalSettlements',
          }),
          this.client.readContract({
            address: c.routerAddress,
            abi: RIG_X402_ROUTER_ABI,
            functionName: 'totalRggSettled',
          }),
          this.client.readContract({
            address: c.routerAddress,
            abi: RIG_X402_ROUTER_ABI,
            functionName: 'totalRggBurned',
          }),
          this.client.readContract({
            address: c.routerAddress,
            abi: RIG_X402_ROUTER_ABI,
            functionName: 'totalRggRecycled',
          }),
        ]);
        this.snapshot.metrics.totalSettlements = settlements.toString();
        this.snapshot.metrics.totalRggSettled = safeFormatUnits(rggSettled, 18, 4);
        this.snapshot.metrics.totalRggRecycled = safeFormatUnits(rggRecycled, 18, 4);
        if (rggBurned > 0n && this.snapshot.metrics.rggTotalBurned === '0') {
          this.snapshot.metrics.rggTotalBurned = safeFormatUnits(rggBurned, 18, 4);
        }
      } catch {
        // Non-standard router; metrics remain token-derived.
      }
    }
  }

  private async refreshMarketStats(): Promise<void> {
    if (this.config.chainId !== 8453) return;
    if (Date.now() - this.lastMarketFetchAt < 30_000) return;
    const addresses = [this.config.rigTokenAddress, this.config.rggTokenAddress].filter(
      (a): a is Address => Boolean(a)
    );
    if (addresses.length === 0) return;
    this.lastMarketFetchAt = Date.now();

    try {
      const resp = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${addresses.join(',')}`,
        { signal: AbortSignal.timeout(4000) }
      );
      if (!resp.ok) return;
      const json = (await resp.json()) as {
        pairs?: Array<{
          chainId?: string;
          dexId?: string;
          pairAddress?: string;
          baseToken?: { address?: string };
          priceUsd?: string;
          liquidity?: { usd?: number };
          volume?: { h24?: number };
          txns?: { h24?: { buys?: number; sells?: number } };
        }> | null;
      };
      const pairs = (json.pairs ?? []).filter((p) => p.chainId === 'base');
      const pickTop = (addr: Address | null): TokenMarketStats | null => {
        if (!addr) return null;
        const matching = pairs
          .filter((p) => p.baseToken?.address?.toLowerCase() === addr.toLowerCase())
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const top = matching[0];
        if (!top) return null;
        return {
          priceUsd: top.priceUsd ?? null,
          liquidityUsd: top.liquidity?.usd ?? null,
          volume24hUsd: top.volume?.h24 ?? null,
          txns24h:
            top.txns?.h24 !== undefined
              ? (top.txns.h24.buys ?? 0) + (top.txns.h24.sells ?? 0)
              : null,
          pairAddress: top.pairAddress ?? null,
          dexId: top.dexId ?? null,
        };
      };

      this.snapshot.market = {
        rig: pickTop(this.config.rigTokenAddress),
        rgg: pickTop(this.config.rggTokenAddress),
      };
    } catch {
      // DexScreener unreachable or unindexed yet; preserve existing values.
    }
  }

  private async scanNewLogs(latestBlock: bigint): Promise<void> {
    const lookback = BigInt(this.config.lookbackBlocks);
    const fromBlock =
      this.lastScannedBlock !== null
        ? this.lastScannedBlock + 1n
        : latestBlock > lookback
          ? latestBlock - lookback
          : 0n;

    if (fromBlock > latestBlock) return;

    const collected: TelemetryEvent[] = [];

    if (this.config.routerAddress) {
      const routerLogs = await this.client.getLogs({
        address: this.config.routerAddress,
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of routerLogs) {
        const parsed = await this.parseRouterLog(log);
        if (parsed) collected.push(parsed);
      }
    }

    if (this.config.vaultAddress) {
      const vaultLogs = await this.client.getLogs({
        address: this.config.vaultAddress,
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of vaultLogs) {
        const parsed = await this.parseVaultLog(log);
        if (parsed) collected.push(parsed);
      }
    }

    if (this.config.rggTokenAddress) {
      const burnTransferLogs = await this.client.getLogs({
        address: this.config.rggTokenAddress,
        event: TRANSFER_EVENT,
        args: { to: [DEAD_ADDRESS, ZERO_ADDRESS] },
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of burnTransferLogs) {
        if (!log.transactionHash || log.blockNumber === null) continue;
        const value = log.args.value ?? 0n;
        if (value === 0n) continue;
        const ts = await this.getBlockTimestamp(log.blockNumber);
        const amountFmt = safeFormatUnits(value, 18, 4);
        collected.push({
          id: `${log.transactionHash}:${log.logIndex ?? 0}`,
          timestamp: ts,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
          agentId: 'BURN-PIPE',
          primitive: 'RGG_GAS',
          action: 'RGG_BURNED',
          summary: `burned ${amountFmt} $RGG to immutable sink`,
          asset: this.config.rggTokenAddress,
          burnedFormatted: amountFmt,
        });
      }
    }

    // Before RigX402Router is bound, surface live ERC-20 Transfer flows on $RIG and $RGG.
    if (!this.config.routerAddress) {
      const tokenEntries: Array<{ addr: Address; primitive: TelemetryPrimitive; sym: string; agent: string }> = [];
      if (this.config.rigTokenAddress) {
        tokenEntries.push({ addr: this.config.rigTokenAddress, primitive: 'RIG_VAULT', sym: '$RIG', agent: 'RIG-CHAIN' });
      }
      if (this.config.rggTokenAddress) {
        tokenEntries.push({ addr: this.config.rggTokenAddress, primitive: 'RGG_GAS', sym: '$RGG', agent: 'RGG-CHAIN' });
      }
      for (const entry of tokenEntries) {
        const txLogs = await this.client.getLogs({
          address: entry.addr,
          event: TRANSFER_EVENT,
          fromBlock,
          toBlock: latestBlock,
        });
        for (const log of txLogs.slice(-15)) {
          if (!log.transactionHash || log.blockNumber === null) continue;
          const toAddr = (log.args.to ?? '').toLowerCase();
          if (toAddr === DEAD_ADDRESS.toLowerCase() || toAddr === ZERO_ADDRESS) continue;
          const value = log.args.value ?? 0n;
          if (value === 0n) continue;
          const ts = await this.getBlockTimestamp(log.blockNumber);
          const amt = safeFormatUnits(value, 18, 2);
          collected.push({
            id: `${log.transactionHash}:${log.logIndex ?? 0}`,
            timestamp: ts,
            blockNumber: Number(log.blockNumber),
            txHash: log.transactionHash,
            explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
            agentId: entry.agent,
            primitive: entry.primitive,
            action: 'ERC20_TRANSFER',
            summary: `on-chain transfer ${amt} ${entry.sym} settled on Base`,
            asset: entry.addr,
            grossFormatted: amt,
          });
        }
      }
    }

    collected.sort((a, b) => a.blockNumber - b.blockNumber);
    for (const ev of collected) {
      this.recordEvent(ev);
    }
    this.lastScannedBlock = latestBlock;
  }

  private async parseRouterLog(log: {
    data: Hex;
    topics: readonly Hex[];
    transactionHash: Hex | null;
    blockNumber: bigint | null;
    logIndex: number | null;
  }): Promise<TelemetryEvent | null> {
    if (!log.transactionHash || log.blockNumber === null || log.topics.length === 0) return null;
    try {
      const decoded = decodeEventLog({
        abi: RIG_X402_ROUTER_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const ts = await this.getBlockTimestamp(log.blockNumber);

      if (decoded.eventName === 'X402Settled') {
        const gross = safeFormatUnits(decoded.args.grossAmount, 18, 4);
        const burned = safeFormatUnits(decoded.args.burnedAmount, 18, 4);
        const vaulted = safeFormatUnits(decoded.args.vaultedAmount, 18, 4);
        return {
          id: `${log.transactionHash}:${log.logIndex ?? 0}`,
          timestamp: ts,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
          agentId: decoded.args.agentId || 'AGENT-01',
          primitive: 'RGG_GAS',
          action: 'X402_SETTLED',
          summary: `x402 cleared ${gross} $RGG -> burned ${burned} $RGG | swept ${vaulted} to $RIG vault`,
          asset: decoded.args.asset,
          grossFormatted: gross,
          burnedFormatted: burned,
          vaultedFormatted: vaulted,
        };
      }

      if (decoded.eventName === 'SpreadSweptToVault') {
        const isUsdc =
          this.config.usdcTokenAddress &&
          decoded.args.asset.toLowerCase() === this.config.usdcTokenAddress.toLowerCase();
        const decimals = isUsdc ? 6 : 18;
        const symbol = isUsdc ? 'USDC' : 'ASSET';
        const amt = safeFormatUnits(decoded.args.amount, decimals, 4);
        return {
          id: `${log.transactionHash}:${log.logIndex ?? 0}`,
          timestamp: ts,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
          agentId: decoded.args.agentId || 'VAULT-01',
          primitive: 'RIG_VAULT',
          action: 'SPREAD_SWEPT',
          summary: `swept ${amt} ${symbol} spread to $RIG Reserve Vault`,
          asset: decoded.args.asset,
          vaultedFormatted: amt,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private async parseVaultLog(log: {
    data: Hex;
    topics: readonly Hex[];
    transactionHash: Hex | null;
    blockNumber: bigint | null;
    logIndex: number | null;
  }): Promise<TelemetryEvent | null> {
    if (!log.transactionHash || log.blockNumber === null || log.topics.length === 0) return null;
    try {
      const decoded = decodeEventLog({
        abi: RIG_VAULT_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const ts = await this.getBlockTimestamp(log.blockNumber);

      if (decoded.eventName === 'VaultSwept') {
        const isUsdc =
          this.config.usdcTokenAddress &&
          decoded.args.asset.toLowerCase() === this.config.usdcTokenAddress.toLowerCase();
        const isRgg =
          this.config.rggTokenAddress &&
          decoded.args.asset.toLowerCase() === this.config.rggTokenAddress.toLowerCase();
        const decimals = isUsdc ? 6 : 18;
        const sym = isUsdc ? 'USDC' : isRgg ? '$RGG' : 'ERC20';
        const amt = safeFormatUnits(decoded.args.amount, decimals, 4);
        return {
          id: `${log.transactionHash}:${log.logIndex ?? 0}`,
          timestamp: ts,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
          agentId: 'VAULT-01',
          primitive: 'RIG_VAULT',
          action: 'VAULT_SWEPT',
          summary: `vault locked +${amt} ${sym} reserve sweep`,
          asset: decoded.args.asset,
          vaultedFormatted: amt,
        };
      }

      if (decoded.eventName === 'NativeVaultSwept') {
        const ethFmt = Number(formatEther(decoded.args.amount)).toFixed(5);
        return {
          id: `${log.transactionHash}:${log.logIndex ?? 0}`,
          timestamp: ts,
          blockNumber: Number(log.blockNumber),
          txHash: log.transactionHash,
          explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, log.transactionHash),
          agentId: 'VAULT-01',
          primitive: 'RIG_VAULT',
          action: 'ETH_SWEPT',
          summary: `vault locked +${ethFmt} ETH reserve deposit`,
          vaultedFormatted: ethFmt,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<string> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached) return cached;
    try {
      const block = await this.client.getBlock({ blockNumber });
      const iso = new Date(Number(block.timestamp) * 1000).toISOString();
      if (this.blockTimestampCache.size > 500) {
        this.blockTimestampCache.clear();
      }
      this.blockTimestampCache.set(blockNumber, iso);
      return iso;
    } catch {
      return new Date().toISOString();
    }
  }
}
