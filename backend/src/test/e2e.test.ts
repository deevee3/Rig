import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RIG_CONTROLLER_ABI, RIG_GAS_TOKEN_ABI } from '../abis.js';
import { createRigServer } from '../server.js';
import {
  decodeX402Header,
  EIP2612_TYPES,
  EIP3009_TYPES,
  encodeX402Header,
  type X402PaymentRequired,
  type X402SettlementResponse,
} from '../x402/protocol.js';

const ANVIL_DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const ANVIL_PAYER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_OUT = resolve(HERE, '../../../contracts/out');

function loadArtifact(contractFile: string, contractName: string): { abi: readonly unknown[]; bytecode: Hex } {
  const raw = readFileSync(resolve(CONTRACTS_OUT, contractFile, `${contractName}.json`), 'utf8');
  const parsed = JSON.parse(raw) as { abi: readonly unknown[]; bytecode: { object: Hex } };
  return { abi: parsed.abi, bytecode: parsed.bytecode.object };
}

async function startAnvil(port: number): Promise<ChildProcess> {
  const proc = spawn('anvil', ['--port', String(port), '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rpcUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      if (res.ok) return proc;
    } catch {
      // Wait for Anvil bind
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill('SIGKILL');
  throw new Error('Timed out starting local Anvil instance');
}

test('full x402 v2 settlement + live RPC telemetry indexer on local Anvil', async () => {
  const anvilPort = 18545;
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const anvil = await startAnvil(anvilPort);

  try {
    const chain = defineChain({
      id: 31337,
      name: 'LOCAL ANVIL',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });

    const deployer = privateKeyToAccount(ANVIL_DEPLOYER_KEY);
    const payer = privateKeyToAccount(ANVIL_PAYER_KEY);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const deployerWallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });

    const controllerArtifact = loadArtifact('RigController.sol', 'RigController');
    const deployTx = await deployerWallet.deployContract({
      abi: controllerArtifact.abi,
      bytecode: controllerArtifact.bytecode,
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
    const controllerAddress = deployReceipt.contractAddress as Address;
    assert.ok(controllerAddress);

    const initAbi = [
      {
        type: 'function',
        name: 'deployTwinGenesis',
        stateMutability: 'nonpayable',
        inputs: [
          {
            name: 'params',
            type: 'tuple',
            components: [
              { name: 'rigTotalSupply', type: 'uint256' },
              { name: 'rggTotalSupply', type: 'uint256' },
              { name: 'rigRecipient', type: 'address' },
              { name: 'rggRecipient', type: 'address' },
              { name: 'recycleTreasury', type: 'address' },
              { name: 'burnBps', type: 'uint16' },
              { name: 'recycleBps', type: 'uint16' },
              { name: 'vaultBps', type: 'uint16' },
            ],
          },
        ],
        outputs: [
          { name: 'rig_', type: 'address' },
          { name: 'rgg_', type: 'address' },
          { name: 'vault_', type: 'address' },
          { name: 'router_', type: 'address' },
        ],
      },
    ] as const;

    const genesisTx = await deployerWallet.writeContract({
      address: controllerAddress,
      abi: initAbi,
      functionName: 'deployTwinGenesis',
      args: [
        {
          rigTotalSupply: parseEther('1000000000'),
          rggTotalSupply: parseEther('1000000000'),
          rigRecipient: deployer.address,
          rggRecipient: payer.address,
          recycleTreasury: deployer.address,
          burnBps: 5000,
          recycleBps: 3500,
          vaultBps: 1500,
        },
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: genesisTx });

    const state = await publicClient.readContract({
      address: controllerAddress,
      abi: RIG_CONTROLLER_ABI,
      functionName: 'controllerState',
    });
    const rigTokenAddress = state[2];
    const rggTokenAddress = state[3];
    const vaultAddress = state[4];
    const routerAddress = state[5];

    const instance = await createRigServer(
      {
        port: 0,
        host: '127.0.0.1',
        chainId: 31337,
        rpcUrl,
        explorerBaseUrl: '',
        controllerAddress,
        rigTokenAddress,
        rggTokenAddress,
        vaultAddress,
        routerAddress,
        usdcTokenAddress: null,
        settlementPrivateKey: ANVIL_DEPLOYER_KEY,
        x402RggPriceAtomic: parseEther('10'),
        rggTokenName: 'The Rig Execution Gas',
        rggTokenVersion: '1',
      },
      { startPolling: false }
    );

    try {
      const baseUrl = `http://127.0.0.1:${instance.port}`;

      // 1. Unpaid request must return 402 + Base64 PAYMENT-REQUIRED header
      const unpaidRes = await fetch(`${baseUrl}/v1/agent/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'AGENT-01', task: 'cluster.infer.v1' }),
      });
      assert.equal(unpaidRes.status, 402);
      const reqHeader = unpaidRes.headers.get('payment-required');
      assert.ok(reqHeader);
      const terms = decodeX402Header<X402PaymentRequired>(reqHeader);
      assert.equal(terms.x402Version, 2);
      assert.equal(terms.accepts[0].network, 'eip155:31337');
      assert.equal(terms.accepts[0].extra.settlementMethod, 'receiveWithAuthorization');

      // 2. Sign genuine EIP-3009 ReceiveWithAuthorization using payer key
      const block = await publicClient.getBlock();
      const validAfter = (block.timestamp - 10n).toString();
      const validBefore = (block.timestamp + 600n).toString();
      const nonce = keccak256(toHex('e2e-nonce-1'));

      const sig = await payer.signTypedData({
        domain: {
          name: 'The Rig Execution Gas',
          version: '1',
          chainId: 31337,
          verifyingContract: rggTokenAddress,
        },
        types: {
          ReceiveWithAuthorization: EIP3009_TYPES.ReceiveWithAuthorization,
        },
        primaryType: 'ReceiveWithAuthorization',
        message: {
          from: payer.address,
          to: routerAddress,
          value: parseEther('10'),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      });

      const paymentPayload = encodeX402Header({
        x402Version: 2,
        accepted: terms.accepts[0],
        payload: {
          agentId: 'AGENT-01',
          authorization: {
            from: payer.address,
            to: routerAddress,
            value: parseEther('10').toString(),
            validAfter,
            validBefore,
            nonce,
          },
          signature: sig,
        },
      });

      const paidRes = await fetch(`${baseUrl}/v1/agent/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-SIGNATURE': paymentPayload,
        },
        body: JSON.stringify({ agentId: 'AGENT-01', task: 'cluster.infer.v1' }),
      });
      assert.equal(paidRes.status, 200);
      const payRespHeader = paidRes.headers.get('payment-response');
      assert.ok(payRespHeader);
      const settlement = decodeX402Header<X402SettlementResponse>(payRespHeader);
      assert.equal(settlement.success, true);
      assert.equal(settlement.burnedAmount, parseEther('5').toString());
      assert.equal(settlement.vaultedAmount, parseEther('1.5').toString());

      // 3. Verify on-chain burned amount & live snapshot reflect real chain state
      const onchainBurned = await publicClient.readContract({
        address: rggTokenAddress,
        abi: RIG_GAS_TOKEN_ABI,
        functionName: 'totalBurned',
      });
      assert.equal(onchainBurned, parseEther('5'));

      const snapRes = await fetch(`${baseUrl}/api/telemetry/snapshot?refresh=1`);
      assert.equal(snapRes.status, 200);
      const snap = (await snapRes.json()) as {
        status: string;
        controller: { genesisSealed: boolean; humanOverrideBps: number };
        metrics: { rggTotalBurned: string; totalSettlements: string; vaultRggReserve: string };
        events: Array<{ txHash: string; agentId: string }>;
      };
      assert.equal(snap.status, 'live');
      assert.equal(snap.controller.genesisSealed, true);
      assert.equal(snap.controller.humanOverrideBps, 0);
      assert.equal(snap.metrics.rggTotalBurned, '5');
      assert.equal(snap.metrics.totalSettlements, '1');
      assert.equal(snap.metrics.vaultRggReserve, '1.5');
      assert.ok(snap.events.some((e) => e.txHash === settlement.transaction));

      // 4. Verify EIP-2612 Permit helper works cleanly too (Doppler / Base Mainnet $RGG path)
      const permitSig = await payer.signTypedData({
        domain: {
          name: 'The Rig Execution Gas',
          version: '1',
          chainId: 31337,
          verifyingContract: rggTokenAddress,
        },
        types: EIP2612_TYPES,
        primaryType: 'Permit',
        message: {
          owner: payer.address,
          spender: routerAddress,
          value: parseEther('10'),
          nonce: 0n,
          deadline: BigInt(validBefore),
        },
      });
      const permitPayload = encodeX402Header({
        x402Version: 2,
        accepted: { ...terms.accepts[0], extra: { settlementMethod: 'permit' } },
        payload: {
          agentId: 'AGENT-02',
          permit: {
            owner: payer.address,
            spender: routerAddress,
            value: parseEther('10').toString(),
            nonce: '0',
            deadline: validBefore,
          },
          signature: permitSig,
        },
      });
      const permitRes = await fetch(`${baseUrl}/v1/agent/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-SIGNATURE': permitPayload,
        },
        body: JSON.stringify({ agentId: 'AGENT-02', task: 'cluster.permit.v1' }),
      });
      assert.equal(permitRes.status, 200);
      const afterPermitBurned = await publicClient.readContract({
        address: rggTokenAddress,
        abi: RIG_GAS_TOKEN_ABI,
        functionName: 'totalBurned',
      });
      assert.equal(afterPermitBurned, parseEther('10'));
    } finally {
      await instance.close();
    }
  } finally {
    anvil.kill('SIGKILL');
  }
});
