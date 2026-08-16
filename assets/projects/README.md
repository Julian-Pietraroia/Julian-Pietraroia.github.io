# Project media

Each Work card points at one file here. Replace a file with a better take and
the card picks it up, no code changes needed.

| File | Card | Frame shape | Source |
|---|---|---|---|
| `vex-worlds.mp4` | VEX U World Championship Robots | portrait (3:4) | IMG_7703.MOV |
| `line-follower.mp4` | Line Following Robot | wide (16:9) | IMG_8224.MOV |
| `line-follower-electronics.jpg` | Line Follower Internals | portrait (3:4) | IMG_8215.HEIC |
| `combat-robot.mp4` | One Pound Combat Robot | portrait (3:4) | 15bcedb2....MP4 |

If a file is missing, its card falls back to a green placeholder rather than
breaking the page.

## What works best

- **H.264 MP4** is the only video format that plays everywhere. HEVC, which is
  what an iPhone records by default, does not play in Chrome or Firefox and has
  to be converted.
- **Short and looping**, 5 to 15 seconds. Cards play on hover and loop forever.
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

## Adding a card

Cards live in `index.html` in the `<section id="work">` block. Copy an existing
`<article class="work">` and point it at a new file here:

- **Video card**: `data-src="assets/projects/your-clip.mp4"` with a
  `<video class="work__video" muted loop playsinline preload="none">` inside.
- **Image card**: `data-img="assets/projects/your-photo.jpg"` with an
  `<img class="work__img" alt="...">` inside.

Then set `--ratio` on `.work__frame` to match the footage and edit the title,
blurb, and tag. Nothing else needs wiring up.
