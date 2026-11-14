import { randomBytes } from 'node:crypto';
import {
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RIG_GAS_TOKEN_ABI, RIG_X402_ROUTER_ABI } from '../abis.js';
import type { RigBackendConfig } from '../config.js';
import {
  buildBaseChain,
  safeFormatUnits,
  txExplorerUrl,
  type TelemetryIndexer,
} from '../telemetry/indexer.js';
import {
  buildPaymentRequired,
  decodeX402Header,
  encodeX402Header,
  splitHexSignature,
  verifyEip2612Permit,
  verifyEip3009Authorization,
  type X402PaymentPayload,
  type X402SettlementMethod,
  type X402SettlementResponse,
} from './protocol.js';

export interface AgentExecuteRequest {
  agentId?: string;
  task?: string;
  input?: unknown;
}

export interface AgentExecuteOutcome {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export class AgentComputeService {
  private readonly config: RigBackendConfig;
  private readonly indexer: TelemetryIndexer;
  private readonly redeemedTxHashes = new Set<string>();
  private detectedRggMethod: X402SettlementMethod | null = null;

  constructor(config: RigBackendConfig, indexer: TelemetryIndexer) {
    this.config = config;
    this.indexer = indexer;
  }

  async getPaymentTerms(resourceUrl: string, error?: string) {
    const rggMethod = await this.detectRggSettlementMethod();
    return buildPaymentRequired(this.config, resourceUrl, error, rggMethod);
  }

  async handleExecute(
    resourceUrl: string,
    paymentHeader: string | undefined,
    requestBody: AgentExecuteRequest
  ): Promise<AgentExecuteOutcome> {
    if (!this.config.routerAddress && !this.config.vaultAddress) {
      const terms = await this.getPaymentTerms(resourceUrl, 'settlement_router_not_configured');
      return {
        statusCode: 402,
        headers: {
          'PAYMENT-REQUIRED': encodeX402Header(terms),
        },
        body: {
          error: 'Settlement router is not configured yet for this deployment.',
          x402: terms,
        },
      };
    }

    if (!paymentHeader) {
      const terms = await this.getPaymentTerms(resourceUrl);
      return {
        statusCode: 402,
        headers: {
          'PAYMENT-REQUIRED': encodeX402Header(terms),
        },
        body: {
          error: 'Payment Required (x402 v2)',
          x402: terms,
        },
      };
    }

    let parsed: X402PaymentPayload;
    try {
      parsed = decodeX402Header<X402PaymentPayload>(paymentHeader);
    } catch {
      return this.reject402(resourceUrl, 'invalid_payment_signature_encoding');
    }

    if (parsed.x402Version !== 2 || !parsed.accepted || !parsed.payload) {
      return this.reject402(resourceUrl, 'unsupported_x402_payload');
    }

    if (parsed.accepted.network !== this.config.caip2Network) {
      return this.reject402(resourceUrl, `network_mismatch_expected_${this.config.caip2Network}`);
    }

    if (!isAddress(parsed.accepted.asset) || !isAddress(parsed.accepted.payTo)) {
      return this.reject402(resourceUrl, 'invalid_asset_or_payto');
    }

    const asset = getAddress(parsed.accepted.asset);
    const agentId = (parsed.payload.agentId || requestBody.agentId || 'AGENT-01').slice(0, 32);
    const invoiceId: Hex =
      parsed.payload.invoiceId && isHex(parsed.payload.invoiceId) && parsed.payload.invoiceId.length === 66
        ? parsed.payload.invoiceId
        : keccak256(toHex(randomBytes(32)));

    // Mode 1: Client-settled on-chain transaction hash proof
    if (parsed.payload.txHash) {
      return this.verifyConfirmedTxProof({
        resourceUrl,
        txHash: parsed.payload.txHash,
        expectedAsset: asset,
        agentId,
        requestBody,
      });
    }

    // Mode 2: Gasless off-chain signature (EIP-2612 Permit or EIP-3009 Authorization) settled by relayer
    if (!this.config.settlementPrivateKey || !this.config.routerAddress) {
      return this.reject402(
        resourceUrl,
        'relayer_disabled_submit_onchain_and_provide_txHash_proof'
      );
    }

    const isRgg =
      this.config.rggTokenAddress !== null &&
      asset.toLowerCase() === this.config.rggTokenAddress.toLowerCase();
    const isUsdc =
      this.config.usdcTokenAddress !== null &&
      asset.toLowerCase() === this.config.usdcTokenAddress.toLowerCase();

    if (!isRgg && !isUsdc) {
      return this.reject402(resourceUrl, 'unsupported_settlement_asset');
    }

    if (isRgg && parsed.payload.permit && parsed.payload.signature) {
      return this.settleRggPermit({
        resourceUrl,
        invoiceId,
        agentId,
        permit: parsed.payload.permit,
        signature: parsed.payload.signature,
        requestBody,
      });
    }

    if (parsed.payload.authorization && parsed.payload.signature) {
      const method = parsed.accepted.extra?.settlementMethod;
      const primaryType =
        method === 'receiveWithAuthorization'
          ? 'ReceiveWithAuthorization'
          : 'TransferWithAuthorization';

      return this.settleEip3009({
        resourceUrl,
        invoiceId,
        agentId,
        asset,
        isRgg,
        primaryType,
        authorization: parsed.payload.authorization,
        signature: parsed.payload.signature,
        requestBody,
      });
    }

    return this.reject402(resourceUrl, 'missing_authorization_or_txHash');
  }

