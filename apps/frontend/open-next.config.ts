import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Dynamic routes remain uncached; generated pages are read from this deployment's assets.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
