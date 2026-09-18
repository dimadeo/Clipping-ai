import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  // Local settings are optional; hosting platforms provide environment variables directly.
}

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  creationExecutor: process.env.CREATION_EXECUTOR || 'midjourney',
  adminToken: process.env.DMAS_ADMIN_TOKEN || '',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  shopifySecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  rendererEndpoint: process.env.RENDERER_ENDPOINT || '',
  rendererApiKey: process.env.RENDERER_API_KEY || '',
  storageEndpoint: process.env.STORAGE_ENDPOINT || '',
  deliveryWebhookUrl: process.env.DELIVERY_WEBHOOK_URL || '',
  downloadSecret: process.env.DOWNLOAD_TOKEN_SECRET || 'development-only-change-me',
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 4),
  creativeModel: process.env.CREATIVE_MODEL || 'gpt-5-mini',
  replicateToken: process.env.REPLICATE_API_TOKEN || '',
  upscaleModel: process.env.UPSCALE_MODEL || 'topazlabs/image-upscale',
  upscaleEnhanceModel: process.env.UPSCALE_ENHANCE_MODEL || 'High Fidelity V2',
  rustImageCoreEnabled: process.env.RUST_IMAGE_CORE_ENABLED === 'true',
  rustImageCoreDirectory: process.env.RUST_IMAGE_CORE_DIR || '',
  langsmithProject: process.env.LANGSMITH_PROJECT || 'dark-matters-creative-studio'
};
