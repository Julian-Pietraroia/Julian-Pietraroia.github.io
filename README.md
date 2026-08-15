# julian-pietraroia.github.io

Personal portfolio — hardware &amp; manufacturing engineering.

**Live:** https://julian-pietraroia.github.io

## Stack

Plain HTML, CSS, and JavaScript. No build step, no dependencies, no framework —
push to `main` and GitHub Pages serves it.

```
index.html    all content
styles.css    dark technical theme, responsive, print styles
main.js       scroll reveal + nav scroll-spy
assets/       resume PDF
```

## Local preview

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Updating

- **Content** — edit `index.html` directly; sections are commented and in page order.
- **Colors** — the palette lives in the `:root` block at the top of `styles.css`.
- **Resume** — replace `assets/Julian_Pietraroia_Resume.pdf`. The filename is
  referenced in the hero and the contact section.
