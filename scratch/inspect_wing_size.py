from PIL import Image
import numpy as np

wl = Image.open('public/assets/witch/wing_left.png')
wr = Image.open('public/assets/witch/wing_right.png')
print('Wing left size:', wl.size)
print('Wing right size:', wr.size)
