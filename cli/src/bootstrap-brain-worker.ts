// Brain review worker bootstrap - entry point for hapi-brain-worker executable
process.env.DEV = 'false';

import('../../server/src/brain/worker/brain-review-worker').catch((error) => {
  console.error('[BrainWorker] Fatal error:', error instanceof Error ? error.message : error);
  if (process.env.DEBUG) {
    console.error(error);
  }
  process.exit(1);
});

export {};
