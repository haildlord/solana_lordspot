/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HELIUS_API_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LORDSPOT_PROGRAM_ID: string;
  readonly VITE_USDC_MINT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
