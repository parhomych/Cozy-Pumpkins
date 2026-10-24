import os
from PIL import Image

src_path = 'C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png'
im = Image.open(src_path)

os.makedirs('scratch/parts', exist_ok=True)

# Let's inspect where arms, wings, legs, head, body are located.
# We can save crops of candidate boxes
boxes = {
    'head': (100, 20, 620, 460),
    'torso': (170, 430, 520, 750),
    'left_arm': (25, 410, 280, 535),
    'right_arm': (415, 410, 715, 535),
    'left_wing': (130, 420, 280, 600),
    'right_wing': (420, 420, 620, 630),
    'left_leg': (210, 660, 360, 1015),
    'right_leg': (340, 660, 470, 1015),
    'tail': (470, 680, 650, 835)
}

for name, box in boxes.items():
    cropped = im.crop(box)
    cropped.save(f'scratch/parts/{name}.png')

print('Saved candidate crops')
