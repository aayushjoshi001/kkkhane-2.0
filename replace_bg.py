import os
import glob

files = glob.glob("src/**/*.tsx", recursive=True) + glob.glob("src/**/*.css", recursive=True)
for file in files:
    with open(file, 'r') as f:
        content = f.read()
    changed = False
    if 'bg-[#FAFAF8]' in content:
        content = content.replace('bg-[#FAFAF8]', 'bg-[#f6eee2]')
        changed = True
    if '--bg:            #FDFBF7;' in content:
        content = content.replace('--bg:            #FDFBF7;', '--bg:            #f6eee2;')
        changed = True
    if '--surface-muted: #F4F1EB;' in content:
        content = content.replace('--surface-muted: #F4F1EB;', '--surface-muted: #f5ede1;')
        changed = True
        
    if changed:
        with open(file, 'w') as f:
            f.write(content)
        print(f"Updated {file}")

