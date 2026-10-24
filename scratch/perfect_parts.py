from PIL import Image, ImageDraw
import numpy as np
import os
import json

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
base_img = Image.open(src_path).convert('RGBA')
w, h = base_img.size
arr = np.array(base_img)

out_dir = 'public/assets/witch'
os.makedirs(out_dir, exist_ok=True)

# 1. HEAD (Hat, ears, hair, face)
mask_head = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_head)
draw.polygon([(80, 20), (640, 20), (640, 440), (450, 440), (410, 465), (320, 465), (280, 440), (80, 440)], fill=255)
draw.polygon([(240, 440), (490, 440), (490, 470), (240, 470)], fill=255)
head_arr = np.zeros_like(arr)
m_h = (np.array(mask_head) > 0) & (arr[:, :, 3] > 0)
head_arr[m_h] = arr[m_h]

# 2. LEFT ARM
mask_arm_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_arm_l)
draw.ellipse([(24, 415), (145, 530)], fill=255)
draw.polygon([(110, 435), (150, 435), (150, 515), (110, 515)], fill=255)
draw.polygon([(145, 462), (270, 462), (270, 506), (145, 506)], fill=255)
arm_l_arr = np.zeros_like(arr)
m_arm_l = (np.array(mask_arm_l) > 0) & (arr[:, :, 3] > 0) & (~m_h)
arm_l_arr[m_arm_l] = arr[m_arm_l]

# Add rounded shoulder cap at pivot (265, 485)
draw_arm_l = ImageDraw.Draw(Image.fromarray(arm_l_arr))
for y in range(463, 507):
    for x in range(265, 287):
        if (x - 265)**2 + (y - 485)**2 <= 22**2:
            arm_l_arr[y, x] = np.array([245, 235, 235, 255], dtype=np.uint8)

# 3. RIGHT ARM
mask_arm_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_arm_r)
draw.polygon([(425, 465), (555, 465), (555, 508), (425, 508)], fill=255)
draw.polygon([(545, 445), (595, 445), (595, 518), (545, 518)], fill=255)
draw.rectangle([(575, 430), (715, 565)], fill=255)
arm_r_arr = np.zeros_like(arr)
m_arm_r = (np.array(mask_arm_r) > 0) & (arr[:, :, 3] > 0) & (~m_h)
arm_r_arr[m_arm_r] = arr[m_arm_r]

# Add rounded shoulder cap at pivot (435, 485)
for y in range(463, 507):
    for x in range(413, 436):
        if (x - 435)**2 + (y - 485)**2 <= 22**2:
            arm_r_arr[y, x] = np.array([245, 235, 235, 255], dtype=np.uint8)

# 4. TAIL
mask_tail = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_tail)
draw.polygon([
    (470, 715), (510, 705), (560, 760), (646, 760), (646, 825),
    (580, 835), (510, 780), (470, 735)
], fill=255)
tail_arr = np.zeros_like(arr)
m_tail = (np.array(mask_tail) > 0) & (arr[:, :, 3] > 0)
tail_arr[m_tail] = arr[m_tail]

# 5. LEFT LEG
mask_leg_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_l)
draw.rectangle([(210, 675), (345, 1015)], fill=255)
leg_l_arr = np.zeros_like(arr)
m_leg_l = (np.array(mask_leg_l) > 0) & (arr[:, :, 3] > 0) & (~m_tail)
leg_l_arr[m_leg_l] = arr[m_leg_l]
thigh_color = np.array([75, 50, 40, 255], dtype=np.uint8)
for y in range(640, 676):
    for x in range(235, 330):
        leg_l_arr[y, x] = thigh_color

# 6. RIGHT LEG
mask_leg_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_leg_r)
draw.rectangle([(345, 675), (470, 1015)], fill=255)
leg_r_arr = np.zeros_like(arr)
m_leg_r = (np.array(mask_leg_r) > 0) & (arr[:, :, 3] > 0) & (~m_tail)
leg_r_arr[m_leg_r] = arr[m_leg_r]
for y in range(640, 676):
    for x in range(355, 445):
        leg_r_arr[y, x] = thigh_color

