import { BrainSdkService, buildBrainSystemPrompt, buildReviewPrompt } from './src/brain/index.ts';
import { BrainStore } from './src/brain/store.ts';
import { PostgresStore } from './src/store/postgres.ts';

async function testBrainAPI() {
  console.log('=== 测试 HAPI Brain SDK API ===\n');

  // 创建数据库连接
  const pgConfig = {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'guang',
    database: process.env.PG_DATABASE || 'hapi',
  };

  const pgStore = await PostgresStore.create(pgConfig);
  const brainStore = new BrainStore(pgStore.getPool());
  const brainSdkService = new BrainSdkService(brainStore);

  // 测试 Brain SDK 审查
  const testSessionId = 'test-session-' + Date.now();
  const testProjectPath = '/home/guang/happy/claude-sdk-research';

  console.log('测试参数:');
  console.log('  项目路径:', testProjectPath);
  console.log('  测试 Session ID:', testSessionId);
  console.log('');

  const systemPrompt = buildBrainSystemPrompt();
  const reviewPrompt = buildReviewPrompt(
    '测试项目：claude-sdk-research',
    '用户询问了如何使用 Claude Agent SDK'
  );

  console.log('开始执行 Brain 审查...\n');

  const result = await brainSdkService.executeBrainReview(
    testSessionId,
    reviewPrompt,
    {
      cwd: testProjectPath,
      systemPrompt,
      maxTurns: 10,
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Bash', 'Edit', 'Write'],
      permissionMode: 'plan',
      pathToClaudeCodeExecutable: '/home/guang/softwares/hapi/server/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    },
    {
      onProgress: (type, data) => {
        console.log(`[进度] ${type}`, data ? JSON.stringify(data).substring(0, 100) : '');
      }
    }
  );

  console.log('\n=== 审查结果 ===');
  console.log('状态:', result.status);
  console.log('轮次:', result.numTurns);
  console.log('耗时:', `${result.durationMs}ms`);
  console.log('花费:', `$${result.costUsd?.toFixed(4) || 'N/A'}`);

  if (result.error) {
    console.log('错误:', result.error);
  }

  if (result.output) {
    console.log('\n输出 (前500字符):');
    console.log(result.output.substring(0, 500) + '...');
  }

  await pgStore.close();

  return result.status === 'completed';
}

testBrainAPI().then(success => {
  console.log('\n=== 测试', success ? '成功' : '失败', '===');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