  private async settleRggPermit(params: {
    resourceUrl: string;
    invoiceId: Hex;
    agentId: string;
    permit: NonNullable<X402PaymentPayload['payload']['permit']>;
    signature: Hex;
    requestBody: AgentExecuteRequest;
  }): Promise<AgentExecuteOutcome> {
    const router = this.config.routerAddress!;
    const rgg = this.config.rggTokenAddress!;

    const check = await verifyEip2612Permit({
      chainId: this.config.chainId,
      verifyingContract: rgg,
      tokenName: this.config.rggTokenName,
      tokenVersion: this.config.rggTokenVersion,
      expectedSpender: router,
      minimumAmount: this.config.x402RggPriceAtomic,
      permit: params.permit,
      signature: params.signature,
    });

    if (!check.valid || !check.owner || check.value === undefined || check.deadline === undefined) {
      return this.reject402(params.resourceUrl, check.reason ?? 'invalid_permit');
    }

    const account = privateKeyToAccount(this.config.settlementPrivateKey!);
    const walletClient = createWalletClient({
      account,
      chain: buildBaseChain(this.config),
      transport: http(this.config.rpcUrl, { timeout: 15000 }),
    });

    const { v, r, s } = splitHexSignature(params.signature);

    try {
      const txHash = await walletClient.writeContract({
        address: router,
        abi: RIG_X402_ROUTER_ABI,
        functionName: 'settleRggWithPermit',
        args: [
          params.invoiceId,
          params.agentId,
          check.owner,
          check.value,
          check.deadline,
          v,
          r,
          s,
        ],
      });

      const receipt = await this.indexer.client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        return this.reject402(params.resourceUrl, 'onchain_settlement_reverted');
      }

      return this.finalizeSettledExecution({
        txHash,
        blockNumber: Number(receipt.blockNumber),
        logs: receipt.logs,
        payer: check.owner,
        asset: rgg,
        invoiceId: params.invoiceId,
        agentId: params.agentId,
        grossAmount: check.value,
        requestBody: params.requestBody,
      });
    } catch (err) {
      return this.reject402(
        params.resourceUrl,
        err instanceof Error ? err.message : 'settlement_tx_failed'
      );
    }
  }

