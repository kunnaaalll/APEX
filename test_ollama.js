const ollama = require('./llm/ollama');

const test_prompt = "Perform a quick SMC analysis on EURUSD. Market is bullish on M15, price just tapped into a 1-hour Order Block at 1.0850. Provide a JSON response with 'direction', 'confidence', and 'reasoning'.";

console.log('Testing Ollama with model:', ollama.model);
console.log('--- Request ---');
console.log(test_prompt);

ollama.analyze(test_prompt).then(response => {
    console.log('\n--- Response ---');
    console.log(JSON.stringify(response, null, 2));
}).catch(err => {
    console.error('Test Failed:', err);
});
