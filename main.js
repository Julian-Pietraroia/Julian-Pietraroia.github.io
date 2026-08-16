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

  /* Follow the system until the visitor picks a side themselves */
  prefersDark.addEventListener('change', function (e) {
    if (!stored) applyTheme(e.matches ? 'dark' : 'light');
  });

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
  var VIDEO_CAP_MS = 14000;   /* backstop if a video never fires 'ended' */

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
      var ok = function () { card.el.classList.add('has-media'); };
      slide.addEventListener('load', ok);
      slide.addEventListener('loadeddata', ok);

      if (isVideo(slide)) {
        slide.preload = 'metadata';
        /* The media fragment nudges browsers into painting a first frame */
        slide.src = slide.dataset.src + '#t=0.1';
      } else {
        slide.src = slide.dataset.src;
      }

      if (i === 0) slide.classList.add('is-active');
    });
  };

  var clearTimer = function (card) {
    if (card.timer) { window.clearTimeout(card.timer); card.timer = null; }
  };

  var advance = function (card) {
    show(card, (card.index + 1) % card.slides.length);
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
      /* Single-slide cards loop forever; a slideshow moves on when it ends */
      if (card.slides.length > 1) {
        card.timer = window.setTimeout(function () { advance(card); }, VIDEO_CAP_MS);
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

  /* A backgrounded tab keeps firing timers; pause everything until it returns */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) cards.forEach(leave);
  });

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
