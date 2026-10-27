# Fondo de la ventana del instalador de Mac (.dmg): 600×400 puntos, con versión retina.
# Iconos de Cabina y de Aplicaciones en (160, 215) y (440, 215); flecha entre los dos y texto.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import sys
FONT = sys.argv[1] if len(sys.argv) > 1 else 'Inter.ttf'
def font(px, w):
    f = ImageFont.truetype(FONT, px); f.set_variation_by_name(w); return f
def draw(k):
    W, H = 600 * k, 400 * k
    im = Image.new('RGB', (W, H))
    top, bot = (24, 27, 36), (9, 10, 13)
    px = im.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(W): px[x, y] = c
    # brillo azul tenue detrás de la flecha
    g = Image.new('L', (W, H), 0)
    ImageDraw.Draw(g).ellipse((150 * k, 120 * k, 450 * k, 300 * k), fill=70)
    g = g.filter(ImageFilter.GaussianBlur(70 * k))
    im = Image.composite(Image.new('RGB', (W, H), (33, 58, 206)), im, g)
    d = ImageDraw.Draw(im)
    # Título
    d.text((W / 2, 62 * k), 'Arrastra Cabina a Aplicaciones', font=font(22 * k, b'SemiBold'), fill=(235, 232, 227), anchor='mm')
    d.text((W / 2, 92 * k), 'y ábrela desde allí: así se actualiza sola.', font=font(13 * k, b'Regular'), fill=(141, 146, 154), anchor='mm')
    # Flecha
    y = 215 * k; x0, x1 = 238 * k, 352 * k
    d.line((x0, y, x1 - 10 * k, y), fill=(74, 102, 240), width=round(5 * k))
    d.polygon([(x1, y), (x1 - 18 * k, y - 12 * k), (x1 - 18 * k, y + 12 * k)], fill=(74, 102, 240))
    for x in (x0,): d.ellipse((x - 2.5 * k, y - 2.5 * k, x + 2.5 * k, y + 2.5 * k), fill=(74, 102, 240))
    # Ayuda para la primera vez (la app no está firmada con Apple)
    d.text((W / 2, 336 * k), 'Si macOS no la deja abrir la primera vez:', font=font(12 * k, b'Medium'), fill=(141, 146, 154), anchor='mm')
    d.text((W / 2, 356 * k), 'Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente', font=font(12 * k, b'Regular'), fill=(141, 146, 154), anchor='mm')
    return im
draw(1).save('background.png'); draw(2).save('background@2x.png')
