import { escapeHtml, formatBytes, timeAgo } from './utils.js';

const escapeAttr = escapeHtml;

let currentContentType = 'worlds';
let contentModrinthOffset = 0;
let notify = message => console.log(message);

export function initContentManager(options = {}) {
  notify = options.onMessage || notify;
  document.querySelectorAll('.content-tab').forEach(btn => btn.addEventListener('click', () => {
    currentContentType = btn.dataset.contentType;
    document.querySelectorAll('.content-tab').forEach(b => {
      b.classList.remove('btn-primary');
      b.classList.add('btn-secondary');
      b.style.background = 'var(--bg-hover)';
      b.style.color = 'var(--text-primary)';
    });
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    btn.style.background = '';
    btn.style.color = '';
    updateContentHeader();
    loadContent();
    const searchBox = document.getElementById('content-modrinth-search');
    if (searchBox) searchBox.placeholder = currentContentType === 'resourcepacks' ? 'Buscar resource packs...' : currentContentType === 'shaders' ? 'Buscar shaders...' : 'Los mundos se importan desde ZIP';
    const panel = document.getElementById('content-modrinth-panel');
    if (panel) panel.style.display = currentContentType === 'worlds' ? 'none' : 'block';
  }));
  document.getElementById('content-instance-select')?.addEventListener('change', loadContent);
  document.getElementById('content-refresh-btn')?.addEventListener('click', loadContent);
  document.getElementById('content-open-folder')?.addEventListener('click', async () => {
    const instance = document.getElementById('content-instance-select')?.value;
    if (!instance) return notify('⚠️ Selecciona una instancia');
    const r = await window.launcherAPI.openContentFolder(instance, currentContentType);
    if (r?.error) notify('❌ ' + r.error);
  });
  document.getElementById('content-install-btn')?.addEventListener('click', () => {
    const instance = document.getElementById('content-instance-select')?.value;
    if (!instance) return notify('⚠️ Selecciona una instancia');
    const input = document.getElementById('content-file-input');
    input.value = '';
    input.click();
  });
  document.getElementById('content-file-input')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    const instance = document.getElementById('content-instance-select')?.value;
    if (!file || !instance) return;
    try {
      const filePath = file.path || file.name;
      const result = currentContentType === 'worlds'
        ? await window.launcherAPI.importWorld(instance, filePath)
        : await window.launcherAPI.installContentFile(instance, currentContentType, filePath);
      if (result?.error) throw new Error(result.error);
      notify('✅ Contenido importado correctamente');
      loadContent();
    } catch (error) {
      notify('❌ ' + error.message);
    }
  });
  updateContentHeader();
  const initialPanel = document.getElementById('content-modrinth-panel');
  if (initialPanel) initialPanel.style.display = currentContentType === 'worlds' ? 'none' : 'block';
  document.getElementById('content-modrinth-search-btn')?.addEventListener('click', () => searchContentModrinth(true));
  document.getElementById('content-modrinth-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchContentModrinth(true); });
}

export function getContentType() { return currentContentType; }

export async function loadContentInstances() {
  const select = document.getElementById('content-instance-select');
  if (!select) return;
  const instances = await window.launcherAPI.getInstances();
  const current = select.value;
  select.innerHTML = instances.length
    ? instances.map(i => `<option value="${escapeHtml(i.path)}">${escapeHtml(i.name)}</option>`).join('')
    : '<option value="">No hay instancias</option>';
  if (instances.some(i => i.path === current)) select.value = current;
}

function updateContentHeader() {
  const meta = {
    worlds: ['Mundos / Saves', 'Gestiona tus mundos guardados.', 'Importar mundo'],
    resourcepacks: ['Resource Packs', 'Instala, activa, desactiva o elimina paquetes de recursos.', 'Importar pack'],
    shaders: ['Shaders', 'Administra tus paquetes de shaders para cada instancia.', 'Importar shader']
  }[currentContentType] || ['Contenido', '', 'Importar'];
  document.getElementById('content-title').textContent = meta[0];
  document.getElementById('content-subtitle').textContent = meta[1];
  document.getElementById('content-install-btn').innerHTML = `<i class="fa-solid fa-file-import"></i> ${meta[2]}`;
}

