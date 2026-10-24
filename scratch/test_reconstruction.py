from PIL import Image
import json
import os

with open('public/assets/witch/metadata.json') as f:
    meta = json.load(f)

comp = Image.new('RGBA', (731, 1024), (0, 0, 0, 0))

# Layer order from back to front:
# 1. wings
# 2. tail
# 3. legs
# 4. torso
# 5. head
# 6. arms
order = [
    'wing_left', 'wing_right',
    'tail',
    'leg_left', 'leg_right',
    'torso',
    'head',
    'arm_left', 'arm_right'
]

for name in order:
    m = meta[name]
    part = Image.open(f'public/assets/witch/{name}.png')
    comp.paste(part, (m['x'], m['y']), part)

comp.save('scratch/reconstructed_witch.png')
print('Saved reconstructed_witch.png')
