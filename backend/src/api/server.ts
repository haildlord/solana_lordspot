import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { config } from '../lib/config';
import { onShutdown } from '../lib/shutdown';
import webhookRouter from '../routes/webhook';
import claimsRouter from '../routes/claims';
import protocolRouter from '../routes/protocol';
// import ordersRouter from '../routes/orders';
// import stateRouter from '../routes/state';
// import quoteRouter from '../routes/quote';

// # Workers
import { megapotService } from '../services/megapotService';

const app = express();

// Frontend routes are now live (browser-called), unlike the webhook. Locked to
// an explicit origin allowlist — FRONTEND_ORIGIN unset falls back to the local
// Vite dev server only, never to a wildcard.
const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

app.use('/webhooks', webhookRouter);
app.use('/v1/claims', claimsRouter);
app.use('/v1/protocol', protocolRouter);
// app.use('/v1/orders', ordersRouter);
// app.use('/v1/state', stateRouter);
// app.use('/v1/quote', quoteRouter);

// BullMQ consumers run inside this process unless explicitly disabled.
// Production should run them as their own process (npm run start:worker)
// and start the API with INLINE_WORKERS=false for crash isolation + scaling.
if (config.inlineWorkers !== false) {
  void import('../workers/index');
}

const server = app.listen(config.port, async () => {
  console.log(`[api] Listening on :${config.port}`);
  await megapotService.startSync();
});

onShutdown('http-server', () =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
  })
);
