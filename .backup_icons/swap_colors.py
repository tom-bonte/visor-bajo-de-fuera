import os
from PIL import Image

TARGET_GREEN = (0, 245, 185)
TARGET_BLUE = (50, 35, 160)

def swap_icon(fname):
    print(f"Processing {fname}...")
    img = Image.open(fname).convert('RGBA')
    out_pixels = []
    
    # Old colors: Blue ~ (50, 35, 158), Green ~ (2, 243, 183)
    for r, g, b, a in img.getdata():
        if a == 0:
            out_pixels.append((0, 0, 0, 0))
            continue
        
        d_green = ((r - 2)**2 + (g - 243)**2 + (b - 183)**2)**0.5
        d_blue  = ((r - 50)**2 + (g - 35)**2 + (b - 158)**2)**0.5
        
        total = d_green + d_blue
        t = (d_blue / total) if total > 0 else 1.0
        
        nr = int(round(t * TARGET_BLUE[0] + (1.0 - t) * TARGET_GREEN[0]))
        ng = int(round(t * TARGET_BLUE[1] + (1.0 - t) * TARGET_GREEN[1]))
        nb = int(round(t * TARGET_BLUE[2] + (1.0 - t) * TARGET_GREEN[2]))
        out_pixels.append((nr, ng, nb, a))
        
    out_img = Image.new('RGBA', img.size)
    out_img.putdata(out_pixels)
    
    if fname.lower().endswith('.webp'):
        out_img.save(fname, 'WEBP', lossless=True)
    else:
        out_img.save(fname, 'PNG')
    print(f"  Successfully updated {fname}")

def swap_square_logo(fname):
    print(f"Processing {fname}...")
    img = Image.open(fname).convert('RGB')
    out_pixels = []
    
    # Old colors: Blue ~ (48, 36, 152), Green ~ (111, 239, 187)
    for r, g, b in img.getdata():
        d_green = ((r - 111)**2 + (g - 239)**2 + (b - 187)**2)**0.5
        d_blue  = ((r - 48)**2 + (g - 36)**2 + (b - 152)**2)**0.5
        
        total = d_green + d_blue
        t = (d_blue / total) if total > 0 else 1.0
        
        nr = int(round(t * TARGET_BLUE[0] + (1.0 - t) * TARGET_GREEN[0]))
        ng = int(round(t * TARGET_BLUE[1] + (1.0 - t) * TARGET_GREEN[1]))
        nb = int(round(t * TARGET_BLUE[2] + (1.0 - t) * TARGET_GREEN[2]))
        out_pixels.append((nr, ng, nb))
        
    out_img = Image.new('RGB', img.size)
    out_img.putdata(out_pixels)
    out_img.save(fname, 'PNG')
    print(f"  Successfully updated {fname}")

def swap_acbrm_logo(fname):
    print(f"Processing {fname}...")
    img = Image.open(fname).convert('RGBA')
    w, h = img.size
    out_pixels = []
    
    for y in range(h):
        for x in range(w):
            r, g, b, a = img.getpixel((x, y))
            
            # Identify the shape icon in upper-left region
            is_shape = False
            if 180 <= x <= 370 and 250 <= y <= 510:
                if (g - r) >= 25:
                    is_shape = True
                    
            if is_shape:
                d_green = ((r - 111)**2 + (g - 239)**2 + (b - 187)**2)**0.5
                d_blue  = ((r - 48)**2 + (g - 36)**2 + (b - 152)**2)**0.5
                total = d_green + d_blue
                t = (d_blue / total) if total > 0 else 1.0
                
                nr = int(round(t * TARGET_BLUE[0] + (1.0 - t) * TARGET_GREEN[0]))
                ng = int(round(t * TARGET_BLUE[1] + (1.0 - t) * TARGET_GREEN[1]))
                nb = int(round(t * TARGET_BLUE[2] + (1.0 - t) * TARGET_GREEN[2]))
                out_pixels.append((nr, ng, nb, a))
            else:
                if (r, g, b) == (48, 36, 152):
                    out_pixels.append((TARGET_GREEN[0], TARGET_GREEN[1], TARGET_GREEN[2], a))
                elif (r, g, b) == (255, 255, 255):
                    out_pixels.append((255, 255, 255, a))
                else:
                    # White text antialiasing against the new background
                    w_frac = max(0.0, min(1.0, (r - 48.0) / (255.0 - 48.0)))
                    nr = int(round(w_frac * 255.0 + (1.0 - w_frac) * TARGET_GREEN[0]))
                    ng = int(round(w_frac * 255.0 + (1.0 - w_frac) * TARGET_GREEN[1]))
                    nb = int(round(w_frac * 255.0 + (1.0 - w_frac) * TARGET_GREEN[2]))
                    out_pixels.append((nr, ng, nb, a))
                    
    out_img = Image.new('RGBA', (w, h))
    out_img.putdata(out_pixels)
    out_img.save(fname, 'PNG')
    print(f"  Successfully updated {fname}")

if __name__ == '__main__':
    # Icons
    for f in ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'visor_favicon.webp']:
        if os.path.exists(f):
            swap_icon(f)
            
    # ACBRM square logo
    if os.path.exists('ACBRM square logo.png'):
        swap_square_logo('ACBRM square logo.png')
        
    # ACBRM logo with white text
    if os.path.exists('ACBRM logo.png'):
        swap_acbrm_logo('ACBRM logo.png')
        
    print("All 6 files successfully updated!")
