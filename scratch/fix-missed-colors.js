const fs = require('fs');
const path = require('path');

const colorMap = {
    '#ff5a00': 'brand-500',
    '#ff4500': 'brand-600',
    '#e04f00': 'brand-700',
    '#c4a882': 'brand-200',
    '#7a3300': 'brand-900',
    '#ffeae0': 'brand-50',
    '#d68e65': 'brand-400',
    '#ea580c': 'brand-600',
};

function replaceTailwindClasses(content) {
    let newContent = content;
    for (const [hex, variable] of Object.entries(colorMap)) {
        const textRegex = new RegExp(`text-\\[${hex}\\]`, 'gi');
        const bgRegex = new RegExp(`bg-\\[${hex}\\]`, 'gi');
        const borderRegex = new RegExp(`border-\\[${hex}\\]`, 'gi');
        const fillRegex = new RegExp(`fill-\\[${hex}\\]`, 'gi');
        const ringRegex = new RegExp(`ring-\\[${hex}\\]`, 'gi');
        const fromRegex = new RegExp(`from-\\[${hex}\\]`, 'gi');
        const toRegex = new RegExp(`to-\\[${hex}\\]`, 'gi');
        
        const bgAlphaRegex = new RegExp(`bg-\\[${hex}\\]\\/(\\d+)`, 'gi');
        const textAlphaRegex = new RegExp(`text-\\[${hex}\\]\\/(\\d+)`, 'gi');
        const borderAlphaRegex = new RegExp(`border-\\[${hex}\\]\\/(\\d+)`, 'gi');
        
        newContent = newContent
            .replace(bgAlphaRegex, `bg-${variable}/$1`)
            .replace(textAlphaRegex, `text-${variable}/$1`)
            .replace(borderAlphaRegex, `border-${variable}/$1`)
            .replace(textRegex, `text-${variable}`)
            .replace(bgRegex, `bg-${variable}`)
            .replace(borderRegex, `border-${variable}`)
            .replace(fillRegex, `fill-${variable}`)
            .replace(ringRegex, `ring-${variable}`)
            .replace(fromRegex, `from-${variable}`)
            .replace(toRegex, `to-${variable}`);
    }
    return newContent;
}

function walkSync(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filepath = path.join(dir, file);
        const stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            walkSync(filepath, callback);
        } else if (stats.isFile() && filepath.endsWith('.tsx')) {
            callback(filepath);
        }
    }
}

let changedFiles = 0;
walkSync('src', (filepath) => {
    const content = fs.readFileSync(filepath, 'utf8');
    const newContent = replaceTailwindClasses(content);
    if (content !== newContent) {
        fs.writeFileSync(filepath, newContent, 'utf8');
        changedFiles++;
    }
});
console.log(`Updated ${changedFiles} files with missed colors.`);
