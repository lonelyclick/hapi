import { query } from '@anthropic-ai/claude-agent-sdk';

// SDK 可能使用 ANTHROPIC_API_KEY 而不是 ANTHROPIC_AUTH_TOKEN
process.env.ANTHROPIC_API_KEY = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
process.env.ANTHROPIC_BASE_URL = 'http://localhost:4000';
process.env.API_TIMEOUT_MS = '300000';
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

console.log('Process env set:', {
  API_KEY: process.env.ANTHROPIC_API_KEY?.slice(0, 15) + '...',
  BASE_URL: process.env.ANTHROPIC_BASE_URL
});

const q = query({
  prompt: 'Simply say "OK"',
  options: {
    cwd: '/tmp',
    model: 'claude-sonnet-4-5-20250929',
    maxTurns: 1,
    debug: true  // 启用调试模式
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