export async function loadContent() {
  const instance = document.getElementById('content-instance-select')?.value;
  const list = document.getElementById('content-list');
  const empty = document.getElementById('content-empty');
  if (!list || !empty) return;
  if (!instance) { list.innerHTML = ''; empty.style.display = 'block'; return; }
  try {
    const items = await window.launcherAPI.listContent(instance, currentContentType);
    empty.style.display = items.length ? 'none' : 'block';
    list.innerHTML = items.map(item => {
      const icon = currentContentType === 'worlds' ? 'fa-earth-americas' : currentContentType === 'resourcepacks' ? 'fa-box-archive' : 'fa-wand-magic-sparkles';
      const typeLabel = currentContentType === 'worlds' ? 'Mundo' : currentContentType === 'resourcepacks' ? 'Resource Pack' : 'Shader Pack';
      return `<div class="feature-card content-item-card">
        <div class="card-head"><div style="display:flex;align-items:center;gap:12px;min-width:0;"><div class="card-icon" style="background:var(--bg-primary);color:var(--accent);"><i class="fa-solid ${icon}"></i></div><div style="min-width:0"><h3 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</h3><div class="muted">${typeLabel} · ${formatBytes(item.size)} · ${timeAgo(item.modifiedAt)}</div></div></div><span class="chip">${item.enabled ? 'Activo' : 'Desactivado'}</span></div>
        <div class="actions">
          ${currentContentType === 'worlds' ? `<button class="btn-primary content-backup-btn" data-name="${escapeAttr(item.name)}"><i class="fa-solid fa-box-archive"></i> Respaldar</button>` : `<button class="btn-secondary content-toggle-btn" data-name="${escapeAttr(item.fileName)}" data-enabled="${item.enabled}">${item.enabled ? 'Desactivar' : 'Activar'}</button>`}
          <button class="btn-secondary content-rename-btn" data-name="${escapeAttr(item.fileName)}">Renombrar</button>
          <button class="btn-danger content-delete-btn" data-name="${escapeAttr(item.fileName)}">Eliminar</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.content-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
      const enabled = btn.dataset.enabled !== 'true';
      const r = await window.launcherAPI.toggleContent(instance, currentContentType, btn.dataset.name, enabled);
      if (r?.error) notify('❌ ' + r.error); else { notify(enabled ? '✅ Activado' : '✅ Desactivado'); loadContent(); }
    }));
    list.querySelectorAll('.content-backup-btn').forEach(btn => btn.addEventListener('click', async () => {
      const r = await window.launcherAPI.createWorldBackup(instance, btn.dataset.name);
      if (r?.success) notify('✅ Backup del mundo creado'); else notify('❌ ' + (r?.error || 'No se pudo crear el backup'));
    }));
    list.querySelectorAll('.content-rename-btn').forEach(btn => btn.addEventListener('click', async () => {
      const next = prompt('Nuevo nombre:', btn.dataset.name);
      if (!next || next === btn.dataset.name) return;
      const r = await window.launcherAPI.renameContent(instance, currentContentType, btn.dataset.name, next);
      if (r?.error) notify('❌ ' + r.error); else { notify('✅ Renombrado'); loadContent(); }
    }));
    list.querySelectorAll('.content-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${btn.dataset.name}"? Esta acción no se puede deshacer.`)) return;
      const r = await window.launcherAPI.deleteContent(instance, currentContentType, btn.dataset.name);
      if (r?.error) notify('❌ ' + r.error); else { notify('✅ Eliminado'); loadContent(); }
    }));
  } catch (error) {
    list.innerHTML = `<div class="feature-card"><h3>Error</h3><p class="muted">${escapeHtml(error.message)}</p></div>`;
  }
}

