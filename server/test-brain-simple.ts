import { query } from '@anthropic-ai/claude-agent-sdk';

console.log('=== 简单 SDK 测试 ===\n');

const litellmApiKey = process.env.LITELLM_API_KEY || 'sk-litellm-41e2a2d4d101255ea6e76fd59f96548a';
const litellmBaseUrl = process.env.LITELLM_BASE_URL || 'http://localhost:4000';

console.log('环境变量:');
console.log('  ANTHROPIC_API_KEY:', litellmApiKey.substring(0, 20) + '...');
console.log('  ANTHROPIC_BASE_URL:', litellmBaseUrl);
console.log('');

let hasSystemInit = false;
let hasAssistant = false;
let hasResult = false;

const timeout = setTimeout(() => {
  console.error('\n超时！状态:');
  console.error('  system init:', hasSystemInit);
  console.error('  assistant:', hasAssistant);
  console.error('  result:', hasResult);
  process.exit(1);
}, 30000);

try {
  const q = query({
    prompt: '简单地说"OK"即可。',
    options: {
      cwd: '/tmp',
      model: 'glm-4.7',
      maxTurns: 1,
      permissionMode: 'acceptEdits',
      env: {
        ANTHROPIC_API_KEY: litellmApiKey,
        ANTHROPIC_BASE_URL: litellmBaseUrl,
      }
    }
  });

  console.log('开始监听消息...\n');

  for await (const message of q) {
    console.log(`[消息] type: ${message.type}, subtype: ${message.subtype || 'N/A'}`);

    if (message.type === 'system' && message.subtype === 'init') {
      hasSystemInit = true;
    }

    if (message.type === 'assistant') {
      hasAssistant = true;
      const msg = message as { message?: { content?: Array<{ type: string; text?: string }> } };
      const textBlocks = msg.message?.content?.filter(b => b.type === 'text');
      if (textBlocks && textBlocks.length > 0) {
        console.log(`  内容: ${textBlocks[0].text?.substring(0, 100)}...`);
      }
    }

    if (message.type === 'result') {
      hasResult = true;
      const res = message as { subtype: string; result?: string };
      console.log(`  结果: ${res.subtype}`);
      clearTimeout(timeout);
      console.log('\n=== 测试成功 ===');
      process.exit(0);
    }
  }
} catch (err) {
  console.error('错误:', err);
  clearTimeout(timeout);
  process.exit(1);
}
