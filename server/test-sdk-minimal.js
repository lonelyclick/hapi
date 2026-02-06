import { query } from '@anthropic-ai/claude-agent-sdk';

const q = query({
  prompt: 'Hi',
  options: {
    cwd: '/tmp',
    model: 'claude-sonnet-4-5-20250929',
    maxTurns: 1
  }
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT after 5s');
  process.exit(1);
}, 5000);

(async () => {
  for await (const message of q) {
    console.log('MSG:', message.type);
    if (message.type === 'result') {
      clearTimeout(timeout);
      process.exit(0);
    }
  }
})();
