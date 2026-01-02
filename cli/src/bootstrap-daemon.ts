// Daemon-only bootstrap - minimal entry point for hapi-daemon executable
process.env.DEV = 'false';

import { initializeToken } from './ui/tokenInit';
import { startDaemon } from './daemon/run';

(async () => {
  try {
    await initializeToken();
    await startDaemon();
    process.exit(0);
  } catch (error) {
    console.error('Error starting daemon:', error instanceof Error ? error.message : error);
    if (process.env.DEBUG) {
      console.error(error);
    }
    process.exit(1);
  }
})();

export {};
