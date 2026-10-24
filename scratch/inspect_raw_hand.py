from PIL import Image

im = Image.open('C:/Users/Dark/.gemini/antigravity/brain/8334cad6-1f7c-4957-a03f-24c010d81730/.user_uploaded/media_1792862602370_0c1bd7ac.png')
crop = im.crop((560, 420, 720, 560))
crop.save('scratch/right_hand_raw.png')
print('Saved right_hand_raw.png')
