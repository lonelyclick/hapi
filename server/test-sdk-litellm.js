import { query } from '@anthropic-ai/claude-agent-sdk';

async function test() {
  console.log('=== 测试 SDK with litellm ===\n');

  const q = query({
    prompt: 'Hi',
    options: {
      cwd: '/tmp',
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 1
    }
  });

  const timeout = setTimeout(() => {
    console.error('TIMEOUT after 15s');
    process.exit(1);
  }, 15000);

  let success = false;
  for await (const message of q) {
    console.log('[消息]', message.type);
    if (message.type === 'assistant') {
      const msg = message as any;
      const content = msg.message?.content?.find((c: any) => c.type === 'text')?.text;
      console.log('[内容]', content?.substring(0, 100) || '无');
    }
    if (message.type === 'result') {
      success = (message as any).subtype === 'success';
      console.log('[结果]', (message as any).subtype, '错误:', (message as any).error);
      clearTimeout(timeout);
    }
  }
  
  console.log('\n测试结果:', success ? '成功' : '失败');
  return success;
}

test().then(success => process.exit(success ? 0 : 1));
