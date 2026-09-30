/**
 * Estado compartido del renderer.
 *
 * Durante la migración arquitectónica este objeto sirve como frontera
 * entre módulos. Las variables legacy se irán trasladando aquí por fases
 * sin cambiar el comportamiento visible del launcher.
 */
const appState = {
  navigation: { currentView: null },
  instances: { list: [], active: null, running: new Set() },
  profiles: { active: null, list: [] },
  servers: { list: [], favorite: null, selected: null },
  modrinth: { page: 1, query: '', filters: {} },
  downloads: { active: [], history: [] },
  instance: { detailPath: null },
  dashboard: { lastUpdated: null },
  tools: { terminalEntries: [], terminalFilter: 'all', terminalSearch: '' }
};

if (typeof window !== 'undefined') {
  window.mineSteamState = appState;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = appState;
}
