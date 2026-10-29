# Lamp Tinder

Swipe right on 1,200 Blender-generated lamps you like, left on the ones you don't. Your likes are blended into a lamp of your own (shown in 3D, downloadable as a print-ready desk model), and matched against ~1,500 real lamps you can buy.

Live: https://julian-pietraroia.github.io/lamp-tinder/

Built in one session with Claude; the conversation is in [CHAT.md](CHAT.md).

## How it works
- **Generation:** `generator/gen_lamps.py` builds random lamps procedurally in Blender (table, floor, desk and pendant lamps; 9 shade profiles including mushroom, saucer and cylinder; tall-tripod floor lamps; three-shade cluster pendants; finishes, colours, glow) and renders each with EEVEE on a varied studio backdrop and camera angle. Every parameter is stored normalised to 0–1 in `out/lamps.json`.
- **Real-lamp catalog:** `tools/build_catalog.py` pulls lighting from public store feeds (IKEA Canada, Bouclair, EQ3, Mobilia, Montreal Lighting, HUTK, Schoolhouse, A+R, Illuminee, Lulu and Georgia) into `data/catalog.json`: name, brand, store link, photo URL, price, lamp type. The site hot-links each store's own photo.
- **Image fingerprints:** `tools/embed.html` runs the CLIP image model (ViT-B/32, via transformers.js) in the browser over every render and every product photo, saving int8 vectors to `data/embeddings.json`. Renders and photos are each centred on their own mean so matching depends on the lamp, not the photo style.
- **Smart card order, no fixed length:** the first cards are spread across the space of looks; after that, cards alternate between "probably a like" (to refine your style), "could go either way" (most informative), and exploration. Cards keep coming until it is confident: at least 7 likes, 20 swipes, and the #1 real-lamp match (and most of the top 3) unchanged for 6 swipes in a row (usually 20–30 swipes). A progress bar shows how close it is, and you can skip ahead at any time.
- **Likes and passes:** recommendations score each real lamp by similarity to your liked lamps, minus similarity to the ones you passed on, plus a bonus for matching your preferred lamp type.
- **Styles:** liked lamps are clustered (k-means on the fingerprints, k chosen by silhouette); distinct tastes, e.g. desk lamps and pendants, each get their own blended lamp and recommendations.
- **What your swipes say:** tag values you liked or passed on much more often than average (e.g. "♥ brass bodies", "✕ globe shades").
- **Budget:** optional price cap (CAD; US prices converted at a fixed rough rate).
- **Swiping:** drag or use the buttons/keys: right = like, left = pass, up = super-like (one per session; counts double), Backspace = undo. "Not quite? Keep swiping" goes back from the results without losing anything.
- **Blending:** each style's lamp is a weighted blend: typical and super-liked lamps count more, and the numbers are pulled halfway toward the most representative liked lamp so the result keeps some character.
- **Share links:** the results page encodes likes, super-likes, passes and budget in the URL; opening it shows the same results.
- **3D view:** `site/lamp3d.js` is a three.js port of the Blender builder. "In a room" shows the lamp at real size next to simple furniture and a 175 cm person.
- **Desk model:** `site/display.js` turns the blended lamp into a ~16 cm model that prints without supports: the shade is solid and sits on its opening (a globe is cut into two halves at its widest point), the stem, arm, cords and tripod legs print lying flat with octagonal pegs, the base prints upright with a socket, and a tripod hub prints upside down with angled leg sockets. All parts are laid out on one 220 mm plate and push together (0.25 mm clearance). Checked on all 1,200 lamps: every part fits the plate, with no unsupported overhangs beyond small socket ceilings.
- **Build it yourself:** `site/kit.js` turns the blended lamp into a zip of printable STLs (mm, Z-up, already in print orientation) designed around standard lamp hardware (1/8 IPS threaded pipe, E26 socket, cord set): a ballast base with pipe bore, a shade with 2 mm walls and a washer fitter (or socket hole for pendants/desk lamps), printed ball joints for desk lamps, a tripod hub for dowel legs, stem sleeves, a canopy for pendants. Parts wider than a 250 mm bed are cut into wedges/quadrants. The README inside has a parts list with rough CAD prices, assembly steps, safety notes, and a filament / print-time / cost estimate (also shown on the results page next to the closest real lamp's price).
- **Catalog refresh:** `.github/workflows/lamp-tinder-catalog.yml` runs weekly. It re-pulls store feeds, fingerprints only new product photos in memory (`tools/embed_new.mjs`), and keeps a store's previous listings if its feed can't be reached (most stores block GitHub's servers, so a full refresh is best run locally).

## Rebuilding (Windows + Blender 5.2; uses Blender's bundled Python)
```
generator\run.bat --count 300     # render lamps (copy generator/ files next to index.html first)
tools\build_catalog.bat           # refresh the real-lamp catalog
tools\embed.bat                   # opens the fingerprint page; click Start (thumbnails are deleted afterwards)
start-site.bat                    # local preview at http://localhost:8000
```
