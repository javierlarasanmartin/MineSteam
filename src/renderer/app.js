// Oculta imágenes que fallan al cargar (reemplaza a onerror inline, incompatible con la CSP).
document.addEventListener('error', event => {
    const el = event.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) el.style.display = 'none';
}, true);

import { sanitizeName, formatBytes, timeAgo, escapeHtml } from './modules/utils.js';
import appState from './state/appState.js';
import { setupNavigation } from './modules/navigation.js';
import { loadInstances, displayInstances, setupInstanceFilters } from './modules/instances.js';
import { initProfilesServers, loadProfilesPage, loadServersPage } from './modules/profilesServers.js';
import { initModrinth, searchModpacks, loadModInstanceSelector, updateExploreMode, resetModrinthPage } from './modules/modrinth.js';
import { initContentManager, loadContentInstances, loadContent, getContentType } from './modules/content.js';
import { loadToolInstances, loadJavaManager, terminalOpen, terminalAppend, renderTerminal, setupCrashAnalyzer, setupOptimizer, openInstanceBackupsModal, createCurrentInstanceBackup } from './modules/tools.js';
import { updateActivityGrid, updateLibrary, updateFeaturedModpack, updateSteamDashboard25, setupDashboardNavigation } from './modules/dashboard.js';
import { initUIServices, mostrarMensaje, checkSession, loginOffline, logout, updateProfileUI, updateCacheSize, clearCache, loadAccounts, setupAppUpdater } from './modules/uiServices.js';
import { initInstanceUI, importZipHandler, abrirModal, abrirModalInstalacion, launchGame, openInstanceDetails, closeInstanceDetails, checkDetailUpdates, exportCurrentInstance, backupSelectedWorld as backupSelectedWorldModule, setupProgressBar, setupRamSlider, setupLoaderButtons, loadLatestVersion, runningInstances } from './modules/instanceUI.js';

// Estado global
let currentView = 'page-inicio';
appState.navigation.currentView = currentView;
let pendingInstallId = null;
let currentSkinUrl = localStorage.getItem('skinUrl') || '';
let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory') || '[]');


// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    console.log('MineSteam iniciado');
    initUIServices({ updateProfileAvatar, loadAccounts });
    
    initInstanceUI({ loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje, terminalOpen, terminalAppend, updateProfileAvatar });

    setupNavigation({
        getCurrentView: () => currentView,
        setCurrentView: value => { currentView = value; appState.navigation.currentView = value; },
        displayInstances,
        loadProfilesPage,
        loadServersPage,
        loadToolInstances,
        loadJavaManager,
        loadContentInstances,
        loadContent,
        updateCacheSize,
        searchModpacks
    });
    setupInstanceFilters();
    setupEventListeners();
    setupSkinModal();
    loadInstances();
    displayInstances();
    updateActivityGrid();
    checkSession();
    updateCacheSize();
    updateProfileAvatar(null);
    updateFeaturedModpack({ launchGame });
    restoreFilters();
    setupHamburger();
    setupClearSearch();
    initContentManager({ onMessage: mostrarMensaje });
    loadAccounts();
    setupOptimizer({ mostrarMensaje });
    setupCrashAnalyzer({ mostrarMensaje });
    setupAppUpdater();
    initProfilesServers({ mostrarMensaje, displayInstances, updateSteamDashboard25 });
    initModrinth({ mostrarMensaje, addDownloadHistory, abrirModalInstalacion });
});

// Hamburguesa
function setupHamburger() {
    const leftBtn = document.getElementById('hamburger-left');
    const sidebar = document.getElementById('sidebar');
    leftBtn?.addEventListener('click', () => sidebar?.classList.toggle('open'));
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 992 && sidebar?.classList.contains('open') && !sidebar.contains(e.target) && e.target !== leftBtn) {
            sidebar.classList.remove('open');
        }
    });
}

// Limpiar búsqueda
function setupClearSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    input?.addEventListener('input', () => {
        clearBtn.classList.toggle('visible', input.value.length > 0);
    });
    clearBtn?.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.remove('visible');
        input.focus();
        resetModrinthPage();
        searchModpacks();
    });
}

