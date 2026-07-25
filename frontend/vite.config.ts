import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // @coral-xyz/anchor and @solana/web3.js expect Node's Buffer/global to
    // exist. Vite 8's Rolldown bundler externalizes Node builtins by default
    // (the old resolve.alias + esbuildOptions.define trick no longer works),
    // so this plugin is the actual fix, not a nice-to-have.
    nodePolyfills({
      include: ['buffer'],
      globals: {
        Buffer: true,
        global: true,
        process: false,
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