# 7. TORSO & SKIRT
mask_torso = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_torso)
draw.polygon([
    (245, 440), (485, 440), (525, 600), (525, 740), (450, 750),
    (365, 750), (220, 750), (175, 740), (175, 600), (245, 440)
], fill=255)
torso_arr = np.zeros_like(arr)
m_torso = (np.array(mask_torso) > 0) & (arr[:, :, 3] > 0) & (~m_h)
# Remove arms from torso
torso_arr[m_torso] = arr[m_torso]
torso_arr[m_arm_l] = 0
torso_arr[m_arm_r] = 0

# Infill shoulder sockets on torso
for y in range(460, 510):
    for x in range(240, 275):
        if torso_arr[y, x, 3] == 0:
            torso_arr[y, x] = np.array([250, 125, 25, 255], dtype=np.uint8) if y > 475 else np.array([65, 130, 50, 255], dtype=np.uint8)
    for x in range(420, 455):
        if torso_arr[y, x, 3] == 0:
            torso_arr[y, x] = np.array([250, 125, 25, 255], dtype=np.uint8) if y > 475 else np.array([65, 130, 50, 255], dtype=np.uint8)

# 8. LEFT WING
mask_wing_l = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_l)
# Wing outer contour
draw.polygon([
    (270, 435), (230, 420), (195, 445), (120, 595), (180, 505),
    (240, 605), (255, 535), (275, 470)
], fill=255)
# Full infill polygon covering sleeve area
draw.polygon([(120, 440), (275, 440), (275, 520), (120, 520)], fill=255)
wing_l_arr = np.zeros_like(arr)
m_wing_l = (np.array(mask_wing_l) > 0)
# Copy original pixels
wing_l_arr[m_wing_l & (arr[:, :, 3] > 0)] = arr[m_wing_l & (arr[:, :, 3] > 0)]
# Infill orange membrane and green rib across the sleeve region
orange_wing = np.array([245, 120, 25, 255], dtype=np.uint8)
green_bone = np.array([55, 140, 55, 255], dtype=np.uint8)
outline_bone = np.array([60, 35, 25, 255], dtype=np.uint8)
for y in range(450, 520):
    for x in range(130, 275):
        # target diagonal rib from (220, 430) to (160, 530)
        target_x = 220 - (y - 430) / 1.67
        if abs(x - target_x) < 4:
            wing_l_arr[y, x] = green_bone
        elif abs(x - target_x) < 6:
            wing_l_arr[y, x] = outline_bone
        else:
            wing_l_arr[y, x] = orange_wing

# 9. RIGHT WING
mask_wing_r = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask_wing_r)
draw.polygon([
    (430, 435), (510, 420), (550, 455), (635, 630), (550, 530),
    (485, 610), (455, 520), (430, 470)
], fill=255)
draw.polygon([(425, 440), (565, 440), (565, 520), (425, 520)], fill=255)
wing_r_arr = np.zeros_like(arr)
m_wing_r = (np.array(mask_wing_r) > 0)
wing_r_arr[m_wing_r & (arr[:, :, 3] > 0)] = arr[m_wing_r & (arr[:, :, 3] > 0)]
for y in range(450, 520):
    for x in range(425, 565):
        target_x = 510 + (y - 430) / 1.67
        if abs(x - target_x) < 4:
            wing_r_arr[y, x] = green_bone
        elif abs(x - target_x) < 6:
            wing_r_arr[y, x] = outline_bone
        else:
            wing_r_arr[y, x] = orange_wing

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

with open(os.path.join(out_dir, 'metadata.json'), 'w') as f:
    json.dump(metadata, f, indent=2)

print('Updated perfect parts with solid wings and shoulder joints!')
