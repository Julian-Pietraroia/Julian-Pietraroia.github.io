# Lamp Tinder

Swipe right on lamps you like, left on the ones you don't. At the end, every lamp you liked is blended into one new lamp (shown in 3D, downloadable as an STL) and matched against real lamps you can buy.

Live: https://julian-pietraroia.github.io/lamp-tinder/

## How it works
- **Generation:** `generator/gen_lamps.py` builds random lamps procedurally in Blender (type, base, stem, shade profile, finish, colours, glow) and renders each one with EEVEE. Every parameter is stored normalised to 0–1 in `out/lamps.json`.
- **Blending:** numeric parameters and colours are averaged across your likes; type, shade shape, base and finish are decided by majority vote.
- **3D + STL:** `site/lamp3d.js` is a three.js port of the Blender builder, so the blended lamp renders in the browser and exports as an STL (mm, Z-up, 2 mm shade wall).
- **Recommendation:** the blended lamp's tags are scored against `site/products.json`, a hand-tagged catalog of real lamps.

## Regenerating lamps (Windows + Blender 5.2)
Copy the `generator/` files next to `index.html`, then:
```
run.bat --count 300               # render 300 lamps into out/
run.bat --combine liked.json      # Blender render of a blended lamp
start-site.bat                    # local preview at http://localhost:8000
```
