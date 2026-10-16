# Lamp Tinder

Swipe right on lamps you like, left on the ones you don't. Your likes are blended into a lamp of your own (shown in 3D, downloadable as an STL), and matched against ~1,500 real lamps you can buy.

Live: https://julian-pietraroia.github.io/lamp-tinder/

Built in one session with Claude; the conversation is in [CHAT.md](CHAT.md).

## How it works
- **Generation:** `generator/gen_lamps.py` builds random lamps procedurally in Blender (type, base, stem, shade profile, finish, colours, glow) and renders each one with EEVEE. Every parameter is stored normalised to 0–1 in `out/lamps.json`.
- **Real-lamp catalog:** `tools/build_catalog.py` pulls lighting from public store feeds (IKEA Canada, Bouclair, EQ3, Mobilia, Montreal Lighting, HUTK, Schoolhouse, A+R, Illuminee, Lulu and Georgia) into `data/catalog.json`: name, brand, store link, photo URL, price, lamp type. The site hot-links each store's own photo.
- **Image fingerprints:** `tools/embed.html` runs the CLIP image model (ViT-B/32, via transformers.js) in the browser over every render and every product photo, saving int8 vectors to `data/embeddings.json`. Renders and photos are each centred on their own mean so matching depends on the lamp, not the photo style.
- **Smart card order, no fixed length:** the first cards are spread across the space of looks; after that, cards alternate between "probably a like" (to refine your style), "could go either way" (most informative), and exploration. Cards keep coming until it is confident: at least 4 likes, 10 swipes, and the top-3 real-lamp matches unchanged for 4 swipes in a row (usually 10–20 swipes). A progress bar shows how close it is, and you can skip ahead at any time.
- **Likes and passes:** recommendations score each real lamp by similarity to your liked lamps, minus similarity to the ones you passed on, plus a bonus for matching your preferred lamp type.
- **Styles:** liked lamps are clustered (k-means on the fingerprints, k chosen by silhouette); distinct tastes, e.g. desk lamps and pendants, each get their own blended lamp and recommendations.
- **What your swipes say:** tag values you liked or passed on much more often than average (e.g. "♥ brass bodies", "✕ globe shades").
- **Budget:** optional price cap (CAD; US prices converted at a fixed rough rate).
- **3D + STL:** `site/lamp3d.js` is a three.js port of the Blender builder, so the blended lamp renders in the browser and exports as an STL (mm, Z-up, 2 mm shade wall).

## Rebuilding (Windows + Blender 5.2; uses Blender's bundled Python)
```
generator\run.bat --count 300     # render lamps (copy generator/ files next to index.html first)
tools\build_catalog.bat           # refresh the real-lamp catalog
tools\embed.bat                   # opens the fingerprint page; click Start (thumbnails are deleted afterwards)
start-site.bat                    # local preview at http://localhost:8000
```
