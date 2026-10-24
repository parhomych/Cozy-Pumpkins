from PIL import Image
import numpy as np

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
arr = np.array(base_img)
w, h = base_img.size

# Let's inspect:
# 1. Arm Left:
# The arm is separated from the wing by outline.
# Above sleeve: at y=463, x in 145..268
# Below sleeve: at y=506, x in 145..268
# Hand and cuff: anything with x <= 145 and y in 410..530 that has alpha > 0 belongs to left arm!
# Notice: there is NO wing at x <= 145 and y in 410..530!
# Let's verify: is there any wing at x <= 145 and y in 410..530?
print('Non-zero alpha in (x<=145, 410<=y<=530):', np.count_nonzero(arr[410:531, :146, 3] > 0))

# What about right arm?
# Sleeve: y in 465..508, x in 425..550
# Hand and cuff: anything with x >= 550 and y in 420..540 belongs to right arm!
# Is there any wing at x >= 550 and y in 420..540?
# In the original image, right wing is behind, but let's check:
print('Non-zero alpha in (x>=550, 420<=y<=540):', np.count_nonzero(arr[420:541, 550:, 3] > 0))
