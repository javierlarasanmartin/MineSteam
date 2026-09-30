import { escapeHtml } from './utils.js';
import appState from '../state/appState.js';

const MODPACK_PAGE_SIZE = 20;
let deps = { mostrarMensaje: () => {}, addDownloadHistory: () => {}, abrirModalInstalacion: () => {} };

export function initModrinth(overrides = {}) {
  deps = { ...deps, ...overrides };
  appState.modrinth.page = Number(appState.modrinth.page) || 1;
}

export function resetModrinthPage() {
  appState.modrinth.page = 1;
}

export async function searchModpacks() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim() || '';
  const mode = document.getElementById('explore-type')?.value || 'modpack';
  const category = document.getElementById('filter-category')?.value || '';
  const loader = document.getElementById('filter-loader')?.value || '';
  const version = document.getElementById('filter-version')?.value || '';
  const sort = document.getElementById('filter-sort')?.value || 'relevance';
  const loading = document.getElementById('search-loading');
  const resultsContainer = document.getElementById('search-results');
  const resultsCount = document.getElementById('results-count');
  appState.modrinth.query = query;
  appState.modrinth.filters = { category, loader, version, sort };
  if (loading) loading.style.display = 'block';
  if (resultsContainer) resultsContainer.innerHTML = '';
  if (resultsCount) resultsCount.textContent = '';
  try {
    const filters = { sort };
    if (category) filters.categories = [category];
    if (loader) filters.loaders = [loader];
    if (version) filters.versions = [version];
    if (mode === 'mod') {
      const results = await window.launcherAPI.searchModrinthMods(query, 30, filters);
      displayModResults(results);
      if (resultsCount) resultsCount.textContent = `${results.length} resultados`;
    } else {
      const offset = (appState.modrinth.page - 1) * MODPACK_PAGE_SIZE;
      const results = await window.launcherAPI.searchModrinth(query, MODPACK_PAGE_SIZE, filters, offset);
      displaySearchResults(results);
      renderModpackPagination(results.length);
      if (resultsCount) resultsCount.textContent = `${results.length} resultados en esta página`;
    }
  } catch (error) {
    console.error('Error buscando:', error);
    if (resultsContainer) resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Error al buscar</h3><p>${escapeHtml(error.message || 'Intenta de nuevo más tarde')}</p></div>`;
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

export async function loadModInstanceSelector() {
  const select = document.getElementById('mod-instance-select');
  if (!select) return;
  const instances = await window.launcherAPI.getInstances();
  const previous = select.value;
  select.innerHTML = '<option value="">Selecciona una instancia para instalar mods</option>';
  for (const instance of instances) {
    const option = document.createElement('option');
    option.value = instance.path;
    option.textContent = `${instance.name} — ${instance.loader || 'vanilla'} ${instance.version || ''}`;
    select.appendChild(option);
  }
  if (instances.some(i => i.path === previous)) select.value = previous;
}

export function updateExploreMode() {
  resetModrinthPage();
  const pagination = document.getElementById('modpack-pagination');
  if (pagination) pagination.innerHTML = '';
  const mode = document.getElementById('explore-type')?.value || 'modpack';
  const instanceSelect = document.getElementById('mod-instance-select');
  const category = document.getElementById('filter-category')?.closest('.filter-group');
  if (instanceSelect) {
    instanceSelect.style.display = mode === 'mod' ? 'inline-block' : 'none';
    if (mode === 'mod') loadModInstanceSelector();
  }
  if (category) category.style.display = mode === 'mod' ? 'none' : 'flex';
  const searchLoading = document.querySelector('#search-loading p');
  if (searchLoading) searchLoading.textContent = mode === 'mod' ? 'Buscando mods...' : 'Buscando modpacks...';
  searchModpacks();
}

async function installModFromModrinth(projectId, title) {
  const instancePath = document.getElementById('mod-instance-select')?.value;
  if (!instancePath) { deps.mostrarMensaje('⚠️ Selecciona primero una instancia'); return; }
  try {
    deps.mostrarMensaje(`⬇️ Instalando ${title}...`);
    const result = await window.launcherAPI.installModrinthMod({ instancePath, projectId });
    if (result.success) {
      deps.mostrarMensaje(`✅ ${title} instalado en la instancia`);
      deps.addDownloadHistory(title, 'Modrinth Mod');
    } else deps.mostrarMensaje('❌ Error: ' + (result.error || 'No se pudo instalar'));
  } catch (error) { deps.mostrarMensaje('❌ Error: ' + error.message); }
}

function displayModResults(results) {
  const container = document.getElementById('search-results');
  if (!container) return;
  document.getElementById('results-count').textContent = `${results.length} mods`;
  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-cubes"></i><h3>No se encontraron mods</h3><p>Prueba otro término o versión.</p></div>';
    return;
  }
  container.innerHTML = results.map((mod, index) => {
    const loaders = (mod.loaders || []).slice(0, 3).map(loader => `<span class="mod-tag">${escapeHtml(loader === 'neoforge' ? 'NeoForge' : loader)}</span>`).join('');
    const categories = (mod.categories || []).slice(0, 3).map(c => `<span class="mod-tag">${escapeHtml(c)}</span>`).join('');
    return `<div class="mod-item" style="animation:fadeIn .3s ease ${index * .03}s;">
      <div class="mod-info"><div class="mod-icon" style="background:#2563eb;"><i class="fa-solid fa-cubes"></i></div><div class="mod-details"><h4>${escapeHtml(mod.title)}</h4><p>${escapeHtml((mod.description || 'Sin descripción').slice(0, 150))}${(mod.description || '').length > 150 ? '...' : ''}</p><div class="mod-stats"><span><i class="fa-solid fa-download"></i> ${(mod.downloads || 0).toLocaleString()}</span><span><i class="fa-solid fa-user"></i> ${escapeHtml(mod.author || 'Desconocido')}</span><span style="background:#2563eb;color:#fff;padding:0 8px;border-radius:4px;font-size:10px;">Modrinth</span></div><div class="mod-tags">${loaders}${categories}</div></div></div>
      <div class="mod-action"><button class="btn-primary install-mod-btn" data-id="${escapeHtml(mod.id)}" data-title="${escapeHtml(mod.title)}" style="padding:6px 15px;font-size:12px;"><i class="fa-solid fa-download"></i> Instalar</button></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.install-mod-btn').forEach(btn => btn.addEventListener('click', () => installModFromModrinth(btn.dataset.id, btn.dataset.title)));
}

