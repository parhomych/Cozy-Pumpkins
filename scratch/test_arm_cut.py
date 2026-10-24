from PIL import Image, ImageDraw
import numpy as np
import os

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
w, h = base_img.size

# Let's inspect the exact masks for each part
# 1. Left Arm:
# Hand: X: 25..120, Y: 415..520
# Leaf cuff: X: 105..150, Y: 435..515
# Sleeve: X: 140..270, Y: 460..508
# Shoulder junction under collar: X: 250..275, Y: 465..508

# Let's create an image showing the arm boundary polygon
mask_left_arm = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_left_arm)

# Polygon enclosing left hand, cuff, sleeve
# Starts from shoulder, along top of sleeve to cuff, around hand circle, along bottom of cuff & sleeve back to shoulder
left_arm_poly = [
    (270, 460), (200, 460), (145, 435), (105, 415), (25, 435),
    (25, 500), (60, 525), (115, 525), (150, 515), (270, 515)
]
draw.polygon(left_arm_poly, fill=255)

# Mask with base alpha
arm_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
base_arr = np.array(base_img)
arm_mask_arr = np.array(mask_left_arm) > 0
arm_arr = np.zeros_like(base_arr)
arm_arr[arm_mask_arr] = base_arr[arm_mask_arr]

arm_out = Image.fromarray(arm_arr)
arm_crop = arm_out.crop((20, 410, 280, 530))
arm_crop.save('scratch/test_left_arm_cut.png')
print('Saved test_left_arm_cut.png')
