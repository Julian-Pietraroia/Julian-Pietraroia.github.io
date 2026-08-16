# julian-pietraroia.github.io

Personal portfolio for hardware and manufacturing engineering.

**Live:** https://julian-pietraroia.github.io

## Stack

Plain HTML, CSS, and JavaScript. No build step and no framework. Push to `main` and
GitHub Pages serves it. The only external request is the Nunito webfont.

```
index.html          all content
styles.css          soft red theme, light + dark, responsive, print styles
main.js             theme toggle, autoplay slideshows, reveal, scroll-spy
assets/projects/    project videos and stills (see the README in there)
assets/*.pdf        resume
```

## Adding the hero banner

Save a wide photo as `assets/banner.jpg` and it appears across the top of the
hero. No file means no banner: the strip stays hidden rather than showing an
empty box, so the page looks deliberate either way.

Two knobs in `styles.css`, both on `.banner`:

- `aspect-ratio` (`1000 / 280`) sets how tall the strip is.
- `object-position` on `.banner__img` (`center 55%`) picks which horizontal band
  of the photo survives the crop. Lower percentages keep more of the top.

## Adding project videos

Drop an `.mp4` into `assets/projects/` using the filenames listed in
[`assets/projects/README.md`](assets/projects/README.md) and the matching card
picks it up with no code changes. Cards with no file yet show a placeholder,
so the page never looks broken.

Videos load only when a card nears the viewport, then autoplay muted and pause
again once the card scrolls away, so nothing offscreen is burning battery. A
card holding more than one file runs as a slideshow with dots you can click.
Visitors who ask for reduced motion get the first frame and no autoplay.

## Local preview

```bash
python3 -m http.server 8000 --directory .
```

Then open http://localhost:8000.

## Updating

- **Content** lives in `index.html`; sections are commented and in page order.
- **Colors** are the `:root` blocks at the top of `styles.css`.
  Light is the default; `[data-theme="dark"]` overrides it.
- **Roundness** is the `--r-*` variables, which control every corner at once.
- **Resume**: replace `assets/Julian_Pietraroia_Resume.pdf`. The filename is
  referenced in the hero and the contact section.
