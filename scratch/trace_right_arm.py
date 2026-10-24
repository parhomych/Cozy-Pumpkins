from PIL import Image
import numpy as np

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
arr = np.array(base_img)

top_edges_right = []
bottom_edges_right = []
for x in range(430, 560):
    col = arr[:, x]
    slice_top = col[455:475]
    lum_top = np.mean(slice_top[:, :3], axis=1)
    y_top = 455 + np.argmin(lum_top)
    top_edges_right.append((x, y_top))

    slice_bot = col[495:515]
    lum_bot = np.mean(slice_bot[:, :3], axis=1)
    y_bot = 495 + np.argmin(lum_bot)
    bottom_edges_right.append((x, y_bot))

print('Right arm top edge range:', min(y for x, y in top_edges_right), max(y for x, y in top_edges_right))
print('Right arm bottom edge range:', min(y for x, y in bottom_edges_right), max(y for x, y in bottom_edges_right))
