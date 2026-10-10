/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_SEED_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
