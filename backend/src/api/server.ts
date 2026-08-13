import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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

// Render (and any platform PaaS) sits in front of this app as a reverse
// proxy — without this, every request looks like it comes from the proxy's
// own internal IP, which breaks IP-based rate limiting below (everyone would
// share one limit) and any future IP-based logic.
app.set('trust proxy', 1);

// Standard baseline security headers (disables the X-Powered-By fingerprint,
// sets nosniff/frame/HSTS-style headers, etc.) — safe defaults for a JSON API,
// no custom tuning needed since this app serves no HTML pages.
app.use(helmet());

// Frontend routes are now live (browser-called), unlike the webhook. Locked to
// an explicit origin allowlist — FRONTEND_ORIGIN unset falls back to the local
// Vite dev server only, never to a wildcard.
const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(',');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// Blunt, simple rate limit on every real route (registered AFTER /health, so
// uptime pingers are never at risk of tripping it or getting the service
// mistakenly flagged unhealthy). 60 req/min/IP comfortably covers normal
// frontend polling while cutting off a flood/hammering attempt almost
// immediately. The webhook route has its own HMAC-style secret check
// (webhook.ts) — this is a second, cheaper line of defense in front of it,
// not a replacement for that check.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

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

// Same idea for the cron loop (reconciler, epoch heartbeat, vault monitor) —
// normally its own process (npm run start:cron), but INLINE_CRON=true folds
// it into this one so everything fits on a single always-on host.
if (config.inlineCron) {
  void import('../cron/index');
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
