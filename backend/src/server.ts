import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, type RigBackendConfig } from './config.js';
import { TelemetryIndexer, type TelemetryEvent, type TelemetrySnapshot } from './telemetry/indexer.js';
import { AgentComputeService, type AgentExecuteRequest } from './x402/agentService.js';

export interface RigServerInstance {
  server: Server;
  indexer: TelemetryIndexer;
  agentService: AgentComputeService;
  port: number;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 128 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error('Request payload exceeds 128KB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolvePromise(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        rejectPromise(new Error('Malformed JSON request body'));
      }
    });

    req.on('error', rejectPromise);
  });
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  corsOrigin: string,
  extraHeaders: Record<string, string> = {}
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE',
    'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  });
  res.end(body);
}

export async function createRigServer(
  overrides: Partial<RigBackendConfig> = {},
  options: { startPolling?: boolean } = {}
): Promise<RigServerInstance> {
  const config = loadConfig(overrides);
  const indexer = new TelemetryIndexer(config);
  const agentService = new AgentComputeService(config, indexer);
  const sseClients = new Set<ServerResponse>();

  const here = dirname(fileURLToPath(import.meta.url));
  const staticIndexPath = resolve(here, '../../index.html');
  const staticAssetsDir = resolve(here, '../../assets');

  const onTelemetry = (ev: TelemetryEvent) => {
    const frame = `event: telemetry\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  const onSnapshot = (snap: TelemetrySnapshot) => {
    const frame = `event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  indexer.on('telemetry', onTelemetry);
  indexer.on('snapshot', onSnapshot);

  const heartbeat = setInterval(() => {
    for (const client of sseClients) {
      client.write(': keepalive\n\n');
    }
  }, 15_000);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE',
        'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (existsSync(staticIndexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(staticIndexPath, 'utf8'));
        return;
      }
    }

    const assetMatch = method === 'GET' ? url.pathname.match(/^\/assets\/([a-z0-9_-]+\.png)$/i) : null;
    if (assetMatch) {
      const assetPath = resolve(staticAssetsDir, assetMatch[1]);
      if (existsSync(assetPath)) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    if (method === 'GET' && url.pathname === '/api/health') {
      const snap = indexer.getSnapshot();
      sendJson(
        res,
        200,
        {
          ok: true,
          status: snap.status,
          chainId: config.chainId,
          networkLabel: config.networkLabel,
          blockNumber: snap.blockNumber,
          sseClients: sseClients.size,
        },
        config.corsOrigin
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/api/config') {
      sendJson(
        res,
        200,
        {
          chainId: config.chainId,
          caip2Network: config.caip2Network,
          networkLabel: config.networkLabel,
          explorerBaseUrl: config.explorerBaseUrl,
          contracts: {
            controller: config.controllerAddress,
            rigToken: config.rigTokenAddress,
            rggToken: config.rggTokenAddress,
            vault: config.vaultAddress,
            router: config.routerAddress,
            usdcToken: config.usdcTokenAddress,
          },
          x402: {
            rggPriceAtomic: config.x402RggPriceAtomic.toString(),
            usdcPriceAtomic: config.x402UsdcPriceAtomic.toString(),
            relayerEnabled: Boolean(config.settlementPrivateKey && config.routerAddress),
          },
        },
        config.corsOrigin
      );
      return;
    }

    if (method === 'GET' && url.pathname === '/api/telemetry/snapshot') {
      if (url.searchParams.get('refresh') === '1') {
        await indexer.syncOnce();
      }
      sendJson(res, 200, indexer.getSnapshot(), config.corsOrigin);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/telemetry/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': config.corsOrigin,
      });
      sseClients.add(res);
      res.write(`event: snapshot\ndata: ${JSON.stringify(indexer.getSnapshot())}\n\n`);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/v1/x402/terms') {
      const terms = await agentService.getPaymentTerms('/v1/agent/execute');
      sendJson(res, 200, terms, config.corsOrigin);
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/agent/execute') {
      let body: AgentExecuteRequest = {};
      try {
        body = (await readJsonBody(req)) as AgentExecuteRequest;
      } catch (err) {
        sendJson(
          res,
          400,
          { error: err instanceof Error ? err.message : 'Invalid request body' },
          config.corsOrigin
        );
        return;
      }

      const rawSig = req.headers['payment-signature'];
      const paymentSignature = Array.isArray(rawSig) ? rawSig[0] : rawSig;
      const outcome = await agentService.handleExecute('/v1/agent/execute', paymentSignature, body);
      sendJson(res, outcome.statusCode, outcome.body, config.corsOrigin, outcome.headers);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' }, config.corsOrigin);
  });

  await new Promise<void>((resolveListen) => {
    server.listen(config.port, config.host, () => resolveListen());
  });

  if (options.startPolling !== false) {
    indexer.start();
  }

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : config.port;

  return {
    server,
    indexer,
    agentService,
    port: actualPort,
    close: async () => {
      clearInterval(heartbeat);
      indexer.stop();
      indexer.off('telemetry', onTelemetry);
      indexer.off('snapshot', onSnapshot);
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      });
    },
  };
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const instance = await createRigServer();
  console.log(
    `[the-rig-backend] listening on http://${instance.indexer.config.host}:${instance.port} (${instance.indexer.config.networkLabel})`
  );
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