function modrinthBadge(text, icon = '') {
  return `<span style="background:var(--bg-primary);padding:3px 8px;border-radius:999px;border:1px solid var(--border-color);">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${escapeHtml(text)}</span>`;
}

function displaySearchResults(results) {
  const container = document.getElementById('search-results');
  if (!container) return;
  if (!Array.isArray(results) || results.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:42px;color:var(--text-muted);"><i class="fa-solid fa-box-open" style="font-size:28px;margin-bottom:10px;"></i><h3 style="margin:8px 0;">No se encontraron modpacks</h3><p>Prueba con otro nombre, autor o quita algún filtro.</p></div>`; return;
  }
  const favorites = JSON.parse(localStorage.getItem('modrinthFavorites') || '{}');
  container.innerHTML = results.map(pack => {
    const loader = (pack.loaders?.[0] || 'vanilla').toLowerCase();
    const badge = loader === 'fabric' ? 'Fabric' : loader === 'neoforge' ? 'NeoForge' : loader === 'forge' ? 'Forge' : 'Vanilla';
    const version = pack.versions?.[0] || '?'; const icon = pack.icon_url || pack.icon || ''; const projectId = pack.project_id || pack.id; const fav = !!favorites[projectId];
    return `<div class="mod-item modrinth-project-card" data-project-id="${escapeHtml(projectId)}" style="display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--bg-secondary);padding:14px 18px;border-radius:var(--radius);border:1px solid var(--border-color);transition:var(--transition);"><div class="mod-info" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;"><div style="width:58px;height:58px;border-radius:10px;background:var(--bg-primary);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:1px solid var(--border-color);">${icon ? `<img src="${escapeHtml(icon)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-cubes" style="font-size:22px;"></i>'}</div><div class="mod-details" style="flex:1;min-width:0;"><h4 style="font-size:15px;font-weight:700;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(pack.title || 'Modpack')}</h4><p style="font-size:12px;color:var(--text-secondary);margin:0 0 7px;">${escapeHtml((pack.description || 'Sin descripción').slice(0,180))}${(pack.description || '').length > 180 ? '...' : ''}</p><div style="display:flex;gap:6px;margin-top:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">${modrinthBadge(`${(pack.downloads || 0).toLocaleString()} descargas`, 'fa-download')}${modrinthBadge(pack.author || 'Desconocido', 'fa-user')}${modrinthBadge(badge)}${modrinthBadge(version)}${(pack.categories || []).slice(0,2).map(c => modrinthBadge(c)).join('')}</div></div></div><div class="mod-action" style="display:flex;gap:7px;flex-shrink:0;"><button class="btn-secondary modrinth-favorite-btn" data-id="${escapeHtml(projectId)}" title="Favorito" style="padding:7px 10px;">${fav ? '★' : '☆'}</button><button class="btn-secondary modrinth-details-btn" data-id="${escapeHtml(projectId)}" style="padding:7px 12px;"><i class="fa-solid fa-circle-info"></i> Detalles</button><button class="btn-primary install-btn" data-id="${escapeHtml(projectId)}" style="padding:7px 14px;"><i class="fa-solid fa-download"></i> Instalar</button></div></div>`;
  }).join('');
  container.querySelectorAll('.install-btn').forEach(btn => btn.addEventListener('click', () => deps.abrirModalInstalacion(btn.dataset.id)));
  container.querySelectorAll('.modrinth-details-btn').forEach(btn => btn.addEventListener('click', () => openModrinthDetails(btn.dataset.id)));
  container.querySelectorAll('.modrinth-favorite-btn').forEach(btn => btn.addEventListener('click', () => toggleModrinthFavorite(btn.dataset.id)));
}

