# Bakes Wine's Tahoma (LGPL) into small bitmap fonts for the engine's GDI.
# Format per font: height, ascent, then for chars 32..255: advance, width,
# then width*height alpha bytes (one cell per char, full line height).
import sys
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
fonts = []
for path, px in [(src + '/tahoma.ttf', 11), (src + '/tahomabd.ttf', 11), (src + '/tahoma.ttf', 16), (src + '/tahomabd.ttf', 16)]:
    f = ImageFont.truetype(path, px)
    asc, desc = f.getmetrics()
    h = asc + desc
    blob = bytearray([h, asc])
    for c in range(32, 256):
        ch = chr(c)
        adv = max(1, round(f.getlength(ch)))
        l, t, r, b = f.getbbox(ch)
        w = max(adv, r)
        img = Image.new('L', (w, h), 0)
        ImageDraw.Draw(img).text((0, 0), ch, font=f, fill=255)
        blob += bytes([adv, w]) + img.tobytes()
    fonts.append(bytes(blob))
data = bytearray([len(fonts)])
for b in fonts: data += len(b).to_bytes(4, 'little') + b
open(out, 'wb').write(data)
print(len(data))
