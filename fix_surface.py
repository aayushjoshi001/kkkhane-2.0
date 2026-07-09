import os
import re

files = [
    "src/app/page.tsx",
    "src/app/customer-stories/page.tsx",
    "src/app/pricing/page.tsx",
    "src/app/career/page.tsx",
    "src/app/features/page.tsx",
    "src/app/reviews/page.tsx",
    "src/app/about/page.tsx",
    "src/app/contact/page.tsx",
    "src/app/docs/page.tsx"
]

for file in files:
    if os.path.exists(file):
        with open(file, 'r') as f:
            content = f.read()
        
        # Replace min-h-screen bg-surface
        content = content.replace('min-h-screen bg-surface', 'min-h-screen bg-transparent')
        
        # Replace bg-surface inside <section ...> tags
        content = re.sub(r'(<section[^>]*?)\bbg-surface\b', r'\1bg-transparent', content)
        
        with open(file, 'w') as f:
            f.write(content)
        print(f"Updated {file}")

