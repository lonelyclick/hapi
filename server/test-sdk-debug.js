import { query } from '@anthropic-ai/claude-agent-sdk';

// 尝试两种环境变量名
process.env.ANTHROPIC_API_KEY = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
process.env.ANTHROPIC_AUTH_TOKEN = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
process.env.ANTHROPIC_BASE_URL = 'http://localhost:4000';

console.log('Env:', {
  API_KEY: process.env.ANTHROPIC_API_KEY?.slice(0, 15) + '...',
  AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN?.slice(0, 15) + '...',
  BASE_URL: process.env.ANTHROPIC_BASE_URL
});

let stderrOutput = '';
const q = query({
  prompt: 'Say "OK"',
  options: {
    cwd: '/tmp',
    model: 'claude-sonnet-4-5-20250929',
    maxTurns: 1,
    stderr: (data) => {
      stderrOutput += data;
      process.stderr.write('[STDERR] ' + data);
    },
    env: {
      // 同时设置两个
      ANTHROPIC_API_KEY: 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a',
      ANTHROPIC_AUTH_TOKEN: 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a',
      ANTHROPIC_BASE_URL: 'http://localhost:4000',
    }
  }
});

const timeout = setTimeout(() => {
  console.error('\nTIMEOUT after 15s');
  console.error('STDERR output:', stderrOutput.slice(-500));
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
