/**
 * GymWorx Warehouse - Login Screen Animation Controller
 * Minimalist, high-performance entrance animation with reduced-motion support.
 */

let loginAnimations = [];

function startLoginAnimation() {
  const authScreen = document.getElementById('authScreen');
  if (!authScreen || authScreen.hidden) return;

  const card = document.getElementById('loginCard');
  if (card && typeof card.animate === 'function') {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      const anim = card.animate([
        { opacity: 0.85, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], {
        duration: 240,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'forwards'
      });
      loginAnimations.push(anim);
    }
  }
}

function stopLoginAnimation() {
  loginAnimations.forEach(function (a) {
    try { a.cancel(); } catch (e) {}
  });
  loginAnimations = [];
}

document.addEventListener('DOMContentLoaded', function () {
  const authScreen = document.getElementById('authScreen');
  if (authScreen && !authScreen.hidden) {
    startLoginAnimation();
  }
});
