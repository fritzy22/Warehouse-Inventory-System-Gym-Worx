/**
 * GymWorx Warehouse — Dynamic Sun/Moon Theme Toggle System
 * Supports automatic time-based theme selection:
 *   - Morning & daytime (6:00 AM - 5:59 PM): Light Mode with Sun icon
 *   - Evening & nighttime (6:00 PM - 5:59 AM): Dark Mode with Moon icon
 * Supports manual toggle with persistence in localStorage ('gw_theme_mode': 'auto' | 'light' | 'dark').
 */

(function (window, document) {
  'use strict';

  const THEME_STORAGE_KEY = 'gw_theme_mode';

  const SUN_SVG = `<svg class="gw-theme-icon gw-theme-icon-sun" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`;

  const MOON_SVG = `<svg class="gw-theme-icon gw-theme-icon-moon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`;

  function getAutomaticTheme() {
    const hour = new Date().getHours();
    return (hour >= 6 && hour < 18) ? 'light' : 'dark';
  }

  function getStoredThemeMode() {
    try {
      if (typeof localStorage !== 'undefined') {
        const mode = localStorage.getItem(THEME_STORAGE_KEY);
        if (mode === 'light' || mode === 'dark' || mode === 'auto') {
          return mode;
        }
      }
    } catch (e) {}
    return 'auto';
  }

  function getEffectiveTheme(mode) {
    const activeMode = mode || getStoredThemeMode();
    if (activeMode === 'light') return 'light';
    if (activeMode === 'dark') return 'dark';
    return getAutomaticTheme();
  }

  function updateThemeIconsAndUI(effectiveTheme, mode) {
    if (typeof document === 'undefined') return;
    const iconHtml = effectiveTheme === 'light' ? SUN_SVG : MOON_SVG;
    const label = effectiveTheme === 'light'
      ? 'Switch to Dark Mode (Currently Light Mode)'
      : 'Switch to Light Mode (Currently Dark Mode)';

    const desktopBtn = document.getElementById('topbarThemeToggleBtn');
    const desktopIcon = document.getElementById('topbarThemeIcon');
    if (desktopIcon) {
      desktopIcon.innerHTML = iconHtml;
    }
    if (desktopBtn) {
      desktopBtn.setAttribute('aria-label', label);
      desktopBtn.setAttribute('title', mode === 'auto'
        ? `Theme: Auto (${effectiveTheme === 'light' ? 'Light' : 'Dark'}) - Click to toggle`
        : `Theme: ${effectiveTheme === 'light' ? 'Light' : 'Dark'} - Click to toggle`);
    }

    const mobileBtn = document.getElementById('mobileThemeToggleBtn');
    const mobileIcon = document.getElementById('mobileThemeIcon');
    if (mobileIcon) {
      mobileIcon.innerHTML = iconHtml;
    }
    if (mobileBtn) {
      mobileBtn.setAttribute('aria-label', label);
      mobileBtn.setAttribute('title', mode === 'auto'
        ? `Theme: Auto (${effectiveTheme === 'light' ? 'Light' : 'Dark'})`
        : `Theme: ${effectiveTheme === 'light' ? 'Light' : 'Dark'}`);
    }

    // Update checkmark indicators in account menu
    const checks = document.querySelectorAll('.gw-theme-check[data-mode-check]');
    checks.forEach(function (chk) {
      const chkMode = chk.getAttribute('data-mode-check');
      chk.style.display = (chkMode === mode) ? 'inline-block' : 'none';
    });
  }

  function applyTheme(effectiveTheme, mode) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const html = document.documentElement;
    html.setAttribute('data-theme', effectiveTheme);
    if (effectiveTheme === 'light') {
      html.classList.remove('gw-dark-mode');
      html.classList.add('gw-light-mode');
      if (document.body) {
        document.body.classList.remove('gw-dark-mode');
        document.body.classList.add('gw-light-mode');
      }
    } else {
      html.classList.remove('gw-light-mode');
      html.classList.add('gw-dark-mode');
      if (document.body) {
        document.body.classList.remove('gw-light-mode');
        document.body.classList.add('gw-dark-mode');
      }
    }
    updateThemeIconsAndUI(effectiveTheme, mode);
  }

  function setThemeMode(mode) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(THEME_STORAGE_KEY, mode);
      }
    } catch (e) {}
    const effective = getEffectiveTheme(mode);
    applyTheme(effective, mode);
  }

  function toggleTheme() {
    const currentMode = getStoredThemeMode();
    const currentEffective = getEffectiveTheme(currentMode);
    const nextTheme = currentEffective === 'light' ? 'dark' : 'light';
    setThemeMode(nextTheme);
  }

  function checkAutomaticTheme() {
    const currentMode = getStoredThemeMode();
    if (currentMode === 'auto') {
      const activeTheme = document.documentElement ? document.documentElement.getAttribute('data-theme') : null;
      const expectedTheme = getAutomaticTheme();
      if (activeTheme !== expectedTheme) {
        applyTheme(expectedTheme, 'auto');
      }
    }
  }

  function initTheme() {
    if (typeof document === 'undefined') return;
    const mode = getStoredThemeMode();
    const effective = getEffectiveTheme(mode);
    applyTheme(effective, mode);

    const desktopBtn = document.getElementById('topbarThemeToggleBtn');
    if (desktopBtn && !desktopBtn.__gw_bound) {
      desktopBtn.__gw_bound = true;
      desktopBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTheme();
      });
    }

    const mobileBtn = document.getElementById('mobileThemeToggleBtn');
    if (mobileBtn && !mobileBtn.__gw_bound) {
      mobileBtn.__gw_bound = true;
      mobileBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleTheme();
      });
    }

    // Periodic time-check every 30 seconds
    setInterval(checkAutomaticTheme, 30000);

    // Refresh theme on visibility change
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        checkAutomaticTheme();
      }
    });
  }

  // Export functions to global scope
  window.getAutomaticTheme = getAutomaticTheme;
  window.getStoredThemeMode = getStoredThemeMode;
  window.getEffectiveTheme = getEffectiveTheme;
  window.setThemeMode = setThemeMode;
  window.toggleTheme = toggleTheme;
  window.initTheme = initTheme;

  // Initialize immediately if DOM is ready, or on DOMContentLoaded
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTheme);
    } else {
      initTheme();
    }
  }
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
