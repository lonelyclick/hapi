import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('=== SDK stdin 模式测试 ===\n');

const litellmApiKey = 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
const litellmBaseUrl = 'http://localhost:4000';

console.log('设置进程环境变量...');
process.env.ANTHROPIC_API_KEY = litellmApiKey;
process.env.ANTHROPIC_BASE_URL = litellmBaseUrl;
console.log('  ANTHROPIC_API_KEY =', litellmApiKey.substring(0, 15) + '...');
console.log('  ANTHROPIC_BASE_URL =', litellmBaseUrl);
console.log();

const timeout = setTimeout(() => {
  console.error('\n超时！');
  process.exit(1);
}, 15000);

let msgCount = 0;

try {
  console.log('创建 SDK query...\n');
  const q = query({
    prompt: 'Say "OK"',
    options: {
      cwd: '/tmp',
      model: 'glm-4.7',
      maxTurns: 1
    }
  });

  for await (const message of q) {
    msgCount++;
    console.log(`[${msgCount}] type=${message.type} subtype=${message.subtype || '-'}`);
    if (message.type === 'result') {
      clearTimeout(timeout);
      console.log('\n成功！退出');
      process.exit(0);
    }
  }
} catch (err) {
  console.error('错误:', err);
  clearTimeout(timeout);
  process.exit(1);
}
