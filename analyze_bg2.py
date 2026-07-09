from PIL import Image

try:
    img = Image.open("/home/mac/Pictures/Screenshot from 2026-07-09 20-53-41.png")
    img = img.resize((150, 150))
    img = img.convert('RGB')
    colors = img.getcolors(maxcolors=1000000)
    sorted_colors = sorted(colors, key=lambda x: x[0], reverse=True)
    print("Top 5 Colors in new screenshot:")
    for count, color in sorted_colors[:5]:
        print(f"Color: #{color[0]:02x}{color[1]:02x}{color[2]:02x}, Count: {count}")
except Exception as e:
    print(str(e))
