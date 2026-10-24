from PIL import Image, ImageDraw
import numpy as np
import json
import os

with open('public/assets/witch/metadata.json') as f:
    meta = json.load(f)

# 1. Arm Left:
# Currently w=246, h=110, x=25, y=421. Pivot at 265, 485.
# Let's extend arm_left by 20px to the right with a rounded cap centered at (265, 485).
arm_l = Image.open('public/assets/witch/arm_left.png').convert('RGBA')
# create wider canvas
w_l, h_l = arm_l.size
new_arm_l = Image.new('RGBA', (w_l + 25, h_l), (0, 0, 0, 0))
new_arm_l.paste(arm_l, (0, 0))

draw_l = ImageDraw.Draw(new_arm_l)
# Shoulder center is at (265 - 25, 485 - 421) = (240, 64)
# Radius is 22px
draw_l.pieslice([(240 - 22, 64 - 22), (240 + 22, 64 + 22)], -90, 90, fill=(245, 235, 235, 255), outline=(60, 35, 25, 255), width=3)
new_arm_l.save('public/assets/witch/arm_left.png')

# 2. Arm Right:
# Pivot at (435, 485). x=425, y=449.
# Let's extend arm_right by 25px to the left with a rounded cap centered at (435, 485).
arm_r = Image.open('public/assets/witch/arm_right.png').convert('RGBA')
w_r, h_r = arm_r.size
new_arm_r = Image.new('RGBA', (w_r + 25, h_r), (0, 0, 0, 0))
new_arm_r.paste(arm_r, (25, 0))

draw_r = ImageDraw.Draw(new_arm_r)
# Shoulder center is at (435 - (425 - 25), 485 - 449) = (35, 36)
draw_r.pieslice([(35 - 22, 36 - 22), (35 + 22, 36 + 22)], 90, 270, fill=(245, 235, 235, 255), outline=(60, 35, 25, 255), width=3)
new_arm_r.save('public/assets/witch/arm_right.png')

# Update metadata
meta['arm_left']['width'] = w_l + 25
meta['arm_right']['x'] = 400
meta['arm_right']['width'] = w_r + 25

with open('public/assets/witch/metadata.json', 'w') as f:
    json.dump(meta, f, indent=2)

print('Added smooth shoulder caps to both arms!')
