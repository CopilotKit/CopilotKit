/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_MINTLIFY_ASSISTANT_KEY?: string;
  readonly PUBLIC_MINTLIFY_SUBDOMAIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
