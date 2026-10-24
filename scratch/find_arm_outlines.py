import numpy as np
from PIL import Image

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
im = Image.open(src_path).convert('RGBA')
arr = np.array(im)

# Let's inspect the boundaries of left arm:
# Left arm sleeve: from X ~ 138 to 260, Y ~ 454 to 497
print('Left arm top edge samples:')
for x in [150, 180, 200, 220, 240]:
    # find top boundary (transition from wing to arm outline)
    col = arr[430:520, x]
    # find the dark outline (outline color is dark brown/black)
    alphas = col[:, 3]
    # print dark pixels in this column
    dark_ys = [430 + idx for idx, c in enumerate(col) if c[3] > 200 and np.mean(c[:3]) < 90]
    print(f'x={x}: dark outlines at y={dark_ys}')
