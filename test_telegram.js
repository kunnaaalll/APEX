const telegram = require('./notify/telegram');

async function testNotification() {
    console.log('Testing Telegram Notification...');
    const testDecision = {
        direction: 'BUY',
        entry: 1.0850,
        sl: 1.0820,
        tp: 1.0900,
        rationale: 'Testing APEX Alert System. EURUSD price just tapped into 1-hour Order Block.'
    };

    try {
        await telegram.notifySetup('EURUSD', testDecision);
        console.log('✅ Test Message Sent! Check your Telegram.');
    } catch (err) {
        console.error('❌ Test Failed:', err.message);
    }
}

testNotification();
