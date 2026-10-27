# Icono de Cabina con acabado de app de Apple: mismo dibujo (dos C enfrentadas y una cápsula dentro),
# con forma de icono de macOS, degradados, resplandor y reflejo. Todo se dibuja a 4x y se reduce.
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math

def lin_grad(N, top, bottom):
    """Degradado vertical RGBA de N×N, fila a fila (sin escalones)."""
    g = Image.new('RGBA', (1, N))
    for y in range(N):
        t = y / (N - 1)
        g.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
    return g.resize((N, N), Image.NEAREST)

def dither(im, amount=2.2):
    """Grano casi invisible para que los degradados oscuros no hagan bandas."""
    n = Image.effect_noise(im.size, 64).point(lambda v: round(128 + (v - 128) * amount / 64))
    r, g, b, a = im.split()
    off = lambda c: ImageChops.add(c, n, 1.0, -128)  # c + ruido - 128, recortando una sola vez
    return Image.merge('RGBA', (off(r), off(g), off(b), a))

def squircle(N, box):
    """Máscara con la forma de los iconos de Apple: lados rectos y esquinas de curvatura continua
    (rectángulo redondeado al 22,4 % suavizado, que reparte la curva como hace Apple)."""
    x0, y0, x1, y1 = box; side = x1 - x0
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=side * 0.235, fill=255)
    return m.filter(ImageFilter.GaussianBlur(side * 0.028)).point(lambda v: 255 if v > 127 else 0).filter(ImageFilter.GaussianBlur(1.2))

def rings_mask(N, cx, cy, w, h, sw, gap):
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    d.rounded_rectangle((x0, y0, x1, y1), radius=h / 2, fill=255)
    d.rounded_rectangle((x0 + sw, y0 + sw, x1 - sw, y1 - sw), radius=h / 2 - sw, fill=0)
    g = w * gap / 2
    d.rectangle((cx - g - sw / 2, 0, cx + g + sw / 2, N), fill=0)
    for sx in (-1, 1):
        for yy in (y0 + sw / 2, y1 - sw / 2):
            x = cx + sx * (g + sw / 2); d.ellipse((x - sw / 2, yy - sw / 2, x + sw / 2, yy + sw / 2), fill=255)
    return m

def pill_mask(N, cx, cy, w, h):
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).rounded_rectangle((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), radius=h / 2, fill=255)
    return m

def paint(base, mask, layer):
    base.alpha_composite(Image.composite(layer, Image.new('RGBA', base.size, (0, 0, 0, 0)), mask))

def mul_alpha(mask, a):
    return mask.point(lambda v: round(v * a))

def icon(size, mac_margin=True):
    S = 4; N = size * S
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    # Rejilla de iconos de macOS: 824/1024 de forma, centrada, con sombra
    # Sin el margen de macOS (web, Windows) se deja un poco de aire para que la forma no quede cortada por los bordes
    k = 824 / 1024 if mac_margin else 0.92
    side = N * k; off = (N - side) / 2
    box = (off, off - (N * 0.006 if mac_margin else 0), off + side, off + side - (N * 0.006 if mac_margin else 0))
    sq = squircle(N, box)
    if mac_margin:
        sh = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        sh.putalpha(mul_alpha(sq, 0.55).transform((N, N), Image.AFFINE, (1, 0, 0, 0, 1, -N * 0.012)).filter(ImageFilter.GaussianBlur(N * 0.018)))
        im.alpha_composite(sh)
    # Fondo: casi negro con un poco de azul arriba
    paint(im, sq, lin_grad(N, (28, 31, 42, 255), (6, 7, 10, 255)))
    cx = cy = N / 2
    U = side  # todas las medidas, relativas al lado de la forma
    w = U * 0.80; h = w / 2; sw = h * 0.085
    # Brillo azul detrás del centro
    glow = Image.new('L', (N, N), 0)
    ImageDraw.Draw(glow).ellipse((cx - U * 0.36, cy - U * 0.22, cx + U * 0.36, cy + U * 0.22), fill=110)
    glow = ImageChops.multiply(glow.filter(ImageFilter.GaussianBlur(U * 0.12)), sq)
    paint(im, glow, Image.new('RGBA', (N, N), (33, 58, 206, 255)))
    # Aros: degradado azul claro → azul de Cabina, con resplandor
    rm = rings_mask(N, cx, cy, w - sw, h - sw, sw, 0.12)
    halo = mul_alpha(rm.filter(ImageFilter.GaussianBlur(U * 0.02)), 0.75)
    paint(im, halo, Image.new('RGBA', (N, N), (60, 90, 255, 255)))
    paint(im, rm, lin_grad(N, (104, 130, 255, 255), (30, 52, 205, 255)))
    # Cápsula: mismo degradado más intenso, resplandor y sombra debajo
    pw, ph = w * 0.5, h * 0.6  # mismas proporciones que el logo plano
    pm = pill_mask(N, cx, cy, pw, ph)
    sh = mul_alpha(pill_mask(N, cx, cy + U * 0.02, pw, ph).filter(ImageFilter.GaussianBlur(U * 0.025)), 0.7)
    paint(im, sh, Image.new('RGBA', (N, N), (0, 0, 0, 255)))
    paint(im, mul_alpha(pm.filter(ImageFilter.GaussianBlur(U * 0.045)), 0.8), Image.new('RGBA', (N, N), (45, 75, 255, 255)))
    paint(im, pm, lin_grad(N, (98, 124, 255, 255), (26, 46, 192, 255)))
    # Reflejo de cristal en la mitad de arriba de la cápsula
    hl = pill_mask(N, cx, cy - ph * 0.25, pw - ph * 0.3, ph * 0.42)
    hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(U * 0.012)), pm)
    sheen = lin_grad(N, (255, 255, 255, 120), (255, 255, 255, 0))
    sheen = sheen.crop((0, 0, N, N))
    # el degradado del reflejo va de arriba a abajo de la propia cápsula
    top = cy - ph / 2; bot = cy
    g = Image.new('RGBA', (1, N), (0, 0, 0, 0))
    for y in range(N):
        t = min(1, max(0, (y - top) / (bot - top)))
        g.putpixel((0, y), (255, 255, 255, round(95 * (1 - t) ** 2)))
    paint(im, hl, g.resize((N, N)))
    # Borde fino de luz arriba en la forma (como el canto del cristal)
    edge = ImageChops.subtract(sq, squircle(N, (box[0] + S * 1.2, box[1] + S * 1.2, box[2] - S * 1.2, box[3] - S * 1.2)))
    paint(im, edge, lin_grad(N, (255, 255, 255, 70), (255, 255, 255, 0)))
    return dither(im.resize((size, size), Image.LANCZOS)) if size >= 64 else im.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    # Genera los iconos desde la raíz del repositorio: python3 app/build/icono.py
    icon(1024).save('app/build/icon.png')                          # Mac: con el margen y la sombra de macOS
    icon(1024, mac_margin=False).save('app/build/icon-win.png')    # Windows: sin margen
    icon(180, mac_margin=False).save('web/icono.png')              # pestaña de la web
