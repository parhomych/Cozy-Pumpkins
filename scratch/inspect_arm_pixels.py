import numpy as np
from PIL import Image

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
im = Image.open(src_path)
arr = np.array(im)

# Let's inspect the left arm region
# y: 410..540, x: 25..280
left_arm_region = arr[410:540, 25:280]

# Where are pixels non-transparent?
alpha = left_arm_region[:, :, 3]
print('Left arm region shape:', left_arm_region.shape)
print('Non-zero alpha pixels:', np.count_nonzero(alpha))
