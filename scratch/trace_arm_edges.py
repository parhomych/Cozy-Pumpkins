from PIL import Image, ImageDraw
import numpy as np

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
arr = np.array(base_img)
w, h = base_img.size

# Let's inspect rows around left arm sleeve:
# At each X from 140 to 260, find the dark stroke of top and bottom edge:
top_edges_left = []
bottom_edges_left = []
for x in range(145, 265):
    col = arr[:, x]
    # search around y 455..475 for top stroke
    slice_top = col[455:475]
    # find darkest pixel (minimum luminance)
    lum_top = np.mean(slice_top[:, :3], axis=1)
    y_top = 455 + np.argmin(lum_top)
    top_edges_left.append((x, y_top))

    # search around y 495..515 for bottom stroke
    slice_bot = col[495:515]
    lum_bot = np.mean(slice_bot[:, :3], axis=1)
    y_bot = 495 + np.argmin(lum_bot)
    bottom_edges_left.append((x, y_bot))

print('Left arm top edge range:', min(y for x, y in top_edges_left), max(y for x, y in top_edges_left))
print('Left arm bottom edge range:', min(y for x, y in bottom_edges_left), max(y for x, y in bottom_edges_left))