  private async settleEip3009(params: {
    resourceUrl: string;
    invoiceId: Hex;
    agentId: string;
    asset: Address;
    isRgg: boolean;
    primaryType: 'ReceiveWithAuthorization' | 'TransferWithAuthorization';
    authorization: NonNullable<X402PaymentPayload['payload']['authorization']>;
    signature: Hex;
    requestBody: AgentExecuteRequest;
  }): Promise<AgentExecuteOutcome> {
    const router = this.config.routerAddress!;
    const minAmount = params.isRgg
      ? this.config.x402RggPriceAtomic
      : this.config.x402UsdcPriceAtomic;
    const tokenName = params.isRgg ? this.config.rggTokenName : this.config.usdcTokenName;
    const tokenVersion = params.isRgg ? this.config.rggTokenVersion : this.config.usdcTokenVersion;

    const check = await verifyEip3009Authorization({
      chainId: this.config.chainId,
      verifyingContract: params.asset,
      tokenName,
      tokenVersion,
      expectedPayTo: router,
      minimumAmount: minAmount,
      primaryType: params.primaryType,
      authorization: params.authorization,
      signature: params.signature,
    });

    if (
      !check.valid ||
      !check.from ||
      check.value === undefined ||
      check.validAfter === undefined ||
      check.validBefore === undefined ||
      !check.nonce
    ) {
      return this.reject402(params.resourceUrl, check.reason ?? 'invalid_authorization');
    }

    const account = privateKeyToAccount(this.config.settlementPrivateKey!);
    const walletClient = createWalletClient({
      account,
      chain: buildBaseChain(this.config),
      transport: http(this.config.rpcUrl, { timeout: 15000 }),
    });

    const { v, r, s } = splitHexSignature(params.signature);

    try {
      const txHash = params.isRgg
        ? await walletClient.writeContract({
            address: router,
            abi: RIG_X402_ROUTER_ABI,
            functionName:
              params.primaryType === 'ReceiveWithAuthorization'
                ? 'settleRggWithReceiveAuth'
                : 'settleRggWithTransferAuth',
            args: [
              params.invoiceId,
              params.agentId,
              check.from,
              check.value,
              check.validAfter,
              check.validBefore,
              check.nonce,
              v,
              r,
              s,
            ],
          })
        : await walletClient.writeContract({
            address: router,
            abi: RIG_X402_ROUTER_ABI,
            functionName: 'settleSpreadWithTransferAuth',
            args: [
              params.invoiceId,
              params.agentId,
              params.asset,
              check.from,
              check.value,
              check.validAfter,
              check.validBefore,
              check.nonce,
              v,
              r,
              s,
            ],
          });

      const receipt = await this.indexer.client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        return this.reject402(params.resourceUrl, 'onchain_settlement_reverted');
      }

      return this.finalizeSettledExecution({
        txHash,
        blockNumber: Number(receipt.blockNumber),
        logs: receipt.logs,
        payer: check.from,
        asset: params.asset,
        invoiceId: params.invoiceId,
        agentId: params.agentId,
        grossAmount: check.value,
        requestBody: params.requestBody,
      });
    } catch (err) {
      return this.reject402(
        params.resourceUrl,
        err instanceof Error ? err.message : 'settlement_tx_failed'
      );
    }
  }

  private async verifyConfirmedTxProof(params: {
    resourceUrl: string;
    txHash: Hex;
    expectedAsset: Address;
    agentId: string;
    requestBody: AgentExecuteRequest;
  }): Promise<AgentExecuteOutcome> {
    if (!isHex(params.txHash) || params.txHash.length !== 66) {
      return this.reject402(params.resourceUrl, 'invalid_txHash');
    }
    const lowerHash = params.txHash.toLowerCase();
    if (this.redeemedTxHashes.has(lowerHash)) {
      return this.reject402(params.resourceUrl, 'txHash_already_redeemed');
    }

    try {
      const receipt = await this.indexer.client.getTransactionReceipt({ hash: params.txHash });
      if (receipt.status !== 'success') {
        return this.reject402(params.resourceUrl, 'tx_reverted');
      }

      for (const log of receipt.logs) {
        if (
          this.config.routerAddress &&
          log.address.toLowerCase() !== this.config.routerAddress.toLowerCase()
        ) {
          continue;
        }
        try {
          const decoded = decodeEventLog({
            abi: RIG_X402_ROUTER_ABI,
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]],
          });
          if (decoded.eventName === 'X402Settled') {
            if (decoded.args.grossAmount < this.config.x402RggPriceAtomic) {
              return this.reject402(params.resourceUrl, 'tx_settled_below_required_price');
            }
            this.redeemedTxHashes.add(lowerHash);
            return this.finalizeSettledExecution({
              txHash: params.txHash,
              blockNumber: Number(receipt.blockNumber),
              logs: receipt.logs,
              payer: decoded.args.payer,
              asset: decoded.args.asset,
              invoiceId: decoded.args.invoiceId,
              agentId: decoded.args.agentId || params.agentId,
              grossAmount: decoded.args.grossAmount,
              requestBody: params.requestBody,
            });
          }
          if (decoded.eventName === 'SpreadSweptToVault') {
            this.redeemedTxHashes.add(lowerHash);
            return this.finalizeSettledExecution({
              txHash: params.txHash,
              blockNumber: Number(receipt.blockNumber),
              logs: receipt.logs,
              payer: decoded.args.payer,
              asset: decoded.args.asset,
              invoiceId: decoded.args.invoiceId,
              agentId: decoded.args.agentId || params.agentId,
              grossAmount: decoded.args.amount,
              requestBody: params.requestBody,
            });
          }
        } catch {
          // Skip non-router log
        }
      }

      return this.reject402(params.resourceUrl, 'no_matching_router_settlement_in_tx');
    } catch {
      return this.reject402(params.resourceUrl, 'tx_receipt_not_found');
    }
  }

  private async finalizeSettledExecution(params: {
    txHash: Hex;
    blockNumber: number;
    logs: ReadonlyArray<{ address: Address; data: Hex; topics: readonly Hex[]; logIndex: number }>;
    payer: Address;
    asset: Address;
    invoiceId: Hex;
    agentId: string;
    grossAmount: bigint;
    requestBody: AgentExecuteRequest;
  }): Promise<AgentExecuteOutcome> {
    let burnedAmount = 0n;
    let recycledAmount = 0n;
    let vaultedAmount = 0n;

    for (const log of params.logs) {
      if (
        this.config.routerAddress &&
        log.address.toLowerCase() !== this.config.routerAddress.toLowerCase()
      ) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: RIG_X402_ROUTER_ABI,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName === 'X402Settled') {
          burnedAmount = decoded.args.burnedAmount;
          recycledAmount = decoded.args.recycledAmount;
          vaultedAmount = decoded.args.vaultedAmount;
        } else if (decoded.eventName === 'SpreadSweptToVault') {
          vaultedAmount = decoded.args.amount;
        }
      } catch {
        // Ignore unrelated log entries
      }
    }

    const isUsdc =
      this.config.usdcTokenAddress !== null &&
      params.asset.toLowerCase() === this.config.usdcTokenAddress.toLowerCase();
    const decimals = isUsdc ? 6 : 18;
    const symbol = isUsdc ? 'USDC' : '$RGG';
    const grossFmt = safeFormatUnits(params.grossAmount, decimals, 4);
    const burnedFmt = safeFormatUnits(burnedAmount, decimals, 4);
    const vaultedFmt = safeFormatUnits(vaultedAmount, decimals, 4);

    this.indexer.recordEvent({
      id: `${params.txHash}:gateway`,
      timestamp: new Date().toISOString(),
      blockNumber: params.blockNumber,
      txHash: params.txHash,
      explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, params.txHash),
      agentId: params.agentId,
      primitive: isUsdc ? 'RIG_VAULT' : 'RGG_GAS',
      action: isUsdc ? 'SPREAD_SWEPT' : 'X402_SETTLED',
      summary: isUsdc
        ? `x402 cleared ${grossFmt} USDC -> swept ${vaultedFmt} USDC to $RIG Reserve Vault`
        : `x402 cleared ${grossFmt} ${symbol} -> burned ${burnedFmt} $RGG | swept ${vaultedFmt} to $RIG vault`,
      asset: params.asset,
      grossFormatted: grossFmt,
      burnedFormatted: burnedFmt,
      vaultedFormatted: vaultedFmt,
    });

    await this.indexer.syncOnce();

    const settlementResponse: X402SettlementResponse = {
      success: true,
      network: this.config.caip2Network,
      transaction: params.txHash,
      payer: params.payer,
      asset: params.asset,
      grossAmount: params.grossAmount.toString(),
      burnedAmount: burnedAmount.toString(),
      recycledAmount: recycledAmount.toString(),
      vaultedAmount: vaultedAmount.toString(),
      invoiceId: params.invoiceId,
      agentId: params.agentId,
    };

    const taskName = params.requestBody.task || 'cluster.telemetry.ping';
    const executionDigest = keccak256(
      toHex(
        JSON.stringify({
          invoiceId: params.invoiceId,
          txHash: params.txHash,
          task: taskName,
          input: params.requestBody.input ?? null,
        })
      )
    );

    return {
      statusCode: 200,
      headers: {
        'PAYMENT-RESPONSE': encodeX402Header(settlementResponse),
      },
      body: {
        ok: true,
        agentId: params.agentId,
        task: taskName,
        executionDigest,
        settlement: settlementResponse,
        explorerUrl: txExplorerUrl(this.config.explorerBaseUrl, params.txHash),
      },
    };
  }

  private async detectRggSettlementMethod(): Promise<X402SettlementMethod> {
    if (this.detectedRggMethod) return this.detectedRggMethod;
    if (!this.config.rggTokenAddress) return 'permit';
    try {
      await this.indexer.client.readContract({
        address: this.config.rggTokenAddress,
        abi: RIG_GAS_TOKEN_ABI,
        functionName: 'authorizationState',
        args: ['0x000000000000000000000000000000000000dEaD', `0x${'00'.repeat(32)}`],
      });
      this.detectedRggMethod = 'receiveWithAuthorization';
      return this.detectedRggMethod;
    } catch {
      this.detectedRggMethod = 'permit';
      return this.detectedRggMethod;
    }
  }

  private async reject402(resourceUrl: string, error: string): Promise<AgentExecuteOutcome> {
    const terms = await this.getPaymentTerms(resourceUrl, error);
    return {
      statusCode: 402,
      headers: {
        'PAYMENT-REQUIRED': encodeX402Header(terms),
      },
      body: {
        error,
        x402: terms,
      },
    };
  }
}
