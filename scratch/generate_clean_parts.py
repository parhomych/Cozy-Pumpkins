from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
w, h = base_img.size
arr = np.array(base_img)

os.makedirs('scratch/parts_clean', exist_ok=True)

# 1. Left Arm:
# Hand: x 25..120, y 415..525
# Cuff: x 105..145, y 435..515
# Sleeve: x 140..270, y 462..506
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
Image.fromarray(arm_l_arr).save('scratch/parts_clean/arm_left_full.png')

# 2. Right Arm:
# Sleeve: x 425..550, y 465..508
# Cuff: x 545..585, y 445..515
# Hand: x 575..711, y 430..530
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
Image.fromarray(arm_r_arr).save('scratch/parts_clean/arm_right_full.png')

# 3. Left Wing:
# x: 135..275, y: 420..605
# Note: behind the arm, we infill the orange webbing and green rib so when arm moves, wing is complete!
mask_wing_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_l)
poly_wing_l = [
    (270, 440), (230, 420), (195, 445), (135, 595), (180, 505),
    (240, 605), (255, 535), (275, 470)
]
draw.polygon(poly_wing_l, fill=255)
wing_l_arr = np.zeros_like(arr)
m_wl = (np.array(mask_wing_l) > 0) & (arr[:, :, 3] > 10)
wing_l_arr[m_wl] = arr[m_wl]
# Infill where left arm sleeve passed over (y 463..506, x 140..265)
# Sample wing orange and green colors
orange_wing = np.array([245, 120, 25, 255], dtype=np.uint8)
green_bone = np.array([55, 140, 55, 255], dtype=np.uint8)
outline_bone = np.array([60, 35, 25, 255], dtype=np.uint8)
for y in range(463, 507):
    for x in range(145, 270):
        if mask_wing_l.getpixel((x, y)) > 0 and arm_l_arr[y, x, 3] > 0:
            # Check if this (x, y) is along the green rib that runs from (220, 430) to (160, 530)
            # Line: (y - 430) = (530 - 430)/(160 - 220) * (x - 220) = -1.67 * (x - 220)
            target_x = 220 - (y - 430) / 1.67
            if abs(x - target_x) < 4:
                wing_l_arr[y, x] = green_bone
            elif abs(x - target_x) < 6:
                wing_l_arr[y, x] = outline_bone
            else:
                wing_l_arr[y, x] = orange_wing
Image.fromarray(wing_l_arr).save('scratch/parts_clean/wing_left_full.png')

# 4. Right Wing:
# x: 420..620, y: 420..630
mask_wing_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_r)
poly_wing_r = [
    (430, 440), (510, 420), (550, 455), (620, 630), (550, 530),
    (485, 610), (455, 520), (430, 470)
]
draw.polygon(poly_wing_r, fill=255)
wing_r_arr = np.zeros_like(arr)
m_wr = (np.array(mask_wing_r) > 0) & (arr[:, :, 3] > 10)
wing_r_arr[m_wr] = arr[m_wr]
# Infill right arm sleeve overlap (y 465..508, x 425..550)
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
Image.fromarray(wing_r_arr).save('scratch/parts_clean/wing_right_full.png')

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
Image.fromarray(tail_arr).save('scratch/parts_clean/tail_full.png')

# 6. Left Leg:
mask_leg_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_l)
draw.polygon([(215, 680), (350, 680), (350, 1015), (215, 1015)], fill=255)
leg_l_arr = np.zeros_like(arr)
m_ll = (np.array(mask_leg_l) > 0) & (arr[:, :, 3] > 10)
leg_l_arr[m_ll] = arr[m_ll]
# Exclude tail overlap if any
leg_l_arr[m_t] = 0
Image.fromarray(leg_l_arr).save('scratch/parts_clean/leg_left_full.png')

# 7. Right Leg:
mask_leg_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_r)
draw.polygon([(345, 680), (460, 680), (460, 1015), (345, 1015)], fill=255)
leg_r_arr = np.zeros_like(arr)
m_lr = (np.array(mask_leg_r) > 0) & (arr[:, :, 3] > 10)
leg_r_arr[m_lr] = arr[m_lr]
leg_r_arr[m_t] = 0
Image.fromarray(leg_r_arr).save('scratch/parts_clean/leg_right_full.png')

# 8. Head:
mask_head = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_head)
draw.polygon([(100, 20), (620, 20), (620, 455), (100, 455)], fill=255)
head_arr = np.zeros_like(arr)
m_h = (np.array(mask_head) > 0) & (arr[:, :, 3] > 10)
head_arr[m_h] = arr[m_h]
Image.fromarray(head_arr).save('scratch/parts_clean/head_full.png')

# 9. Torso:
mask_torso = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_torso)
draw.polygon([(170, 440), (530, 440), (530, 750), (170, 750)], fill=255)
torso_arr = np.zeros_like(arr)
m_torso = (np.array(mask_torso) > 0) & (arr[:, :, 3] > 10)
# exclude arms, wings, legs, tail, head
torso_arr[m_torso] = arr[m_torso]
torso_arr[m_l] = 0
torso_arr[m_r] = 0
torso_arr[m_wl] = 0
torso_arr[m_wr] = 0
torso_arr[m_h] = 0
torso_arr[m_t] = 0
# For legs, skirt covers the top of legs, so keep skirt!
Image.fromarray(torso_arr).save('scratch/parts_clean/torso_full.png')

print('All 9 clean parts generated!')
