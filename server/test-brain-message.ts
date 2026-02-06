import { executeBrainQuery } from './src/brain/sdkAdapter.ts';
import { buildBrainSystemPrompt, buildReviewPrompt } from './src/brain/brainSdkService.ts';

// 复制 buildReviewResultMessage 逻辑进行测试
function buildReviewResultMessage(
    suggestions: Array<{ type: string; severity: string; title: string; detail: string }>,
    summary?: string
): string {
    const lines: string[] = [
        '## 🔍 Brain 代码审查结果\n'
    ]

    if (summary) {
        lines.push(`**总体评价:** ${summary}\n`)
    }

    const bySeverity: Record<string, Array<typeof suggestions[0]>> = {
        high: [],
        medium: [],
        low: []
    }

    for (const s of suggestions) {
        if (bySeverity[s.severity]) {
            bySeverity[s.severity].push(s)
        }
    }

    if (bySeverity.high.length > 0) {
        lines.push('### 🔴 高优先级问题')
        for (const s of bySeverity.high) {
            lines.push(`**${s.type.toUpperCase()}** - ${s.title}`)
            lines.push(`> ${s.detail}\n`)
        }
    }

    if (bySeverity.medium.length > 0) {
        lines.push('### 🟡 中优先级问题')
        for (const s of bySeverity.medium) {
            lines.push(`**${s.type.toUpperCase()}** - ${s.title}`)
            lines.push(`> ${s.detail}\n`)
        }
    }

    if (bySeverity.low.length > 0) {
        lines.push('### 🟢 低优先级建议')
        for (const s of bySeverity.low) {
            lines.push(`**${s.type.toUpperCase()}** - ${s.title}`)
            lines.push(`> ${s.detail}\n`)
        }
    }

    lines.push(`---`)
    lines.push(`📊 **统计:** ${suggestions.length} 条建议 (${bySeverity.high.length} 高 / ${bySeverity.medium.length} 中 / ${bySeverity.low.length} 低)`)

    return lines.join('\n')
}

// 模拟解析 SDK 输出并转换消息
function parseAndConvert(sdkOutput: string): string | null {
    try {
        // 找到所有 ```json 代码块，取最后一个（通常是最终结果）
        const jsonBlocks = [...sdkOutput.matchAll(/```json\s*([\s\S]*?)\s*```/g)]
        if (jsonBlocks.length === 0) {
            console.log('✗ 未找到 JSON 代码块')
            return null
        }

        console.log('找到', jsonBlocks.length, '个 JSON 代码块，使用最后一个')

        const lastBlock = jsonBlocks[jsonBlocks.length - 1]
        let jsonStr = lastBlock[1]

        // 尝试直接解析
        let parsed = null
        try {
            parsed = JSON.parse(jsonStr)
        } catch (e) {
            // 如果解析失败，尝试修复常见问题（如截断的字符串）
            console.log('JSON 解析失败，尝试修复...')

            // 检查是否是被截断的 JSON（缺少闭合括号）
            const openBraces = (jsonStr.match(/\{/g) || []).length
            const closeBraces = (jsonStr.match(/\}/g) || []).length
            const openBrackets = (jsonStr.match(/\[/g) || []).length
            const closeBrackets = (jsonStr.match(/\]/g) || []).length

            // 补齐缺失的括号
            while (closeBrackets < openBrackets) {
                jsonStr += ']'
            }
            while (closeBraces < openBraces) {
                jsonStr += '}'
            }

            try {
                parsed = JSON.parse(jsonStr)
                console.log('✓ 修复后解析成功')
            } catch (e2) {
                console.log('✗ 修复后仍然失败')
                return null
            }
        }

        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
            console.log('✓ 解析到', parsed.suggestions.length, '条建议')
            return buildReviewResultMessage(parsed.suggestions, parsed.summary)
        } else {
            console.log('✗ JSON 格式正确，但没有 suggestions 数组')
        }
    } catch (parseErr) {
        console.error('✗ 解析失败:', parseErr)
    }
    return null
}

async function testMessageConversion() {
    console.log('=== 测试 Brain 消息转换 ===\n');

    const testProjectPath = '/home/guang/happy/claude-sdk-research';

    const systemPrompt = buildBrainSystemPrompt();
    const reviewPrompt = buildReviewPrompt(
        '测试项目：claude-sdk-research',
        '用户询问了如何使用 Claude Agent SDK'
    );

    console.log('开始 SDK 审查...\n');

    let sdkOutput = '';
    let success = false;

    const timeout = setTimeout(() => {
        console.log('\n超时！当前输出长度:', sdkOutput.length);
        process.exit(1);
    }, 60000);

    try {
        await executeBrainQuery(
            reviewPrompt,
            {
                cwd: testProjectPath,
                systemPrompt,
                maxTurns: 20,
                permissionMode: 'acceptEdits',  // 允许工具自动执行
                pathToClaudeCodeExecutable: '/home/guang/softwares/hapi/server/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
            },
            {
                onAssistantMessage: (msg) => {
                    sdkOutput += msg.content + '\n\n';
                },
                onResult: (result) => {
                    if (result.success) {
                        console.log('\n=== SDK 审查完成 ===');
                        console.log('输出长度:', sdkOutput.length, '字符');
                        console.log('轮次:', result.numTurns);
                        console.log('耗时:', `${result.durationMs}ms`);
                        clearTimeout(timeout);
                        success = true;
                    } else {
                        console.error('审查失败:', result.error);
                        clearTimeout(timeout);
                    }
                }
            }
        );
    } catch (err) {
        console.error('执行错误:', err);
        clearTimeout(timeout);
    }

    if (success && sdkOutput) {
        console.log('\n=== 测试消息转换 ===\n');

        const convertedMessage = parseAndConvert(sdkOutput);

        if (convertedMessage) {
            console.log('✓ 转换成功！\n');
            console.log('--- 转换后的消息（前800字符）---');
            console.log(convertedMessage.substring(0, 800) + '...\n');
            console.log('--- 消息结尾 ---');
            console.log(convertedMessage.substring(-200));
            return true;
        } else {
            console.log('✗ 转换失败，显示原始输出（前500字符）:');
            console.log(sdkOutput.substring(0, 500) + '...');
            return false;
        }
    }

    return false;
}

testMessageConversion().then(success => {
    console.log('\n=== 测试', success ? '成功' : '失败', '===');
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error('测试异常:', err);
    process.exit(1);
});
