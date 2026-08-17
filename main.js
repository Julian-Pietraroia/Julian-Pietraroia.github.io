/* Julian Pietraroia portfolio interactions.
   Theme toggle, hover-to-play work videos, reveal, scroll-spy. No dependencies. */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(hover: none)').matches;

  /* ── Theme ─────────────────────────────────────────────── */

  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  var applyTheme = function (theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#17100f' : '#fdf6f5');
  };

  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) { /* private mode */ }
  applyTheme(stored || (prefersDark.matches ? 'dark' : 'light'));

  /* Follow the system until the visitor picks a side themselves.
     addEventListener on a MediaQueryList is Safari 14+; older WebKit only has
     addListener, and calling the missing one throws and kills everything below. */
  var onSchemeChange = function (e) {
    if (!stored) applyTheme(e.matches ? 'dark' : 'light');
  };
  if (prefersDark.addEventListener) prefersDark.addEventListener('change', onSchemeChange);
  else if (prefersDark.addListener) prefersDark.addListener(onSchemeChange);

  var toggle = document.querySelector('.themetoggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      stored = next;
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    });
  }

  /* Current year in the footer */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ── Hero banner ───────────────────────────────────────── */

  /* Loaded eagerly rather than through the observers below: it is display:none
     until the file decodes, and observers never fire on a zero-size element.
     No file means no banner, which is the intended empty state. */
  var banner = document.querySelector('.banner[data-img]');
  if (banner) {
    var bannerImg = banner.querySelector('.banner__img');
    if (bannerImg) {
      bannerImg.addEventListener('load', function () { banner.classList.add('has-media'); });
      bannerImg.src = banner.dataset.img;
    }
  }

  /* ── Work videos ───────────────────────────────────────── */

  /* Slides carry data-src rather than a real src, so nothing downloads until the
     card is near the viewport. A card only loses its placeholder once the first
     file has decoded, so empty slots stay presentable. Cards with more than one
     slide run as a slideshow: a video slide holds until it finishes, a still
     holds for STILL_MS. */
  var STILL_MS = 4500;
  var VIDEO_CAP_FALLBACK_MS = 20000;  /* only used when duration is unknown */

  var cards = Array.prototype.slice.call(document.querySelectorAll('.work'))
    .map(function (card) {
      return {
        el: card,
        slides: Array.prototype.slice.call(card.querySelectorAll('.slide[data-src]')),
        index: 0,
        timer: null,
        loaded: false,
        inView: false
      };
    })
    .filter(function (card) { return card.slides.length; });

  var isVideo = function (el) { return el.tagName === 'VIDEO'; };

  var loadCard = function (card) {
    if (card.loaded) return;
    card.loaded = true;

    card.slides.forEach(function (slide, i) {
      /* Nothing is shown until a file actually decodes, so a slot still waiting
         on footage never becomes a blank frame in the rotation */
      var ok = function () {
        card.el.classList.add('has-media');
        if (!card.el.querySelector('.slide.is-active')) show(card, i);
      };
      slide.addEventListener('load', ok);
      slide.addEventListener('loadeddata', ok);

      slide.addEventListener('error', function () {
        slide.dataset.failed = '1';
        if (card.dots && card.dots[i]) card.dots[i].hidden = true;
        if (card.dotsEl && usable(card).length < 2) card.dotsEl.hidden = true;
        if (slide.classList.contains('is-active')) advance(card);
      });

      if (isVideo(slide)) {
        slide.preload = 'metadata';
        /* The media fragment nudges browsers into painting a first frame */
        slide.src = slide.dataset.src + '#t=0.1';
      } else {
        slide.src = slide.dataset.src;
      }
    });
  };

  var usable = function (card) {
    return card.slides.filter(function (s) { return s.dataset.failed !== '1'; });
  };

  var clearTimer = function (card) {
    if (card.timer) { window.clearTimeout(card.timer); card.timer = null; }
  };

  /* Step to the next slide that actually loaded, wrapping around */
  var advance = function (card) {
    var n = card.slides.length;
    for (var step = 1; step <= n; step++) {
      var next = (card.index + step) % n;
      if (card.slides[next].dataset.failed !== '1') { show(card, next); return; }
    }
  };

  /* Declared with var so `advance` above can reference it before assignment */
  var show = function (card, next) {
    clearTimer(card);

    var current = card.slides[card.index];
    if (current && isVideo(current)) current.pause();

    card.index = next;
    card.slides.forEach(function (slide, i) {
      slide.classList.toggle('is-active', i === next);
    });

    var slide = card.slides[next];
    if (!card.inView) return;

    if (isVideo(slide)) {
      slide.currentTime = 0;
      var p = slide.play();
      if (p && p.catch) p.catch(function () {});
      /* Single-slide cards loop forever; a slideshow moves on when it ends.
         The timer is only a backstop for a missing 'ended', so it has to clear
         the clip's real length or it truncates playback every cycle. */
      if (card.slides.length > 1) {
        var cap = (isFinite(slide.duration) && slide.duration > 0)
          ? slide.duration * 1000 + 2000
          : VIDEO_CAP_FALLBACK_MS;
        card.timer = window.setTimeout(function () { advance(card); }, cap);
      }
    } else if (card.slides.length > 1) {
      card.timer = window.setTimeout(function () { advance(card); }, STILL_MS);
    }
  };

  var enter = function (card) {
    card.inView = true;
    loadCard(card);
    show(card, card.index);
  };

  var leave = function (card) {
    card.inView = false;
    clearTimer(card);
    var slide = card.slides[card.index];
    if (slide && isVideo(slide)) slide.pause();
  };

  cards.forEach(function (card) {
    card.slides.forEach(function (slide) {
      if (!isVideo(slide) || card.slides.length < 2) return;
      slide.addEventListener('ended', function () { advance(card); });
    });

    /* Dots for multi-slide cards, so the card reads as a slideshow and can be
       driven by hand rather than only on the timer */
    if (card.slides.length > 1) {
      var dots = document.createElement('div');
      dots.className = 'work__dots';
      card.slides.forEach(function (slide, i) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'work__dot';
        dot.setAttribute('aria-label', 'Show item ' + (i + 1) + ' of ' + card.slides.length);
        dot.addEventListener('click', function () { show(card, i); });
        dots.appendChild(dot);
      });
      card.el.querySelector('.work__frame').appendChild(dots);
      card.dotsEl = dots;
      card.dots = Array.prototype.slice.call(dots.children);
    }
  });

  /* Keep the dots in step with whatever is showing */
  var syncDots = function (card) {
    if (!card.dots) return;
    card.dots.forEach(function (dot, i) {
      dot.classList.toggle('is-on', i === card.index);
    });
  };
  var rawShow = show;
  show = function (card, next) { rawShow(card, next); syncDots(card); };

  if ('IntersectionObserver' in window) {
    /* Load a little before the card arrives so the first frame is ready */
    var loader = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target._card;
        loadCard(card);
        loader.unobserve(entry.target);
      });
    }, { rootMargin: '300px 0px' });

    /* Playback follows visibility: autoplay on the way in, stop on the way out
       so offscreen cards aren't burning battery */
    var player = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var card = entry.target._card;
        if (entry.isIntersecting) enter(card);
        else leave(card);
      });
    }, { threshold: 0.25 });

    cards.forEach(function (card) {
      card.el._card = card;
      loader.observe(card.el);
      if (!reduceMotion) player.observe(card.el);
    });

    /* Reduced motion: load the media and hold the first slide, no autoplay */
    if (reduceMotion) cards.forEach(loadCard);
  } else {
    cards.forEach(function (card) { loadCard(card); enter(card); });
  }

  /* A backgrounded tab keeps firing timers, so pause on the way out. Coming
     back needs an explicit restart: IntersectionObserver only fires when a card
     crosses the threshold, and one that was visible throughout never crosses,
     so without this the grid stays frozen. Opening the resume in a new tab hits
     this every time. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cards.forEach(leave); return; }

    var vh = window.innerHeight || document.documentElement.clientHeight;
    cards.forEach(function (card) {
      var r = card.el.getBoundingClientRect();
      if (r.top < vh * 0.75 && r.bottom > vh * 0.25) enter(card);
    });
  });

  /* ── Lightbox ──────────────────────────────────────────── */

  /* Cards render ~344px wide, which is far too small to read a dimensioned
     drawing. Clicking one opens it full size. Built on <dialog>.showModal so
     focus trapping, Esc-to-close and background inerting come from the
     browser rather than hand-rolled listeners. */
  var lb = document.querySelector('.lightbox');

  if (lb && typeof lb.showModal === 'function') {
    var lbStage   = lb.querySelector('.lightbox__stage');
    var lbCaption = lb.querySelector('.lightbox__caption');
    var lbPrev    = lb.querySelector('.lightbox__nav--prev');
    var lbNext    = lb.querySelector('.lightbox__nav--next');
    var lbClose   = lb.querySelector('.lightbox__close');
    var lbCard = null;
    var lbIndex = 0;

    var lbRender = function () {
      var slide = lbCard.slides[lbIndex];
      var label = slide.getAttribute('alt') || slide.getAttribute('aria-label') || '';
      lbStage.innerHTML = '';

      var node;
      if (isVideo(slide)) {
        node = document.createElement('video');
        node.src = slide.dataset.full || slide.dataset.src;
        node.controls = true;
        node.autoplay = true;
        node.loop = true;
        node.muted = true;
        node.playsInline = true;
        node.setAttribute('aria-label', label);
      } else {
        node = document.createElement('img');
        /* data-full is the unpadded, full-resolution original where one exists */
        node.src = slide.dataset.full || slide.dataset.src;
        node.alt = label;
      }
      lbStage.appendChild(node);

      var title = lbCard.el.querySelector('h3');
      var count = lbCard.slides.length > 1
        ? ' (' + (lbIndex + 1) + ' of ' + lbCard.slides.length + ')' : '';
      lbCaption.textContent = (title ? title.textContent.trim() : '') + count;
    };

    var lbStep = function (delta) {
      var n = lbCard.slides.length;
      for (var i = 1; i <= n; i++) {
        var next = (lbIndex + delta * i + n * n) % n;
        if (lbCard.slides[next].dataset.failed !== '1') { lbIndex = next; lbRender(); return; }
      }
    };

    var lbOpen = function (card) {
      lbCard = card;
      lbIndex = card.index;
      lb.classList.toggle('lightbox--solo', usable(card).length < 2);
      lbRender();
      lb.showModal();
      /* The card's own deck keeps running behind the dialog otherwise */
      leave(card);
    };

    /* Idempotent, and called from every dismissal path rather than only from
       the dialog's own 'close' event. That event is not reliably delivered
       everywhere, and missing it would leave the enlarged video decoding
       behind a closed dialog. */
    var lbCleanup = function () {
      if (!lbCard) return;
      lbStage.innerHTML = '';   /* stops the enlarged video decoding */
      /* Restart the card only if it is still on screen. The observer will not
         re-fire for a card that never moved while the dialog was open. */
      var r = lbCard.el.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      if (r.top < vh && r.bottom > 0) enter(lbCard);
      lbCard = null;
    };

    var lbDismiss = function () {
      lbCleanup();
      if (lb.open) lb.close();
    };

    lb.addEventListener('close', lbCleanup);
    lb.addEventListener('cancel', lbCleanup);   /* Esc */
    lbClose.addEventListener('click', lbDismiss);
    lbPrev.addEventListener('click', function () { lbStep(-1); });
    lbNext.addEventListener('click', function () { lbStep(1); });

    /* Clicking the backdrop closes. The dialog fills the viewport, so compare
       against the stage rather than the dialog box itself. */
    lb.addEventListener('click', function (e) {
      if (e.target === lb) lbDismiss();
    });

    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); lbStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); lbStep(-1); }
    });

    cards.forEach(function (card) {
      var frame = card.el.querySelector('.work__frame');
      if (!frame) return;
      var title = card.el.querySelector('h3');
      var zoom = document.createElement('button');
      zoom.type = 'button';
      zoom.className = 'work__zoom';
      zoom.setAttribute('aria-label',
        'View ' + (title ? title.textContent.trim() : 'this project') + ' larger');
      zoom.addEventListener('click', function () { lbOpen(card); });
      frame.appendChild(zoom);
    });
  }

  /* ── Reveal on scroll ──────────────────────────────────── */

  var revealables = document.querySelectorAll('.reveal');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

    revealables.forEach(function (el, i) {
      /* Stagger siblings slightly so groups cascade rather than pop */
      el.style.transitionDelay = (Math.min(i % 5, 4) * 60) + 'ms';
      revealObserver.observe(el);
    });

    /* Fail open. Observer callbacks don't run while a document is hidden, so a
       tab restored in the background (or any browser that withholds them) would
       otherwise sit at opacity 0. If nothing has revealed by now, the observer
       isn't delivering: show everything rather than serve a blank page. */
    window.setTimeout(function () {
      if (document.querySelector('.reveal.is-visible')) return;
      revealables.forEach(function (el) {
        el.style.transitionDelay = '0ms';
        el.classList.add('is-visible');
      });
      cards.forEach(loadCard);
    }, 1500);
  }

  /* ── Nav scroll-spy ────────────────────────────────────── */

  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.pillnav__list a'));
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var visible = new Set();

    var setActive = function () {
      var active = null;
      sections.forEach(function (section) {
        if (visible.has(section) && !active) active = section;
      });
      navLinks.forEach(function (link) {
        link.classList.toggle('is-active', Boolean(active) && link.getAttribute('href') === '#' + active.id);
      });
    };

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      setActive();
    }, { rootMargin: '-45% 0px -45% 0px' });

    sections.forEach(function (section) { spy.observe(section); });
  }
})();
