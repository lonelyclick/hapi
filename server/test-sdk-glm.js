import { query } from '@anthropic-ai/claude-agent-sdk';

process.env.ANTHROPIC_API_KEY = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
process.env.ANTHROPIC_BASE_URL = 'http://localhost:4000';

console.log('Testing with glm-4.7 model...');

const q = query({
  prompt: 'Simply say "OK"',
  options: {
    cwd: '/tmp',
    model: 'glm-4.7',
    maxTurns: 1,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a',
      ANTHROPIC_BASE_URL: 'http://localhost:4000',
    }
  }
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT after 15s');
  process.exit(1);
}, 15000);

(async () => {
  for await (const message of q) {
    console.log('MSG:', message.type, message.subtype || '');
    if (message.type === 'result') {
      clearTimeout(timeout);
      console.log('SUCCESS!');
      process.exit(0);
    }
  }
})();