export async function searchContentModrinth(reset = true) {
  const results = document.getElementById('content-modrinth-results');
  const query = document.getElementById('content-modrinth-search')?.value?.trim() || '';
  const instance = document.getElementById('content-instance-select')?.value;
  if (!results) return;
  if (!instance) { notify('⚠️ Selecciona una instancia'); return; }
  if (currentContentType === 'worlds') {
    results.innerHTML = '<div class="feature-card" style="grid-column:1/-1;"><p class="muted">Modrinth no distribuye mundos como un tipo de proyecto general. Importa un mundo ZIP o administra tus saves desde la lista.</p></div>';
    return;
  }
  if (reset) contentModrinthOffset = 0;
  results.innerHTML = '<div class="feature-card" style="grid-column:1/-1;text-align:center;padding:24px;"><i class="fa-solid fa-spinner fa-spin"></i> Buscando en Modrinth...</div>';
  try {
    const r = await window.launcherAPI.searchContentModrinth(currentContentType, query, 12, contentModrinthOffset, null);
    if (!r.hits?.length) {
      results.innerHTML = '<div class="feature-card" style="grid-column:1/-1;text-align:center;padding:24px;"><h3>No se encontraron resultados</h3><p class="muted">Prueba otro nombre o cambia de tipo de contenido.</p></div>';
      return;
    }
    results.innerHTML = r.hits.map(item => `<div class="feature-card" style="padding:14px;">
      <div style="display:flex;gap:10px;align-items:center;min-width:0;">
        <img src="${escapeAttr(item.icon || '')}" data-hide-on-error style="width:48px;height:48px;border-radius:10px;object-fit:cover;background:var(--bg-primary);" alt="">
        <div style="min-width:0"><h3 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.title)}</h3><div class="muted">${escapeHtml(item.author)} · ${(item.downloads||0).toLocaleString()} descargas</div></div>
      </div>
      <p class="muted" style="margin:10px 0;min-height:34px;">${escapeHtml((item.description || '').slice(0,120))}${(item.description||'').length>120?'…':''}</p>
      <div class="actions"><button class="btn-primary content-modrinth-install" data-id="${escapeAttr(item.id)}"><i class="fa-solid fa-download"></i> Instalar</button><button class="btn-secondary content-modrinth-versions" data-id="${escapeAttr(item.id)}">Versiones</button></div>
    </div>`).join('');
    results.querySelectorAll('.content-modrinth-install').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando';
      try {
        const r = await window.launcherAPI.installContentModrinth(instance, currentContentType, btn.dataset.id);
        if (r?.error) throw new Error(r.error);
        notify(`✅ Instalado ${r.version ? `v${r.version}` : ''}`);
        await loadContent();
      } catch (e) { notify('❌ ' + e.message); }
      finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-download"></i> Instalar'; }
    }));
    results.querySelectorAll('.content-modrinth-versions').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const versions = await window.launcherAPI.getContentModrinthVersions(btn.dataset.id, null);
        const choices = (versions || []).slice(0, 12).map((v, i) => `${i + 1}. ${v.version_number} — ${v.version_type} — ${(v.game_versions||[]).join(', ')}`).join('\n');
        const answer = prompt(`Versiones disponibles:\n\n${choices}\n\nEscribe el número de la versión a instalar:`);
        const index = Number(answer) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= Math.min(12, versions.length)) return;
        const selected = versions[index];
        const r = await window.launcherAPI.installContentModrinth(instance, currentContentType, btn.dataset.id, selected.id);
        if (r?.error) throw new Error(r.error);
        notify(`✅ Instalado ${selected.version_number}`); loadContent();
      } catch (e) { notify('❌ ' + e.message); }
    }));
  } catch (e) {
    results.innerHTML = `<div class="feature-card" style="grid-column:1/-1;"><h3>Error de Modrinth</h3><p class="muted">${escapeHtml(e.message)}</p></div>`;
  }
}


