import { query } from '@anthropic-ai/claude-agent-sdk';

async function testBrainSimple() {
  console.log('=== 简单测试 SDK ===\n');

  const q = query({
    prompt: '用一句话介绍你自己',
    options: {
      cwd: '/home/guang/happy/claude-sdk-research',
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 3,
      // 不指定 pathToClaudeCodeExecutable，让 SDK 自己找
    },
  });

  try {
    for await (const message of q) {
      console.log('[消息类型]', message.type);
      if (message.type === 'result') {
        console.log('[结果]', message.subtype);
        console.log('[输出]', (message as any).result?.substring(0, 200) || '无');
        return message.subtype === 'success';
      }
    }
  } catch (error) {
    console.error('[错误]', error);
    return false;
  }
}

testBrainSimple().then(success => {
  console.log('\n测试结果:', success);
  process.exit(success ? 0 : 1);
});
