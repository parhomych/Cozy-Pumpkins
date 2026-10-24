from PIL import Image
import numpy as np

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
im = Image.open(src_path).convert('RGBA')
arr = np.array(im)

print('Image size:', im.size)
# Find bounding boxes of key color regions or components
# Let's inspect the arm rows around Y = 430..530
for y in range(430, 530, 10):
    row = arr[y, :, 3] > 0
    xs = np.where(row)[0]
    if len(xs):
        print(f"Y={y}: minX={xs[0]}, maxX={xs[-1]}")
