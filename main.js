/* Julian Pietraroia — portfolio interactions.
   Scroll reveal + section scroll-spy. No dependencies. */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Current year in the footer */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* Reveal elements as they enter the viewport */
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
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealables.forEach(function (el, i) {
      /* Stagger siblings slightly so groups cascade rather than pop */
      el.style.transitionDelay = (Math.min(i % 6, 5) * 55) + 'ms';
      revealObserver.observe(el);
    });
  }

  /* Highlight the nav link for whichever section is in view */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.sidenav__list a')
  );
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    var visible = new Set();

    var setActive = function () {
      var active = null;
      /* Pick the visible section nearest the top of the document order */
      sections.forEach(function (section) {
        if (visible.has(section) && !active) active = section;
      });
      navLinks.forEach(function (link) {
        var isActive = active && link.getAttribute('href') === '#' + active.id;
        link.classList.toggle('is-active', Boolean(isActive));
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
