# Project media

Each Work card points at one file here. Replace a file with a better take and
the card picks it up, no code changes needed.

| File | Card | Slide | Source |
|---|---|---|---|
| `vex-worlds.mp4` | VEX U World Championship | only | IMG_7703.MOV |
| `vex-shooter.mp4` | Shooting & Catching Robots | 1 of 2 | **needed** |
| `vex-over-under.mp4` | Shooting & Catching Robots | 2 of 2 | c400591b....mov, 2s-17s |
| `vex-ring-stacker.mp4` | Ring Stacking & Shooting Robot | only | IMG_1754.MOV |
| `vex-climber.mp4` | Climbing Robot | only | IMG_6574.MOV |
| `line-follower.mp4` | Line Following Robot | 1 of 2 | IMG_8224.MOV |
| `line-follower-electronics.jpg` | Line Following Robot | 2 of 2 | IMG_8215.HEIC |
| `rc-car-driving.mp4` | RC Car, Designed for 20,000 Units | 1 of 4 | 460f0c72....MP4 |
| `rc-car.mp4` | RC Car, Designed for 20,000 Units | 2 of 4 | 15bcedb2....MP4 |
| `rc-rollcage-drawing.jpg` | RC Car, Designed for 20,000 Units | 3 of 4 | MANU 330 SP2, p33 |
| `rc-halo-mold.jpg` | RC Car, Designed for 20,000 Units | 4 of 4 | MANU 330 SP2, p35 |

The two drawings are extracted from the MANU 330 sub-project reports with
`pdfimages`, then padded to **square** on white. That card mixes portrait phone
video with landscape drawings, and a 1:1 frame is the only ratio that holds both
without wrecking one of them: square drawings fill it exactly, and the portrait
clips crop top and bottom where the subject is centred anyway. The white pad is
invisible against the drawings' own white background.

Only figures whose title block reads JULIAN PIETRAROIA are used; the reports
also contain teammates' drawings and FMEAs, which are theirs, not his.

**Do not publish the source PDFs.** Their title pages carry six students' full
names and student numbers.

A card whose files are all missing shows a placeholder instead of breaking. In a
slideshow a single missing file is skipped: the deck runs on the slides that did
load and hides the dot for the one that did not, so the slot marked **needed**
can be filled in whenever the footage exists.

## What works best

- **H.264 MP4** is the only video format that plays everywhere. HEVC, which is
  what an iPhone records by default, does not play in Chrome or Firefox and has
  to be converted.
- **Short**, 5 to 15 seconds. Videos autoplay when a card scrolls into view and
  pause when it leaves. A card with one video loops it; in a slideshow the video
  plays once and hands over to the next slide.
- **No audio.** Playback is muted regardless, so the track is wasted bytes.
- **Keep them small**, ideally under about 3 MB. GitHub Pages has a soft 1 GB
  repo limit and a 100 MB hard cap per file, and heavy videos make the page
  crawl on mobile data.
- The frame crops to fill, so keep the subject centred.

## Converting

No ffmpeg needed. macOS ships `avconvert`, which handles HEVC to H.264:

```bash
avconvert --source IMG_1234.MOV --output line-follower.mp4 --preset PresetMediumQuality --replace
```

`PresetMediumQuality` is the sweet spot: it took a 31 MB HEVC clip down to
1.3 MB. `Preset1280x720` and `Preset960x540` keep more detail but ran 5 to 17 MB
for the same 12 seconds. Check the result plays in Chrome, not just QuickTime.

Stills come off an iPhone as HEIC, which Safari renders but other browsers do
not. Convert and resize in one step:

```bash
sips -s format jpeg -s formatOptions 82 -Z 1400 IMG_1234.HEIC --out photo.jpg
```

If you do have ffmpeg, it gives finer control over the size/quality trade:

```bash
ffmpeg -i input.mov -an -vf "scale='min(1280,iw)':-2" -c:v libx264 -crf 26 -preset slow -movflags +faststart out.mp4
```

## Adding a card or a slide

Cards live in `index.html` in the `<section id="work">` block. Every piece of
media is a `.slide` carrying `data-src`, and a card with two or more slides
becomes a slideshow automatically, dots and all.

```html
<video class="slide work__video" data-src="assets/projects/clip.mp4"
       muted playsinline preload="none"></video>
<img class="slide work__img" data-src="assets/projects/photo.jpg" alt="...">
```

Add `loop` to a video only when it is the card's single slide. In a slideshow
the video must end for the deck to advance, so a looping video would stall it.

Set `--ratio` on `.work__frame` to suit the media, and note that every slide in
a card shares that one frame, so mixed orientations get cropped to fit. Then
edit the title, blurb, and tag. Nothing else needs wiring up.
