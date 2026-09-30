/**
 * MineSteam renderer bootstrap.
 *
 * Keeps application startup separate from the legacy renderer module while
 * preserving the existing global functions used by the UI.
 */
(() => {
  let started = false;

  async function startRenderer() {
    if (started) return;
    started = true;

    console.log('MineSteam iniciado');

    try {
      const appInfo = await window.launcherAPI.getAppInfo?.();
      if (appInfo?.version) {
        document.documentElement.dataset.appVersion = appInfo.version;
      }
      console.log(`MineSteam v${appInfo?.version || 'desconocida'}`);
    } catch (error) {
      console.warn('No se pudo obtener la información de la aplicación:', error?.message || error);
    }

    setupNavigation();
    setupEventListeners();
    setupModal();
    setupModalInstalacion();
    setupSkinModal();
    loadInstances();
    displayInstances();
    updateActivityGrid();
    checkSession();
    loadLatestVersion();
    setupRamSlider();
    setupLoaderButtons();
    updateCacheSize();
    setupProgressBar();
    updateProfileAvatar(null);
    updateFeaturedModpack();
    restoreFilters();
    setupHamburger();
    setupClearSearch();
    setupContentManager();
    loadAccounts();
    setupOptimizer();
    setupCrashAnalyzer();
    setupAppUpdater();
    setupProfilesServers();

    // Features added in later MineSteam versions are initialized here once,
    // after the DOM and the base renderer are ready.
    setupMineSteam240();
    setupMineSteam25Navigation();

    console.log('MineSteam renderer inicializado.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRenderer, { once: true });
  } else {
    startRenderer();
  }
})();
