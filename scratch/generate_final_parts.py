from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
w, h = base_img.size
arr = np.array(base_img)

out_dir = 'public/assets/witch'
os.makedirs(out_dir, exist_ok=True)

# 1. Left Arm:
# Hand: X: 25..120, Y: 415..525
# Cuff: X: 105..150, Y: 435..515
# Sleeve: X: 140..270, Y: 462..506
mask_arm_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_arm_l)
poly_arm_l = [
    (25, 460), (35, 430), (75, 415), (115, 435), (145, 435),
    (150, 463), (268, 463), (268, 506), (150, 506),
    (145, 515), (100, 525), (45, 520), (25, 485)
]
draw.polygon(poly_arm_l, fill=255)
arm_l_arr = np.zeros_like(arr)
m_l = (np.array(mask_arm_l) > 0) & (arr[:, :, 3] > 10)
arm_l_arr[m_l] = arr[m_l]

# 2. Right Arm:
mask_arm_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_arm_r)
poly_arm_r = [
    (425, 465), (550, 465), (550, 440), (585, 430), (620, 435),
    (670, 435), (711, 460), (711, 485), (690, 525), (635, 530),
    (585, 520), (550, 515), (425, 508)
]
draw.polygon(poly_arm_r, fill=255)
arm_r_arr = np.zeros_like(arr)
m_r = (np.array(mask_arm_r) > 0) & (arr[:, :, 3] > 10)
arm_r_arr[m_r] = arr[m_r]

# 3. Left Wing:
mask_wing_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_l)
poly_wing_l = [
    (270, 435), (230, 420), (195, 445), (135, 595), (180, 505),
    (240, 605), (255, 535), (275, 470)
]
draw.polygon(poly_wing_l, fill=255)
wing_l_arr = np.zeros_like(arr)
m_wl = (np.array(mask_wing_l) > 0) & (arr[:, :, 3] > 10)
wing_l_arr[m_wl] = arr[m_wl]
# Infill arm overlap
orange_wing = np.array([245, 120, 25, 255], dtype=np.uint8)
green_bone = np.array([55, 140, 55, 255], dtype=np.uint8)
outline_bone = np.array([60, 35, 25, 255], dtype=np.uint8)
for y in range(463, 507):
    for x in range(145, 270):
        if mask_wing_l.getpixel((x, y)) > 0 and arm_l_arr[y, x, 3] > 0:
            target_x = 220 - (y - 430) / 1.67
            if abs(x - target_x) < 4:
                wing_l_arr[y, x] = green_bone
            elif abs(x - target_x) < 6:
                wing_l_arr[y, x] = outline_bone
            else:
                wing_l_arr[y, x] = orange_wing

# 4. Right Wing:
mask_wing_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_r)
poly_wing_r = [
    (430, 435), (510, 420), (550, 455), (620, 630), (550, 530),
    (485, 610), (455, 520), (430, 470)
]
draw.polygon(poly_wing_r, fill=255)
wing_r_arr = np.zeros_like(arr)
m_wr = (np.array(mask_wing_r) > 0) & (arr[:, :, 3] > 10)
wing_r_arr[m_wr] = arr[m_wr]
for y in range(465, 509):
    for x in range(425, 550):
        if mask_wing_r.getpixel((x, y)) > 0 and arm_r_arr[y, x, 3] > 0:
            target_x = 510 + (y - 430) / 1.67
            if abs(x - target_x) < 4:
                wing_r_arr[y, x] = green_bone
            elif abs(x - target_x) < 6:
                wing_r_arr[y, x] = outline_bone
            else:
                wing_r_arr[y, x] = orange_wing

# 5. Tail:
mask_tail = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_tail)
poly_tail = [
    (470, 710), (510, 700), (560, 760), (646, 760), (646, 825),
    (580, 835), (510, 780), (470, 730)
]
draw.polygon(poly_tail, fill=255)
tail_arr = np.zeros_like(arr)
m_t = (np.array(mask_tail) > 0) & (arr[:, :, 3] > 10)
tail_arr[m_t] = arr[m_t]

