from PIL import Image, ImageDraw
import numpy as np

# In arm_left: pivot is at (265, 485).
# Sleeve top is at Y=462, bottom at Y=506.
# Height of sleeve is 506 - 462 = 44px.
# Radius of cap = 22px.
# Adding a semi-circle at x=265 with radius 22:
# (x - 265)^2 + (y - 485)^2 <= 22^2
# In arm_left, x >= 265 continues into the shoulder socket!
# Color of sleeve at shoulder is white/orange stripes:
# At x=250..270 it is white.

# Let's inspect arm_left and arm_right with shoulder caps
im_arm_l = Image.open('public/assets/witch/arm_left.png').convert('RGBA')
arr_l = np.array(im_arm_l)
print('arm_l shape:', arr_l.shape)
