import { query } from '@anthropic-ai/claude-agent-sdk';

async function test() {
  console.log('=== 测试 SDK with ANTHROPIC_AUTH_TOKEN ===\n');

  const q = query({
    prompt: 'Hi',
    options: {
      cwd: '/tmp',
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 1,
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a',
        ANTHROPIC_BASE_URL: 'http://localhost:4000'
      }
    }
  });

  const timeout = setTimeout(() => {
    console.error('TIMEOUT');
    process.exit(1);
  }, 20000);

  for await (const message of q) {
    console.log('[MSG]', message.type);
    if (message.type === 'assistant') {
      const msg = message as any;
      const content = msg.message?.content?.find((c: any) => c.type === 'text')?.text;
      console.log('[内容]', content?.substring(0, 100) || '无');
    }
    if (message.type === 'result') {
      const result = message as any;
      console.log('[结果]', result.subtype);
      clearTimeout(timeout);
      process.exit(result.subtype === 'success' ? 0 : 1);
    }
  }
}

test();