# 6. Left Leg:
mask_leg_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_l)
draw.polygon([(215, 680), (345, 680), (345, 1015), (215, 1015)], fill=255)
leg_l_arr = np.zeros_like(arr)
m_ll = (np.array(mask_leg_l) > 0) & (arr[:, :, 3] > 10)
leg_l_arr[m_ll] = arr[m_ll]
leg_l_arr[m_t] = 0

# 7. Right Leg:
mask_leg_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_r)
draw.polygon([(345, 680), (460, 680), (460, 1015), (345, 1015)], fill=255)
leg_r_arr = np.zeros_like(arr)
m_lr = (np.array(mask_leg_r) > 0) & (arr[:, :, 3] > 10)
leg_r_arr[m_lr] = arr[m_lr]
leg_r_arr[m_t] = 0

# 8. Head:
mask_head = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_head)
draw.polygon([(100, 20), (620, 20), (620, 455), (100, 455)], fill=255)
head_arr = np.zeros_like(arr)
m_h = (np.array(mask_head) > 0) & (arr[:, :, 3] > 10)
head_arr[m_h] = arr[m_h]

# 9. Torso:
# Torso body is inside x: 200..490, y: 440..740
mask_torso = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_torso)
draw.polygon([
    (260, 440), (430, 440), (450, 500), (480, 560), (510, 620), (520, 710),
    (365, 740), (210, 710), (220, 620), (250, 560), (260, 500)
], fill=255)
torso_arr = np.zeros_like(arr)
m_torso = (np.array(mask_torso) > 0) & (arr[:, :, 3] > 10)
torso_arr[m_torso] = arr[m_torso]
torso_arr[m_h] = 0
torso_arr[m_t] = 0
torso_arr[m_ll] = 0
torso_arr[m_lr] = 0

# Infill shoulder sockets on torso where arms attach so rotating arms looks clean
brown_collar = np.array([60, 35, 25, 255], dtype=np.uint8)
green_collar = np.array([65, 130, 50, 255], dtype=np.uint8)
orange_torso = np.array([250, 125, 25, 255], dtype=np.uint8)
for y in range(465, 505):
    for x in range(250, 275):
        if torso_arr[y, x, 3] == 0:
            torso_arr[y, x] = orange_torso if y > 475 else green_collar
    for x in range(420, 445):
        if torso_arr[y, x, 3] == 0:
            torso_arr[y, x] = orange_torso if y > 475 else green_collar

parts = {
    'head': head_arr,
    'torso': torso_arr,
    'arm_left': arm_l_arr,
    'arm_right': arm_r_arr,
    'wing_left': wing_l_arr,
    'wing_right': wing_r_arr,
    'leg_left': leg_l_arr,
    'leg_right': leg_r_arr,
    'tail': tail_arr
}

# Crop each part tightly and record its box (minX, minY, width, height)
metadata = {}
for name, part_arr in parts.items():
    alphas = part_arr[:, :, 3] > 0
    ys, xs = np.where(alphas)
    if len(xs) and len(ys):
        min_x, max_x = int(np.min(xs)), int(np.max(xs))
        min_y, max_y = int(np.min(ys)), int(np.max(ys))
        cropped = part_arr[min_y:max_y+1, min_x:max_x+1]
        img = Image.fromarray(cropped)
        img.save(os.path.join(out_dir, f'{name}.png'))
        metadata[name] = {
            'x': min_x,
            'y': min_y,
            'width': max_x - min_x + 1,
            'height': max_y - min_y + 1
        }
        print(f'{name}: x={min_x}, y={min_y}, w={max_x - min_x + 1}, h={max_y - min_y + 1}')

import json
with open(os.path.join(out_dir, 'metadata.json'), 'w') as f:
    json.dump(metadata, f, indent=2)

print('Saved all parts and metadata to public/assets/witch/')
