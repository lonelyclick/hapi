import { executeBrainQuery } from './src/brain/sdkAdapter.ts';
import { buildBrainSystemPrompt, buildReviewPrompt } from './src/brain/brainSdkService.ts';

async function testBrainDirect() {
  console.log('=== 直接测试 Brain SDK 适配器 ===\n');

  const testProjectPath = '/home/guang/happy/claude-sdk-research';

  console.log('测试参数:');
  console.log('  项目路径:', testProjectPath);
  console.log('');

  const systemPrompt = buildBrainSystemPrompt();
  const reviewPrompt = buildReviewPrompt(
    '测试项目：claude-sdk-research',
    '用户询问了如何使用 Claude Agent SDK'
  );

  console.log('开始执行 Brain 审查...\n');

  let success = false;
  let output = '';

  await executeBrainQuery(
    reviewPrompt,
    {
      cwd: testProjectPath,
      systemPrompt,
      maxTurns: 10,
      // 允许读取工具，自动批准
      allowedTools: ['Read', 'Grep', 'Glob'],
      permissionMode: 'acceptEdits',  // 使用 acceptEdits 模式，允许工具自动执行
      pathToClaudeCodeExecutable: '/home/guang/softwares/hapi/server/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    },
    {
      onSystemMessage: (msg) => {
        console.log(`[系统] 类型: ${msg.type}, 子类型: ${msg.subtype || 'N/A'}`);
      },
      onProgress: (type, data) => {
        console.log(`[进度] ${type}`, data ? JSON.stringify(data).substring(0, 80) : '');
      },
      onAssistantMessage: (msg) => {
        console.log(`[AI] 消息片段 (${msg.content.length} 字符)`);
        output += msg.content + '\n\n';
      },
      onToolUse: (toolName, input) => {
        console.log(`[工具] ${toolName}`, JSON.stringify(input).substring(0, 100));
      },
      onResult: (result) => {
        console.log('\n=== 审查结果 ===');
        console.log('成功:', result.success);
        console.log('轮次:', result.numTurns);
        console.log('耗时:', `${result.durationMs}ms`);
        console.log('花费:', `$${result.totalCostUsd?.toFixed(4) || 'N/A'}`);
        if (result.error) {
          console.log('错误:', result.error);
        }
        success = result.success;
      }
    }
  );

  if (output) {
    console.log('\n输出 (前500字符):');
    console.log(output.substring(0, 500) + '...');
  }

  return success;
}

testBrainDirect().then(success => {
  console.log('\n=== 测试', success ? '成功' : '失败', '===');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
