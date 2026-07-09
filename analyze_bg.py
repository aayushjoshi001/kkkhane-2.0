from PIL import Image

img = Image.open("/home/mac/Pictures/Screenshot from 2026-07-09 20-34-04.png")
img = img.resize((150, 150))
img = img.convert('RGB')
colors = img.getcolors(maxcolors=1000000)
sorted_colors = sorted(colors, key=lambda x: x[0], reverse=True)
print("Top 10 Colors:")
for count, color in sorted_colors[:10]:
    print(f"Color: #{color[0]:02x}{color[1]:02x}{color[2]:02x}, Count: {count}")

