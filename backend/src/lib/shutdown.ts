import { prisma } from './db';
import { redisConnection } from './redis';

type ShutdownFn = () => Promise<unknown> | unknown;

const hooks: { name: string; fn: ShutdownFn }[] = [];

let installed = false;
let shuttingDown = false;

/**
 * Register cleanup work to run on SIGINT/SIGTERM (Ctrl+C, redeploys).
 * Hooks run in reverse registration order; Prisma + Redis always close last.
 * Prevents killing the process mid-broadcast (which strands orders in limbo).
 */
export function onShutdown(name: string, fn: ShutdownFn): void {
  
  hooks.push({ name, fn });

  if (installed) return;
  installed = true;
  
  // Signal Interrupt & Signal Terminate
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

}

async function shutdown(signal: string): Promise<void> {

  if (shuttingDown) return;
  shuttingDown = true;
  
  console.log(`\n[shutdown] ${signal} received — draining in-flight work (max 30s)...`);

  const force = setTimeout(() => {
    console.error('[shutdown] Timed out after 30s — forcing exit.');
    process.exit(1);
  }, 30_000);

  for (const hook of [...hooks].reverse()) {
    try {
      await hook.fn();
      console.log(`[shutdown] ${hook.name} closed.`);
    } catch (err) {
      console.error(`[shutdown] ${hook.name} failed to close:`, err);
    }
  }

  try { await prisma.$disconnect(); } catch { /* already gone */ }
  try { await redisConnection.quit(); } catch { /* already gone */ }

  clearTimeout(force);
  console.log('[shutdown] Clean exit.');
  process.exit(0);
}
