"""Prepara a textura do leão: preenche o fundo preto do atlas (e 3 px da franja das ilhas) com a cor da
ilha mais próxima e reduz para 2048. Sem isso, o preto vaza para as bordas nos níveis de mipmap.
Uso (na pasta onde está o baked.glb):  python3 prep_texture.py   → gera lion_tex_2048.jpg"""
import os
import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage

g = list(trimesh.load('baked.glb').geometry.values())[0]
a = np.asarray(g.visual.material.baseColorTexture.convert('RGB'))
valid = a.max(2) > 3
core = ndimage.binary_erosion(valid, iterations=3)
idx = ndimage.distance_transform_edt(~core, return_distances=False, return_indices=True)
Image.fromarray(a[idx[0], idx[1]]).resize((2048, 2048), Image.LANCZOS).save(
    'lion_tex_2048.jpg', quality=88, optimize=True, subsampling=0)
print('lion_tex_2048.jpg: %.2f MB' % (os.path.getsize('lion_tex_2048.jpg') / 1048576))
