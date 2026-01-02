// Server-only bootstrap - minimal entry point for hapi-server executable
process.env.DEV = 'false';

import('../../server/src/index').catch((error) => {
  console.error('Error starting server:', error instanceof Error ? error.message : error);
  if (process.env.DEBUG) {
    console.error(error);
  }
  process.exit(1);
});

export {};
