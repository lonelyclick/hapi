#!/usr/bin/env bun

// Session信息从日志中获取
const SESSION_ID = '4f19b2bc-d386-4095-9db6-44087cc55d22';  // 从日志中获取的活跃session
const BASE_URL = 'http://127.0.0.1:3006';
const AUTH_TOKEN = 'rDhnX0JCPIki0s6t1kNsHJkSLCvpAEt3wNCb_dkEyOc'; // 从日志中获取的token

async function sendTestMessage(content) {
    try {
        console.log(`📤 发送测试消息: "${content}"`);
        
        const response = await axios.post(
            `${BASE_URL}/api/sessions/${SESSION_ID}/messages`,
            { content },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                }
            }
        );
        
        console.log(`✅ 消息发送成功，ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        console.error('❌ 发送消息失败:', error.response?.data || error.message);
        throw error;
    }
}

async function sendMultipleMessages() {
    console.log('🧪 开始发送测试消息...');
    
    const messages = [
        '第一条测试消息',
        '第二条测试消息', 
        '第三条测试消息',
        '第四条测试消息',
        '第五条测试消息'
    ];
    
    for (let i = 0; i < messages.length; i++) {
        await sendTestMessage(`${messages[i]} (${i + 1}/5)`);
        // 等待一小段时间，确保消息有时间差
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('🎉 所有测试消息发送完成！');
    console.log('📱 请在浏览器中查看消息顺序是否正确');
}

sendMultipleMessages().catch(console.error);