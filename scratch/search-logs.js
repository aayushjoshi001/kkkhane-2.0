const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\ACER\\.gemini\\antigravity\\brain\\af2a20f7-44a0-4c7c-8b7c-1b29c527fa3a\\.system_generated\\tasks\\task-144.log';

try {
    if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        console.log('Lines in log matching "waiterSessionEnabled" or "rendering":');
        for (const line of lines) {
            if (line.includes('waiterSessionEnabled') || line.includes('rendering')) {
                console.log(line);
            }
        }
    } else {
        console.log('Log file does not exist at:', logPath);
    }
} catch (e) {
    console.error('Error:', e);
}