// Filtros persistentes
function saveFilters() {
    const category = document.getElementById('filter-category').value;
    const loader = document.getElementById('filter-loader').value;
    const version = document.getElementById('filter-version').value;
    const sort = document.getElementById('filter-sort')?.value || 'relevance';
    localStorage.setItem('filters', JSON.stringify({ category, loader, version, sort }));
}
function restoreFilters() {
    const saved = localStorage.getItem('filters');
    if (saved) {
        const { category, loader, version, sort } = JSON.parse(saved);
        if (category) document.getElementById('filter-category').value = category;
        if (loader) document.getElementById('filter-loader').value = loader;
        if (version) document.getElementById('filter-version').value = version;
        if (sort && document.getElementById('filter-sort')) document.getElementById('filter-sort').value = sort;
    }
}


// Navegación


// Event listeners
function setupEventListeners() {
    document.getElementById('search-btn')?.addEventListener('click', searchModpacks);
    document.getElementById('explore-type')?.addEventListener('change', updateExploreMode);
    loadModInstanceSelector();
    document.getElementById('search-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchModpacks();
    });
    document.querySelectorAll('.filters-container select').forEach(select => {
        select.addEventListener('change', () => {
            saveFilters();
            resetModrinthPage();
            const input = document.getElementById('search-input');
            if (input) searchModpacks();
        });
    });
    document.getElementById('btn-crear-instancia-header')?.addEventListener('click', abrirModal);
    document.getElementById('btn-crear-instancia-desde-mods')?.addEventListener('click', abrirModal);
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
        loadInstances();
        displayInstances();
            updateActivityGrid();
    });
    document.getElementById('btn-refresh-instances')?.addEventListener('click', () => {
        loadInstances();
        displayInstances();
            updateActivityGrid();
    });
    const importBtn = document.getElementById('btn-importar');
    const zipInput = document.getElementById('import-zip');
    if (importBtn && zipInput) {
        importBtn.addEventListener('click', () => zipInput.click());
        zipInput.addEventListener('change', importZipHandler);
    }
    document.getElementById('login-offline-btn')?.addEventListener('click', loginOffline);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('btn-clear-cache')?.addEventListener('click', clearCache);
    document.getElementById('btn-refresh-tools')?.addEventListener('click', () => { loadToolInstances(); loadJavaManager(); });
}

// Skins
function setupSkinModal() {
    const modal = document.getElementById('modal-skin');
    const closeBtn = document.getElementById('modal-skin-close');
    const cancelBtn = document.getElementById('btn-skin-cancel');
    const applyBtn = document.getElementById('btn-skin-apply');
    const resetBtn = document.getElementById('btn-skin-reset');
    const inputUrl = document.getElementById('skin-url');
    const preview = document.getElementById('skin-preview');

    document.getElementById('change-skin-btn')?.addEventListener('click', () => {
        modal.classList.add('show');
        document.getElementById('form-skin').style.display = 'block';
        document.getElementById('modal-skin-loading').style.display = 'none';
        if (currentSkinUrl) {
            inputUrl.value = currentSkinUrl;
            preview.src = currentSkinUrl;
            preview.style.display = 'block';
        } else {
            inputUrl.value = '';
            preview.style.display = 'none';
        }
        inputUrl.focus();
        inputUrl.select();
    });

    function closeModal() {
        modal.classList.remove('show');
        document.getElementById('form-skin').style.display = 'block';
        document.getElementById('modal-skin-loading').style.display = 'none';
    }
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    inputUrl?.addEventListener('input', () => {
        const url = inputUrl.value.trim();
        if (url) {
            preview.src = url;
            preview.style.display = 'block';
            preview.onerror = () => { preview.style.display = 'none'; };
        } else {
            preview.style.display = 'none';
        }
    });

    applyBtn?.addEventListener('click', async () => {
        const url = inputUrl.value.trim();
        if (!url) { mostrarMensaje('⚠️ Ingresa una URL de skin'); return; }
        try {
            const response = await fetch(url, { method: 'HEAD' });
            if (!response.headers.get('content-type')?.includes('image')) {
                mostrarMensaje('❌ La URL no es una imagen válida');
                return;
            }
        } catch (e) {
            mostrarMensaje('❌ No se pudo verificar la URL');
            return;
        }
        document.getElementById('form-skin').style.display = 'none';
        document.getElementById('modal-skin-loading').style.display = 'block';
        try {
            localStorage.setItem('skinUrl', url);
            currentSkinUrl = url;
            updateProfileAvatar(url);
            mostrarMensaje('✅ Skin actualizada');
            closeModal();
        } catch (e) {
            mostrarMensaje('❌ Error: ' + e.message);
        } finally {
            document.getElementById('form-skin').style.display = 'block';
            document.getElementById('modal-skin-loading').style.display = 'none';
        }
    });

    resetBtn?.addEventListener('click', () => {
        localStorage.removeItem('skinUrl');
        currentSkinUrl = '';
        updateProfileAvatar(null);
        mostrarMensaje('🔄 Skin restaurada');
        closeModal();
    });
}

