import { query } from '@anthropic-ai/claude-agent-sdk';

// 直接设置进程环境变量（不是通过 env 选项）
process.env.ANTHROPIC_AUTH_TOKEN = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
process.env.ANTHROPIC_BASE_URL = 'http://localhost:4000';
process.env.API_TIMEOUT_MS = '300000';
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

console.log('Process env set:', {
  AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN?.slice(0, 15) + '...',
  BASE_URL: process.env.ANTHROPIC_BASE_URL
});

const q = query({
  prompt: 'Simply say "OK"',
  options: {
    cwd: '/tmp',
    model: 'claude-sonnet-4-5-20250929',
    maxTurns: 1
  }
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT after 10s');
  process.exit(1);
}, 10000);

(async () => {
  for await (const message of q) {
    console.log('MSG:', message.type);
    if (message.type === 'result') {
      clearTimeout(timeout);
      console.log('SUCCESS!');
      process.exit(0);
    }
  }
})();
