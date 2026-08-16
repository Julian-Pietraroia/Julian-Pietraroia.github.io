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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1712' : '#f2f8f3');
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

  /* Cards carry data-src (video) or data-img (still) rather than a real src, so
     nothing downloads until the card is near the viewport. A card only loses its
     placeholder once a real file has decoded, so empty slots stay presentable. */
  var cards = Array.prototype.slice.call(
    document.querySelectorAll('.work[data-src], .work[data-img]')
  );

  var loadCard = function (card) {
    if (card.dataset.loaded) return;
    card.dataset.loaded = '1';

    var media = card.querySelector('.work__video, .work__img');
    if (!media) return;

    media.addEventListener('load', function () { card.classList.add('has-media'); });
    media.addEventListener('loadeddata', function () { card.classList.add('has-media'); });
    media.addEventListener('error', function () { card.classList.remove('has-media'); });

    if (card.dataset.img) {
      media.src = card.dataset.img;
      return;
    }

    media.preload = 'metadata';
    /* The media fragment nudges browsers into painting a first frame as a still */
    media.src = card.dataset.src + '#t=0.1';
  };

  var play = function (card) {
    if (!card.classList.contains('has-media')) return;
    var v = card.querySelector('.work__video');
    if (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
  };

  var pause = function (card) {
    var v = card.querySelector('.work__video');
    if (v && !v.paused) { v.pause(); v.currentTime = 0.1; }
  };

  if ('IntersectionObserver' in window) {
    /* Load a little before the card arrives so the still is ready on screen */
    var loader = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        loadCard(entry.target);
        loader.unobserve(entry.target);
      });
    }, { rootMargin: '300px 0px' });

    cards.forEach(function (card) { loader.observe(card); });

    /* Touch devices have no hover, so play whatever is centred on screen */
    if (coarse && !reduceMotion) {
      var player = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) play(entry.target);
          else pause(entry.target);
        });
      }, { threshold: 0.6 });

      cards.forEach(function (card) { player.observe(card); });
    }
  } else {
    cards.forEach(loadCard);
  }

  if (!coarse) {
    cards.forEach(function (card) {
      card.addEventListener('mouseenter', function () { loadCard(card); play(card); });
      card.addEventListener('mouseleave', function () { pause(card); });
      /* Keyboard users get the same preview when the card's links take focus */
      card.addEventListener('focusin', function () { loadCard(card); play(card); });
      card.addEventListener('focusout', function () { pause(card); });
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
