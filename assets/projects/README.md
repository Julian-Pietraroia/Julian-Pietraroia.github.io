# Project videos

Drop video files here with these exact names and the cards on the site pick them
up automatically — no code changes needed.

| File | Card | Frame shape |
|---|---|---|
| `vex-worlds.mp4` | VEX U World Championship Robots | wide (16:9) |
| `line-follower.mp4` | Line Following Robot | portrait (3:4) |
| `combat-robot.mp4` | One Pound Combat Robot | wide (16:9) |

Until a file exists, its card shows a green placeholder instead — the page never
looks broken with slots empty.

## What works best

- **H.264 MP4** — the only format that plays everywhere. `.mov` off a phone
  usually needs converting.
- **Short and looping**, 5–15 seconds. They play on hover and loop forever.
- **No audio** — the videos are muted and autoplay policies require it. Strip the
  track so you aren't shipping bytes nobody hears.
- **Keep them small**, ideally under ~5 MB each. GitHub Pages has a soft 1 GB
  repo limit and a 100 MB hard cap per file, and big videos make the page crawl.
- The frame crops to fill, so keep the subject centred.

## Converting with ffmpeg

```bash
ffmpeg -i input.mov -an -vf "scale='min(1280,iw)':-2" -c:v libx264 -crf 26 -preset slow -movflags +faststart vex-worlds.mp4
```

`-an` drops audio, `-crf 26` trades a little quality for a much smaller file
(lower = better quality), and `+faststart` lets playback begin before the whole
file arrives.

## Adding a card

Cards live in `index.html` in the `<section id="work">` block. Copy an existing
`<article class="work">`, change its `data-src` to a new filename here, set
`--ratio` on `.work__frame` to match the footage, and edit the title, blurb, and
tag. Nothing else needs wiring up.