function updateProfileAvatar(userNameOrUrl) {
    const avatar = document.getElementById('profile-avatar');
    if (!avatar) return;
    if (userNameOrUrl && userNameOrUrl.startsWith('http')) {
        avatar.src = userNameOrUrl;
        avatar.style.borderColor = 'var(--accent)';
        return;
    }
    const skinUrl = localStorage.getItem('skinUrl');
    if (skinUrl) {
        avatar.src = skinUrl;
        avatar.style.borderColor = '#2ecc71';
        return;
    }
    const name = userNameOrUrl || 'steve';
    avatar.src = `https://mc-heads.net/avatar/${name}/128`;
    avatar.style.borderColor = 'var(--accent)';
}

// Historial de descargas
function addDownloadHistory(name, source) {
    downloadHistory.unshift({ name, source, time: new Date().toISOString() });
    if (downloadHistory.length > 20) downloadHistory.pop();
    localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory));
}
function updateDownloadHistory() {
    const container = document.getElementById('download-history');
    if (!container) return;
    if (downloadHistory.length === 0) {
        container.innerHTML = '<div class="download-empty"><i class="fa-solid fa-cloud-arrow-down"></i> Sin descargas recientes</div>';
        return;
    }
    container.innerHTML = downloadHistory.slice(0, 5).map(item => `
        <div class="item">
            <span>${item.name}</span>
            <span class="time">${timeAgo(item.time)}</span>
        </div>
    `).join('');
}

// Instancias

function updateInstanceCount(count) {
    const el = document.getElementById('profile-instances-count');
    if (el) el.textContent = count;
}

async 



// Herramientas




// Autenticación offline








// Caché




// Toast



// 




















