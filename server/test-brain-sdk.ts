import { query } from '@anthropic-ai/claude-agent-sdk';

async function testBrainSDK() {
  console.log('=== 测试 Claude Agent SDK ===\n');

  const q = query({
    prompt: '你好，请简单介绍一下你自己，用中文回复',
    options: {
      cwd: '/home/guang/happy/claude-sdk-research',
      model: 'claude-sonnet-4-5-20250929',
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Bash', 'Edit', 'Write'],
      permissionMode: 'plan',
      maxTurns: 5,
      pathToClaudeCodeExecutable: '/home/guang/softwares/hapi/server/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    },
  });

  try {
    for await (const message of q) {
      switch (message.type) {
        case 'system':
          console.log('[系统]', message.subtype);
          break;
        case 'assistant':
          const content = message.message?.content?.find((c: any) => c.type === 'text')?.text;
          if (content) {
            console.log('[助手]', content.substring(0, 200) + (content.length > 200 ? '...' : ''));
          }
          break;
        case 'tool_progress':
          console.log('[工具]', message.tool_name);
          break;
        case 'result':
          console.log('\n[结果]');
          console.log('  状态:', message.subtype);
          console.log('  轮次:', message.num_turns);
          console.log('  耗时:', `${message.duration_ms}ms`);
          console.log('  花费:', `$${message.total_cost_usd?.toFixed(4) || 'N/A'}`);
          if (message.is_error) {
            console.error('  错误:', message.errors);
          }
          return message.subtype === 'success';
      }
    }
  } catch (error) {
    console.error('[错误]', error);
    return false;
  }
}

testBrainSDK().then(success => {
  console.log('\n=== 测试完成，结果:', success ? '成功' : '失败', '===');
  process.exit(success ? 0 : 1);
});
