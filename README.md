# julian-pietraroia.github.io

Personal portfolio — hardware &amp; manufacturing engineering.

**Live:** https://julian-pietraroia.github.io

## Stack

Plain HTML, CSS, and JavaScript. No build step, no framework — push to `main` and
GitHub Pages serves it. The only external request is the Nunito webfont.

```
index.html          all content
styles.css          soft green theme, light + dark, responsive, print styles
main.js             theme toggle, hover-to-play videos, reveal, scroll-spy
assets/projects/    project videos (see the README in there)
assets/*.pdf        resume
```

## Adding project videos

Drop an `.mp4` into `assets/projects/` using the filenames listed in
[`assets/projects/README.md`](assets/projects/README.md) and the matching card
picks it up — no code changes. Cards with no file yet show a green placeholder,
so the page never looks broken.

Videos load only when a card nears the viewport, play on hover (muted, looping),
and reset when the pointer leaves. On touch devices, where there is no hover,
whichever card is centred on screen plays instead.

## Local preview

```bash
python3 -m http.server 8000 --directory .
```

Then open http://localhost:8000.

## Updating

- **Content** — edit `index.html`; sections are commented and in page order.
- **Colors** — both palettes are in the `:root` blocks at the top of `styles.css`.
  Light is the default; `[data-theme="dark"]` overrides it.
- **Roundness** — the `--r-*` variables control every corner radius at once.
- **Resume** — replace `assets/Julian_Pietraroia_Resume.pdf`; the filename is
  referenced in the hero and the contact section.
