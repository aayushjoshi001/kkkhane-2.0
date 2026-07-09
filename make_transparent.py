import os
import glob

files = glob.glob("src/app/**/*.tsx", recursive=True) + glob.glob("src/components/**/*.tsx", recursive=True)
for file in files:
    with open(file, 'r') as f:
        content = f.read()
    if 'bg-[#f6eee2]' in content:
        content = content.replace('bg-[#f6eee2]', 'bg-transparent')
        with open(file, 'w') as f:
            f.write(content)
        print(f"Updated {file}")
