(function() {
  try {
    // The stored setting is the authority; the OS preference only decides
    // 'system' and first load. Reading it here rather than after
    // hydration is what stops the wrong theme flashing on every load —
    // IndexedDB, where the setting actually lives, cannot be read
    // synchronously before paint, so App.tsx mirrors it to localStorage.
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch {}

    // Match what App.tsx will apply, exactly: an explicit choice wins,
    // 'system' follows the OS, and nothing stored means the app's own
    // default of dark. Any other answer here is a flash.
    var prefersDark = !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    var isDark = stored === 'light' ? false : (stored === 'system' ? prefersDark : true);

    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(isDark ? 'dark' : 'light');
  } catch {}
})();
