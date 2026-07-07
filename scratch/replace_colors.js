const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
    });
}

const colorMap = {
    // Brand arbitrary
    'text-[#FF7A2E]': 'text-brand-500',
    'bg-[#FF7A2E]': 'bg-brand-500',
    'border-[#FF7A2E]': 'border-brand-500',
    'text-[#FB6303]': 'text-brand-500',
    'bg-[#FB6303]': 'bg-brand-500',
    'border-[#FB6303]': 'border-brand-500',
    'text-[#1A1006]': 'text-ink',
    'bg-[#1A1006]': 'bg-ink',
    'text-[#8C6A50]': 'text-ink-subtle',
    'bg-[#FFF8F3]': 'bg-surface',
    'bg-[#FFF0E6]': 'bg-surface-muted',
    'border-[#EDD9C8]': 'border-hairline',
    'border-[#F5EDE6]': 'border-hairline',

    // Orange Tailwind classes
    'bg-orange-50': 'bg-brand-50',
    'bg-orange-100': 'bg-brand-100',
    'bg-orange-200': 'bg-brand-200',
    'bg-orange-300': 'bg-brand-300',
    'bg-orange-400': 'bg-brand-400',
    'bg-orange-500': 'bg-brand-500',
    'bg-orange-600': 'bg-brand-600',
    'text-orange-500': 'text-brand-500',
    'text-orange-600': 'text-brand-600',
    'border-orange-200': 'border-brand-200',
    'border-orange-500': 'border-brand-500',

    // Gray Tailwind classes
    'bg-gray-50': 'bg-surface-muted',
    'bg-gray-100': 'bg-surface-muted',
    'bg-gray-200': 'bg-surface-muted', // bg-gray-200 is often a subtle background, bg-border is usually only for borders. Let's use surface-muted.
    'bg-gray-300': 'bg-border',
    'bg-gray-900': 'bg-ink',
    
    'text-gray-400': 'text-ink-subtle',
    'text-gray-500': 'text-ink-subtle',
    'text-gray-600': 'text-ink-muted',
    'text-gray-700': 'text-ink-muted',
    'text-gray-800': 'text-ink',
    'text-gray-900': 'text-ink',
    'text-gray-950': 'text-ink',
    
    'border-gray-100': 'border-hairline',
    'border-gray-200': 'border-hairline-strong',
    'border-gray-300': 'border-hairline-strong',

    'bg-white': 'bg-surface'
};

walkDir('./src', (filePath) => {
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const [key, value] of Object.entries(colorMap)) {
        // We use regex to ensure we only replace full words for the standard tailwind classes
        // For brackets, \b doesn't work, so we just use string replacement.
        if (key.includes('[')) {
            content = content.split(key).join(value);
        } else {
            // Negative lookahead/behind to prevent matching text-gray-5000 or my-text-gray-500
            const regex = new RegExp(`(?<![a-zA-Z0-9-])` + key + `(?![a-zA-Z0-9-])`, 'g');
            content = content.replace(regex, value);
        }
    }

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    }
});
