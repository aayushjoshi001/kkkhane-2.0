const fs = require('fs');
const logPath = 'C:\\Users\\ACER\\.gemini\\antigravity\\brain\\af2a20f7-44a0-4c7c-8b7c-1b29c527fa3a\\.system_generated\\tasks\\task-271.log';

try {
    const log = fs.readFileSync(logPath, 'utf8');
    const lines = log.split('\n');
    console.log('Search results:');
    for (const line of lines) {
        if (line.includes('SERVER-SIDE') || line.includes('waiterSessionEnabled')) {
            console.log(line);
        }
    }
} catch (e) {
    console.error(e);
}