function toggleModrinthFavorite(projectId) {
  const favorites = JSON.parse(localStorage.getItem('modrinthFavorites') || '{}');
  favorites[projectId] = !favorites[projectId];
  if (!favorites[projectId]) delete favorites[projectId];
  localStorage.setItem('modrinthFavorites', JSON.stringify(favorites));
  searchModpacks();
}

async function openModrinthDetails(projectId) {
  const modal = document.getElementById('modal-modrinth-details'); const body = document.getElementById('modrinth-details-body');
  if (!modal || !body || !projectId) return;
  modal.classList.add('show'); body.innerHTML = '<div style="padding:35px;text-align:center;color:var(--text-muted);"><div class="spinner"></div><p>Cargando información de Modrinth...</p></div>';
  try {
    const pack = await window.launcherAPI.getModrinthModpack(projectId); if (!pack) throw new Error('No se encontró el proyecto');
    document.getElementById('modrinth-details-title').textContent = pack.title || 'Proyecto Modrinth';
    const versions = Array.isArray(pack.versions) ? pack.versions : []; const latest = pack.latestVersion || versions[0];
    body.innerHTML = `<div style="display:grid;grid-template-columns:96px 1fr;gap:16px;align-items:start;"><div style="width:96px;height:96px;border-radius:14px;overflow:hidden;background:var(--bg-secondary);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;font-size:30px;">${pack.icon ? `<img src="${escapeHtml(pack.icon)}" style="width:100%;height:100%;object-fit:cover;">` : '📦'}</div><div><p style="color:var(--text-secondary);line-height:1.55;margin:0 0 10px;">${escapeHtml(pack.description || 'Sin descripción')}</p><div style="display:flex;gap:7px;flex-wrap:wrap;font-size:11px;">${modrinthBadge(`${(pack.downloads || 0).toLocaleString()} descargas`, 'fa-download')}${modrinthBadge(pack.author || 'Desconocido', 'fa-user')}${modrinthBadge(`${versions.length} versiones`, 'fa-code-branch')}</div></div></div><div style="margin-top:18px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;"><h3 style="margin:0 0 10px;">Versiones compatibles</h3><div style="max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:7px;">${versions.slice(0,30).map(v => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 10px;background:var(--bg-primary);border-radius:8px;"><span><strong>${escapeHtml(v.name || v.version_number || 'Versión')}</strong><br><small style="color:var(--text-muted);">${escapeHtml((v.game_versions || []).join(', '))} · ${escapeHtml((v.loaders || []).join(', ') || 'Vanilla')}</small></span><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(v.version_type || 'release')}</span></div>`).join('') || '<p class="muted">No hay versiones disponibles.</p>'}</div></div><div class="form-actions" style="margin-top:16px;"><button class="btn-primary" id="modrinth-details-install"><i class="fa-solid fa-download"></i> Instalar ${escapeHtml(latest?.name || 'última versión')}</button><button class="btn-secondary" id="modrinth-details-close-2">Cerrar</button></div>`;
    document.getElementById('modrinth-details-install')?.addEventListener('click', () => { modal.classList.remove('show'); deps.abrirModalInstalacion(projectId); });
    document.getElementById('modrinth-details-close-2')?.addEventListener('click', () => modal.classList.remove('show'));
  } catch (e) { body.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);"><h3>No se pudo cargar el proyecto</h3><p>${escapeHtml(e.message)}</p></div>`; }
}

function renderModpackPagination(resultCount) {
  const host = document.getElementById('modpack-pagination'); if (!host) return;
  const page = appState.modrinth.page; const hasPrevious = page > 1; const hasNext = resultCount >= MODPACK_PAGE_SIZE;
  if (!hasPrevious && !hasNext) { host.innerHTML = ''; return; }
  const start = Math.max(1, page - 2); const end = page + 2; const buttons = [];
  if (hasPrevious) buttons.push(`<button class="btn-secondary modpack-page-btn" data-page="${page - 1}"><i class="fa-solid fa-chevron-left"></i> Anterior</button>`);
  for (let p = start; p <= end; p++) buttons.push(`<button class="${p === page ? 'btn-primary' : 'btn-secondary'} modpack-page-btn" data-page="${p}">${p}</button>`);
  if (hasNext) buttons.push(`<button class="btn-secondary modpack-page-btn" data-page="${page + 1}">Siguiente <i class="fa-solid fa-chevron-right"></i></button>`);
  host.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;margin-top:18px;"><span style="color:var(--text-muted);font-size:12px;margin-right:4px;">Página ${page}</span>${buttons.join('')}</div>`;
  host.querySelectorAll('.modpack-page-btn').forEach(btn => btn.addEventListener('click', () => {
    const next = Number(btn.dataset.page); if (!Number.isFinite(next) || next < 1) return; appState.modrinth.page = next; searchModpacks(); document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
