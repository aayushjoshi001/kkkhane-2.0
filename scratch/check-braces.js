const fs = require('fs');
const path = 'src/app/(admin)/admin/manual-entry/ManualEntryClient.tsx';
const s = fs.readFileSync(path, 'utf8');
console.log('curly open', (s.match(/{/g) || []).length, 'close', (s.match(/}/g) || []).length);
console.log('paren open', (s.match(/\(/g) || []).length, 'close', (s.match(/\)/g) || []).length);