function setupMineSteam240() {
  document.getElementById('instance-details-close')?.addEventListener('click', closeInstanceDetails);
  const ramRange = document.getElementById('detail-ram-range');
  const ramInput = document.getElementById('detail-ram-input');
  const ramValue = document.getElementById('detail-ram-control-value');
  const syncRamControls = value => {
    const clamped = Math.max(1024, Math.min(32768, Number(value) || 4096));
    if (ramRange) ramRange.value = clamped;
    if (ramInput) ramInput.value = clamped;
    if (ramValue) ramValue.textContent = `${(clamped / 1024).toFixed(1)} GB`;
  };
  ramRange?.addEventListener('input', e => syncRamControls(e.target.value));
  ramInput?.addEventListener('input', e => syncRamControls(e.target.value));
  document.getElementById('detail-ram-save')?.addEventListener('click', async () => {
    if (!appState.instance.detailPath) return;
    const ram = Math.max(1024, Math.min(32768, Number(ramInput?.value) || 4096));
    const result = await window.launcherAPI.setInstanceConfig(appState.instance.detailPath, { ram });
    if (result?.error) { mostrarMensaje('❌ ' + result.error); return; }
    syncRamControls(ram);
    document.getElementById('detail-ram').textContent = `${(ram / 1024).toFixed(1)} GB`;
    mostrarMensaje(`✅ RAM guardada: ${(ram / 1024).toFixed(1)} GB`);
    displayInstances();
  });
  document.getElementById('detail-open-terminal')?.addEventListener('click', () => { closeInstanceDetails(); terminalOpen(); });
  document.getElementById('detail-play')?.addEventListener('click', async () => { if (!appState.instance.detailPath) return; const p = appState.instance.detailPath; closeInstanceDetails(); await launchGame(p); });
  document.getElementById('detail-check-updates')?.addEventListener('click', checkDetailUpdates);
  document.getElementById('detail-export-instance')?.addEventListener('click', exportCurrentInstance);
  document.getElementById('detail-backup-instance')?.addEventListener('click', openInstanceBackupsModal);
  document.getElementById('instance-backup-now')?.addEventListener('click', createCurrentInstanceBackup);
  document.getElementById('instance-backups-close')?.addEventListener('click', () => document.getElementById('modal-instance-backups')?.classList.remove('show'));
  document.getElementById('detail-repair-advanced')?.addEventListener('click', async () => { if (!appState.instance.detailPath) return; if (!confirm('MineSteam creará un backup antes de reparar la instancia. ¿Continuar?')) return; const r=await window.launcherAPI.repairInstanceAdvanced(appState.instance.detailPath); if(r?.error) return mostrarMensaje('❌ '+r.error); mostrarMensaje('✅ Reparación avanzada completada. Backup preventivo creado.'); displayInstances(); });
  document.getElementById('detail-open-logs')?.addEventListener('click', async () => { if (!appState.instance.detailPath) return; const r=await window.launcherAPI.openInstanceLogs(appState.instance.detailPath); if(r?.error) mostrarMensaje('❌ '+r.error); else mostrarMensaje('📄 Carpeta de logs abierta.'); });
  document.getElementById('detail-open-folder')?.addEventListener('click', async () => { if (appState.instance.detailPath) await window.launcherAPI.openInstanceFolder(appState.instance.detailPath); });
  document.getElementById('terminal-clear-btn')?.addEventListener('click', () => { appState.tools.terminalEntries = []; renderTerminal(); });
  document.getElementById('terminal-search')?.addEventListener('input', e => { appState.tools.terminalSearch = e.target.value; renderTerminal(); });
  document.querySelectorAll('[data-terminal-filter]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-terminal-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    appState.tools.terminalFilter = btn.dataset.terminalFilter;
    renderTerminal();
  }));
  document.getElementById('terminal-expand-btn')?.addEventListener('click', () => {
    const shell = document.getElementById('terminal-shell');
    shell.classList.toggle('terminal-fullscreen');
    const icon = document.querySelector('#terminal-expand-btn i');
    if (icon) icon.className = shell.classList.contains('terminal-fullscreen') ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    renderTerminal();
  });
  document.getElementById('terminal-share-btn')?.addEventListener('click', async () => {
    const text = appState.tools.terminalEntries.map(e => `[${new Date(e.time || e.timestamp).toLocaleTimeString()}] [${e.source}] ${e.message}`).join('\n');
    try { await navigator.clipboard.writeText(text); mostrarMensaje('📋 Logs copiados al portapapeles'); } catch (_) { mostrarMensaje('⚠️ No se pudo copiar'); }
  });
  window.launcherAPI.onTerminalLog(entry => {
    terminalAppend(entry);
    const badge = document.getElementById('terminal-badge');
    if (badge) badge.style.display = 'inline-flex';
  });
  window.launcherAPI.onLaunchState?.(state => {
    if (!state?.instancePath) return;
    runningInstances.delete(state.instancePath);
    updateRunningInstanceButtons();
    if (state.state === 'finished') {
      mostrarMensaje('ℹ️ Minecraft finalizó.');
    } else if (state.state === 'error') {
      mostrarMensaje('❌ El lanzamiento terminó con error. Revisa la Terminal.');
    }
  });
  window.launcherAPI.onDownloadProgress(p => terminalAppend({ level:'info', source:p.stage || 'download', message:p.message || `${p.current}/${p.total}`, progress:p.progress }));
  document.getElementById('accounts-refresh-btn')?.addEventListener('click', loadAccounts);
  const toolbar = document.getElementById('content-toolbar');
  if (toolbar && !document.getElementById('content-backup-world')) {
    const wrap = toolbar.querySelector('.tool-section-head > div:last-child');
    if (wrap) {
      const btn = document.createElement('button');
      btn.id = 'content-backup-world'; btn.className = 'btn-secondary'; btn.style.padding='8px 12px'; btn.innerHTML='<i class="fa-solid fa-shield-heart"></i> Respaldar mundo';
      btn.addEventListener('click', backupSelectedWorldModule);
      wrap.appendChild(btn);
    }
  }
}


document.getElementById('search-input')?.addEventListener('input', () => { resetModrinthPage(); });

document.addEventListener('DOMContentLoaded', setupMineSteam240);
document.addEventListener('DOMContentLoaded', setupDashboardNavigation);

// Puente temporal entre módulos durante la migración arquitectónica.
// Se eliminará cuando las dependencias de UI estén desacopladas por completo.
window.mineSteamUI = {
    launchGame,
    mostrarMensaje,
    updateLibrary: () => updateLibrary({ launchGame }),
    updateActivityGrid,
    openInstanceDetails,
    openInstanceConfig: typeof openInstanceConfig === 'function' ? openInstanceConfig : undefined,
    updateRightSidebar: typeof updateRightSidebar === 'function' ? updateRightSidebar : undefined
};

console.log('MineSteam 2.4.2 cargado con éxito.');
