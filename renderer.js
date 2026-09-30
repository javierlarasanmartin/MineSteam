// Oculta imágenes que fallan al cargar (reemplaza a onerror inline, incompatible con la CSP).
document.addEventListener('error', event => {
    const el = event.target;
    if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) el.style.display = 'none';
}, true);

// Funciones auxiliares
function sanitizeName(name) {
  if (!name) return 'instancia';
  return name.replace(/[\\/:*?"<>|()\s]/g, '_').trim();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function timeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'hace ' + seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return 'hace ' + minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'hace ' + hours + 'h';
  const days = Math.floor(hours / 24);
  if (days < 30) return 'hace ' + days + 'd';
  const months = Math.floor(days / 30);
  if (months < 12) return 'hace ' + months + 'm';
  const years = Math.floor(months / 12);
  return 'hace ' + years + 'a';
}

// Estado global
let currentView = 'page-inicio';
let selectedLoader = 'vanilla';
let modpackPage = 1;
const MODPACK_PAGE_SIZE = 20;
let pendingInstallId = null;
let currentSkinUrl = localStorage.getItem('skinUrl') || '';
let downloadHistory = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
let currentContentType = 'worlds';

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
        modpackPage = 1;
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


// Perfiles y servidores
let editingProfileId = null;
let editingServerId = null;

function openProfileModal(profile = null) {
  editingProfileId = profile?.id || null;
  const modal = document.getElementById('modal-perfil');
  if (!modal) return;
  document.getElementById('perfil-modal-title').textContent = profile ? 'Editar perfil' : 'Nuevo perfil';
  document.getElementById('perfil-name-input').value = profile?.name || '';
  document.getElementById('perfil-description-input').value = profile?.description || '';
  document.getElementById('perfil-color-input').value = profile?.color || '#4f8cff';
  modal.classList.add('show');
  document.getElementById('perfil-name-input')?.focus();
}

function closeProfileModal() { document.getElementById('modal-perfil')?.classList.remove('show'); editingProfileId = null; }

async function loadProfilesPage() {
  const grid = document.getElementById('profiles-grid');
  if (!grid) return;
  try {
    const [profiles, active] = await Promise.all([window.launcherAPI.getProfiles(), window.launcherAPI.getActiveProfile()]);
    const cards = await Promise.all(profiles.map(async profile => {
      const stats = await window.launcherAPI.getProfileStats(profile.id);
      const isActive = active?.id === profile.id;
      return `<article class="feature-card" style="border-color:${escapeHtml(profile.color || '#4f8cff')}55;box-shadow:inset 0 0 28px ${escapeHtml(profile.color || '#4f8cff')}0a;">
        <div class="card-head"><div style="display:flex;align-items:center;gap:12px;"><div class="card-icon" style="background:${escapeHtml(profile.color || '#4f8cff')}22;color:${escapeHtml(profile.color || '#4f8cff')};"><i class="fa-solid fa-layer-group"></i></div><div><h3>${escapeHtml(profile.name)}</h3><div class="muted">${escapeHtml(profile.description || 'Perfil de MineSteam')}</div></div></div><span class="chip" style="${isActive ? 'background:#1f8f3a22;color:#63d56a;' : ''}">${isActive ? 'Activo' : 'Disponible'}</span></div>
        <div class="feature-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;"><div><strong>${stats.instanceCount || 0}</strong><span>Instancias</span></div><div><strong>${stats.favorites || 0}</strong><span>Favoritos</span></div><div><strong>${((stats.totalRam || 0)/1024).toFixed(1)} GB</strong><span>RAM asignada</span></div></div>
        <div class="actions"><button class="btn-primary profile-select-btn" data-id="${escapeHtml(profile.id)}" ${isActive ? 'disabled' : ''}>${isActive ? '✓ Perfil activo' : 'Usar perfil'}</button><button class="btn-secondary profile-edit-btn" data-id="${escapeHtml(profile.id)}">Editar</button>${profile.id !== 'default' ? `<button class="btn-delete profile-delete-btn" data-id="${escapeHtml(profile.id)}">Eliminar</button>` : ''}</div>
      </article>`;
    }));
    grid.innerHTML = cards.join('');
    document.getElementById('profiles-empty').style.display = profiles.length ? 'none' : 'block';
    grid.querySelectorAll('.profile-select-btn').forEach(btn => btn.addEventListener('click', async () => { const r=await window.launcherAPI.selectProfile(btn.dataset.id); if(r?.error) return mostrarMensaje('❌ '+r.error); mostrarMensaje('✅ Perfil activo: '+(r.name||'Perfil')); await loadProfilesPage(); await displayInstances(); updateSteamDashboard25(); }));
    grid.querySelectorAll('.profile-edit-btn').forEach(btn => btn.addEventListener('click', async () => { const profile=profiles.find(p=>p.id===btn.dataset.id); if(profile) openProfileModal(profile); }));
    grid.querySelectorAll('.profile-delete-btn').forEach(btn => btn.addEventListener('click', async () => { const profile=profiles.find(p=>p.id===btn.dataset.id); if(!profile || !confirm(`¿Eliminar el perfil "${profile.name}"? Las instancias pasarán al perfil Principal.`)) return; const r=await window.launcherAPI.deleteProfile(profile.id); if(r?.error) return mostrarMensaje('❌ '+r.error); mostrarMensaje('✅ Perfil eliminado'); await loadProfilesPage(); await displayInstances(); }));
  } catch(e) { grid.innerHTML = `<div class="feature-card"><h3>Error</h3><p class="muted">${escapeHtml(e.message)}</p></div>`; }
}

function openServerModal(server = null) {
  editingServerId = server?.id || null;
  const modal=document.getElementById('modal-servidor'); if(!modal) return;
  document.getElementById('servidor-modal-title').textContent = server ? 'Editar servidor' : 'Nuevo servidor';
  document.getElementById('server-edit-id').value = server?.id || '';
  document.getElementById('server-name-input').value = server?.name || '';
  document.getElementById('server-address-input').value = server?.address || '';
  document.getElementById('server-port-input').value = server?.port || 25565;
  document.getElementById('server-version-input').value = server?.version || '';
  modal.classList.add('show'); document.getElementById('server-name-input')?.focus();
}
function closeServerModal(){ document.getElementById('modal-servidor')?.classList.remove('show'); editingServerId=null; }

async function loadServersPage() {
  const grid=document.getElementById('servers-grid'); if(!grid) return;
  try {
    const servers=await window.launcherAPI.getServers();
    document.getElementById('servers-empty').style.display=servers.length?'none':'block';
    grid.innerHTML=servers.map(server=>`<article class="feature-card server-feature-card" data-server-id="${escapeHtml(server.id)}">
      <div class="card-head"><div style="display:flex;align-items:center;gap:12px;"><div class="card-icon" style="background:#4fc25322;color:#63c866;"><i class="fa-solid fa-server"></i></div><div><h3>${escapeHtml(server.name)}</h3><div class="muted">${escapeHtml(server.address)}:${Number(server.port)||25565}</div></div></div><span class="chip server-status-chip" data-status="unknown">● Sin comprobar</span></div>
      <div class="feature-stats" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:14px 0;"><div><strong>${escapeHtml(server.version || 'Cualquier versión')}</strong><span>Versión</span></div><div><strong>${server.favorite ? '★ Favorito' : '☆ Normal'}</strong><span>Preferencia</span></div></div>
      <div class="actions"><button class="btn-primary server-ping-btn" data-id="${escapeHtml(server.id)}"><i class="fa-solid fa-signal"></i> Comprobar</button><button class="btn-secondary server-favorite-btn" data-id="${escapeHtml(server.id)}">${server.favorite?'★ Favorito':'☆ Favorito'}</button><button class="btn-secondary server-edit-btn" data-id="${escapeHtml(server.id)}">Editar</button><button class="btn-secondary server-copy-btn" data-address="${escapeHtml(server.address)}:${Number(server.port)||25565}">Copiar</button><button class="btn-delete server-delete-btn" data-id="${escapeHtml(server.id)}">Eliminar</button></div>
    </article>`).join('');
    grid.querySelectorAll('.server-ping-btn').forEach(btn=>btn.addEventListener('click',async()=>{ const server=servers.find(s=>s.id===btn.dataset.id); if(!server)return; btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Comprobando'; const card=btn.closest('.server-feature-card'); const chip=card?.querySelector('.server-status-chip'); try{const r=await window.launcherAPI.pingServer(server); if(r.online){chip.textContent=`● Online · ${r.latency} ms`; chip.style.color='#63d56a'; mostrarMensaje(`🟢 ${server.name}: ${r.playersOnline}/${r.playersMax} jugadores`);} else {chip.textContent='● Offline'; chip.style.color='#e06a6a'; mostrarMensaje(`🔴 ${server.name}: ${r.error||'sin respuesta'}`);}}finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-signal"></i> Comprobar';}}));
    grid.querySelectorAll('.server-edit-btn').forEach(btn=>btn.addEventListener('click',()=>{const server=servers.find(s=>s.id===btn.dataset.id);if(server)openServerModal(server);}));
    grid.querySelectorAll('.server-delete-btn').forEach(btn=>btn.addEventListener('click',async()=>{const server=servers.find(s=>s.id===btn.dataset.id);if(!server||!confirm(`¿Eliminar "${server.name}"?`))return;const r=await window.launcherAPI.deleteServer(server.id);if(r?.error)return mostrarMensaje('❌ '+r.error);loadServersPage();updateSteamDashboard25();}));
    grid.querySelectorAll('.server-favorite-btn').forEach(btn=>btn.addEventListener('click',async()=>{const server=servers.find(s=>s.id===btn.dataset.id);if(!server)return;const r=await window.launcherAPI.updateServer(server.id,{favorite:!server.favorite});if(r?.error)return mostrarMensaje('❌ '+r.error);loadServersPage();updateSteamDashboard25();}));
    grid.querySelectorAll('.server-copy-btn').forEach(btn=>btn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(btn.dataset.address);mostrarMensaje('📋 Dirección copiada');}catch(_){mostrarMensaje('⚠️ No se pudo copiar la dirección');}}));
  } catch(e) { grid.innerHTML=`<div class="feature-card"><h3>Error</h3><p class="muted">${escapeHtml(e.message)}</p></div>`; }
}

function setupProfilesServers() {
  document.getElementById('btn-crear-perfil')?.addEventListener('click',()=>openProfileModal());
  document.getElementById('perfil-modal-close')?.addEventListener('click',closeProfileModal);
  document.getElementById('perfil-cancel-btn')?.addEventListener('click',closeProfileModal);
  document.getElementById('perfil-save-btn')?.addEventListener('click',async()=>{try{const data={name:document.getElementById('perfil-name-input').value,description:document.getElementById('perfil-description-input').value,color:document.getElementById('perfil-color-input').value};if(!data.name.trim())return mostrarMensaje('⚠️ El nombre del perfil es obligatorio');const wasEditing=!!editingProfileId;const r=wasEditing?await window.launcherAPI.updateProfile(editingProfileId,data):await window.launcherAPI.createProfile(data);if(r?.error)throw new Error(r.error);closeProfileModal();await loadProfilesPage();mostrarMensaje(wasEditing?'✅ Perfil actualizado':'✅ Perfil creado');}catch(e){mostrarMensaje('❌ '+e.message);}});
  document.getElementById('btn-crear-servidor')?.addEventListener('click',()=>openServerModal());
  document.getElementById('servidor-modal-close')?.addEventListener('click',closeServerModal);
  document.getElementById('server-cancel-btn')?.addEventListener('click',closeServerModal);
  document.getElementById('server-save-btn')?.addEventListener('click',async()=>{try{const data={name:document.getElementById('server-name-input').value,address:document.getElementById('server-address-input').value,port:document.getElementById('server-port-input').value,version:document.getElementById('server-version-input').value};if(!data.address.trim())return mostrarMensaje('⚠️ La dirección es obligatoria');const r=editingServerId?await window.launcherAPI.updateServer(editingServerId,data):await window.launcherAPI.addServer(data);if(r?.error)throw new Error(r.error);closeServerModal();await loadServersPage();updateSteamDashboard25();mostrarMensaje(editingServerId?'✅ Servidor actualizado':'✅ Servidor añadido');}catch(e){mostrarMensaje('❌ '+e.message);}});
  document.getElementById('modal-perfil')?.addEventListener('click',e=>{if(e.target.id==='modal-perfil')closeProfileModal();});
  document.getElementById('modal-servidor')?.addEventListener('click',e=>{if(e.target.id==='modal-servidor')closeServerModal();});
  loadProfilesPage(); loadServersPage();
}

async function checkSmartModpack() {
  if(!detailInstancePath) return;
  try { const r=await window.launcherAPI.checkModpackUpdate(detailInstancePath); if(!r.isModpack){mostrarMensaje('ℹ️ Esta instancia no es un modpack de Modrinth');return;} if(r.updateAvailable){mostrarMensaje(`🆕 ${r.title}: ${r.currentVersion} → ${r.latestVersion}`); terminalAppend({level:'info',source:'modpack',message:`Actualización disponible: ${r.currentVersion} → ${r.latestVersion}`});} else mostrarMensaje('✅ El modpack está actualizado'); } catch(e){mostrarMensaje('❌ '+e.message);}
}

// Navegación
function setupNavigation() {
    const links = document.querySelectorAll('.nav a[data-target]');
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.dataset.target;
            if (!targetId) return;
            links.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active-page'));
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active-page');
            currentView = targetId;
            if (targetId === 'page-mods') {
                const input = document.getElementById('search-input');
                if (input && !input.value) {
                    input.value = '';
                    searchModpacks();
                }
            }
            if (targetId === 'page-instancias') {
                displayInstances();
            }
            if (targetId === 'page-perfiles') loadProfilesPage();
            if (targetId === 'page-servidores') loadServersPage();
            if (targetId === 'page-perfil') updateCacheSize();
            if (targetId === 'page-herramientas') { loadToolInstances(); loadJavaManager(); }
            if (targetId === 'page-contenido') { loadContentInstances(); loadContent(); }
            // Cerrar menús en móvil
            if (window.innerWidth <= 992) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });
    document.getElementById('btn-ver-todas-actividad')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('[data-target="page-instancias"]')?.click();
    });
}

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
            modpackPage = 1;
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

// Progress bar
function setupProgressBar() {
    window.launcherAPI.onDownloadProgress((progress) => {
        const container = document.getElementById('progress-container');
        const bar = document.getElementById('progress-bar');
        const stage = document.getElementById('progress-stage');
        const percent = document.getElementById('progress-percent');
        const msg = document.getElementById('progress-message');
        if (!container) return;
        container.style.display = 'block';
        const p = progress.progress || 0;
        bar.style.width = `${p}%`;
        percent.textContent = `${p}%`;
        const stageNames = {
            'minecraft': 'Descargando Minecraft',
            'assets': 'Descargando assets',
            'libraries': 'Descargando librerías',
            'mods': 'Descargando mods',
            'modpack': 'Instalando modpack',
            'launch': 'Lanzando juego',
            'repair': 'Reparando instancia'
        };
        stage.textContent = stageNames[progress.stage] || progress.stage || 'Descargando';
        if (progress.message) msg.textContent = progress.message;
        if (p === 100) {
            setTimeout(() => { container.style.display = 'none'; }, 4000);
        }
    });
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

// Importar ZIP
async function importZipHandler(event) {
    const file = event.target.files[0];
    if (!file) return;
    const name = prompt('Nombre para la instancia:', file.name.replace('.zip', ''));
    if (!name) { event.target.value = ''; return; }
    try {
        mostrarMensaje(`📥 Importando ${file.name}...`);
        const result = await window.launcherAPI.importZip(file.path, name);
        if (result.success) {
            mostrarMensaje(`✅ Modpack "${name}" importado`);
            loadInstances();
            displayInstances();
                    updateActivityGrid();
            addDownloadHistory(name, 'Importación ZIP');
        } else {
            mostrarMensaje('❌ Error al importar: ' + (result.error || 'Error desconocido'));
        }
    } catch (error) {
        mostrarMensaje('❌ Error: ' + error.message);
    } finally {
        event.target.value = '';
    }
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

// Versión más reciente
async function loadLatestVersion() {
  const select = document.getElementById('instancia-version');
  if (!select) return;

  const fallback = ['26.2','26.1','1.21.11','1.21.10','1.21.9','1.21.8','1.21.7','1.21.6','1.21.5','1.21.4','1.21.3','1.21.2','1.21.1','1.21','1.20.6','1.20.5','1.20.4','1.20.3','1.20.2','1.20.1','1.19.4','1.19.3','1.19.2','1.19.1','1.19','1.18.2','1.18.1','1.18','1.17.1','1.17','1.16.5','1.16.4','1.16.3','1.16.2','1.16.1','1.15.2','1.14.4','1.13.2','1.12.2','1.11.2','1.10.2','1.9.4','1.8.9','1.7.10','1.6.4','1.5.2','1.4.7','1.3.2','1.2.5','1.1','1.0'];
  const previous = select.value;
  try {
    const [latest, releaseList] = await Promise.all([
      window.launcherAPI.getLatestMinecraftVersion(),
      window.launcherAPI.getReleaseVersionList()
    ]);
    const ids = [...new Set((releaseList || []).map(v => v.id).filter(Boolean))];
    const versions = ids.length ? ids : fallback;
    select.innerHTML = '';
    const latestOption = document.createElement('option');
    latestOption.value = 'latest';
    latestOption.textContent = `🚀 Última versión (${latest || versions[0]})`;
    select.appendChild(latestOption);
    versions.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    });
    select.dataset.latest = latest || versions[0];
    select.value = [...select.options].some(o => o.value === previous) ? previous : 'latest';
  } catch (e) {
    console.error('Error cargando versiones:', e);
    select.innerHTML = '<option value="latest">🚀 Última versión (26.2)</option>';
    fallback.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    });
    select.dataset.latest = '26.2';
  }
}
// RAM slider
function setupRamSlider() {
    const slider = document.getElementById('instancia-ram');
    const display = document.getElementById('ram-display-modal');
    if (!slider) return;
    const saved = Math.max(1024, Math.min(32768, parseInt(localStorage.getItem('ram') || '4096', 10) || 4096));
    slider.value = saved;
    updateRamDisplay(saved);
    slider.addEventListener('input', (e) => {
        updateRamDisplay(e.target.value);
        localStorage.setItem('ram', e.target.value);
    });
}
function updateRamDisplay(val) {
    const gb = (parseInt(val)/1024).toFixed(1);
    document.getElementById('ram-display-modal').textContent = `${gb} GB`;
}

// Loader buttons
function setupLoaderButtons() {
    document.querySelectorAll('.loader-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.loader-btn').forEach(b => {
                b.classList.remove('active');
                b.style.background = 'var(--bg-card)';
                b.style.color = 'var(--text-secondary)';
                b.style.border = '1px solid var(--border-color)';
            });
            this.classList.add('active');
            this.style.background = 'var(--accent)';
            this.style.color = '#fff';
            this.style.border = 'none';
            selectedLoader = this.dataset.loader;
            const names = {
                'vanilla': 'Sin mods - Experiencia vanilla',
                'fabric': 'Fabric - Mods ligeros',
                'forge': 'Forge - Mods clásicos',
                'neoforge': 'NeoForge - Mods modernos'
            };
            document.getElementById('loader-info').textContent = names[selectedLoader] || 'Selecciona un loader';
            // La versión del loader se selecciona automáticamente al instalar.
            // El selector manual queda desactivado temporalmente.
        });
    });

}

// Modal crear instancia
function setupModal() {
    document.getElementById('modal-close')?.addEventListener('click', cerrarModal);
    document.getElementById('btn-cancelar-modal')?.addEventListener('click', cerrarModal);
    document.getElementById('modal-crear-instancia')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModal();
    });
    document.getElementById('btn-crear-instancia')?.addEventListener('click', crearInstancia);
}

function abrirModal() {
    const modal = document.getElementById('modal-crear-instancia');
    const input = document.getElementById('instancia-nombre');
    modal.classList.add('show');
    document.getElementById('form-crear-instancia').style.display = 'block';
    document.getElementById('modal-loading').style.display = 'none';
    if (input) {
        input.value = '';
        setTimeout(() => { input.focus(); input.select(); }, 200);
    }
    selectedLoader = 'vanilla';
    document.querySelectorAll('.loader-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    loadLatestVersion();
}

function cerrarModal() {
    document.getElementById('modal-crear-instancia').classList.remove('show');
    document.getElementById('form-crear-instancia').style.display = 'block';
    document.getElementById('modal-loading').style.display = 'none';
}

async function crearInstancia() {
    const nombre = sanitizeName(document.getElementById('instancia-nombre').value.trim());
    if (!nombre) { mostrarMensaje('⚠️ Ingresa un nombre'); return; }
    let version = document.getElementById('instancia-version').value || '1.20.4';
    if (version === 'latest') {
        const select = document.getElementById('instancia-version');
        version = select?.dataset?.latest || '1.21.1';
    }
    const ram = parseInt(document.getElementById('instancia-ram').value || '4096');
    document.getElementById('form-crear-instancia').style.display = 'none';
    document.getElementById('modal-loading').style.display = 'block';
    try {
        const loader = selectedLoader || 'vanilla';
        // MineSteam selecciona automáticamente la versión compatible más reciente.
        const loaderVersion = null;
        const result = await window.launcherAPI.crearInstanciaPersonalizada({
            nombre, version, loader, loaderVersion, ram
        });
        if (result.success) {
            mostrarMensaje(`✅ Instancia "${nombre}" creada`);
            cerrarModal();
            loadInstances();
            displayInstances();
                    updateActivityGrid();
            addDownloadHistory(nombre, 'Personalizada');
        } else {
            mostrarMensaje('❌ Error: ' + (result.error || 'Error desconocido'));
        }
    } catch (e) {
        mostrarMensaje('❌ Error: ' + e.message);
    } finally {
        document.getElementById('form-crear-instancia').style.display = 'block';
        document.getElementById('modal-loading').style.display = 'none';
    }
}

// Modal instalar modpack
function setupModalInstalacion() {
    document.getElementById('modal-instalar-close')?.addEventListener('click', cerrarModalInstalacion);
    document.getElementById('btn-cancelar-instalacion')?.addEventListener('click', cerrarModalInstalacion);
    document.getElementById('btn-confirmar-instalacion')?.addEventListener('click', confirmarInstalacion);
    document.getElementById('instancia-nombre-instalacion')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') confirmarInstalacion();
    });
    document.getElementById('modal-instalar-modpack')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) cerrarModalInstalacion();
    });
    document.getElementById('modrinth-details-close')?.addEventListener('click', () => document.getElementById('modal-modrinth-details')?.classList.remove('show'));
    document.getElementById('modal-modrinth-details')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('show'); });
}

async function abrirModalInstalacion(projectId) {
    if (!projectId) { mostrarMensaje('❌ Error: ID del modpack no válido'); return; }
    pendingInstallId = projectId;
    const modal = document.getElementById('modal-instalar-modpack');
    const input = document.getElementById('instancia-nombre-instalacion');
    const select = document.getElementById('modpack-version-select');
    const titleEl = document.getElementById('modpack-install-title');
    const descEl = document.getElementById('modpack-install-description');
    const metaEl = document.getElementById('modpack-install-meta');
    const iconEl = document.getElementById('modpack-install-icon');
    const compatEl = document.getElementById('modpack-compatibility');
    modal.classList.add('show');
    document.getElementById('form-instalar-modpack').style.display = 'block';
    document.getElementById('modal-instalar-loading').style.display = 'none';
    select.innerHTML = '<option>Cargando versiones...</option>';
    select.disabled = true;
    try {
        const pack = await window.launcherAPI.getModrinthModpack(projectId);
        if (!pack) throw new Error('No se encontró el modpack');
        titleEl.textContent = pack.title || 'Modpack';
        descEl.textContent = pack.description || 'Sin descripción';
        metaEl.innerHTML = [
          modrinthBadge(`${(pack.downloads || 0).toLocaleString()} descargas`, 'fa-download'),
          modrinthBadge(pack.author || 'Desconocido', 'fa-user')
        ].join('');
        if (pack.icon) iconEl.innerHTML = `<img src="${escapeHtml(pack.icon)}" style="width:100%;height:100%;object-fit:cover;">`;
        const versions = (pack.versions || []).filter(v => Array.isArray(v.files) && v.files.length);
        select.innerHTML = versions.map((v, i) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.name || v.version_number || 'Versión')} — ${(v.game_versions || []).join(', ')} · ${(v.loaders || []).join(', ') || 'Vanilla'}${v.version_type === 'release' ? ' · estable' : ''}</option>`).join('');
        select.disabled = false;
        if (pack.latestVersion?.id) select.value = pack.latestVersion.id;
        if (!input.value.trim()) input.value = sanitizeName(pack.title || 'Mi Modpack');
        const updateCompat = () => {
          const v = versions.find(item => item.id === select.value) || versions[0];
          if (!v) { compatEl.textContent = '❌ Esta publicación no tiene archivos instalables.'; return; }
          const game = v.game_versions?.[0] || 'Minecraft desconocido';
          const loaders = (v.loaders || []).join(', ') || 'Vanilla';
          compatEl.innerHTML = `✓ Minecraft <strong>${escapeHtml(game)}</strong> · Loader <strong>${escapeHtml(loaders)}</strong> · ${escapeHtml(v.version_type || 'release')} · Archivo listo para descargar.`;
        };
        select.onchange = updateCompat;
        updateCompat();
    } catch (e) {
        select.innerHTML = '<option value="">No se pudieron cargar las versiones</option>';
        compatEl.textContent = `❌ ${e.message}`;
        mostrarMensaje('❌ ' + e.message);
    }
}

function cerrarModalInstalacion() {
    document.getElementById('modal-instalar-modpack').classList.remove('show');
    document.getElementById('form-instalar-modpack').style.display = 'block';
    document.getElementById('modal-instalar-loading').style.display = 'none';
    pendingInstallId = null;
}

async function confirmarInstalacion() {
    const nombre = sanitizeName(document.getElementById('instancia-nombre-instalacion')?.value?.trim());
    const versionId = document.getElementById('modpack-version-select')?.value;
    if (!pendingInstallId || !nombre) { mostrarMensaje('⚠️ Completa el nombre de la instancia'); return; }
    if (!versionId) { mostrarMensaje('⚠️ Selecciona una versión del modpack'); return; }
    document.getElementById('form-instalar-modpack').style.display = 'none';
    document.getElementById('modal-instalar-loading').style.display = 'block';
    try {
        const packInfo = await window.launcherAPI.getModrinthModpack(pendingInstallId);
        if (!packInfo?.versions?.length) throw new Error('Este modpack no tiene versiones instalables');
        const selected = packInfo.versions.find(v => v.id === versionId);
        if (!selected) throw new Error('La versión seleccionada ya no está disponible');
        const result = await window.launcherAPI.installModpack({ platform:'modrinth', projectId:pendingInstallId, versionId:selected.id, instanceName:nombre });
        if (result.success) {
            mostrarMensaje(`✅ ${packInfo.title} instalado`);
            cerrarModalInstalacion();
            loadInstances(); displayInstances(); updateLibrary(); updateActivityGrid();
            addDownloadHistory(packInfo.title, 'Modrinth');
        } else {
            mostrarMensaje('❌ Error: ' + (result.error || 'Error desconocido'));
        }
    } catch (e) {
        mostrarMensaje('❌ Error: ' + e.message);
    } finally {
        document.getElementById('form-instalar-modpack').style.display = 'block';
        document.getElementById('modal-instalar-loading').style.display = 'none';
    }
}


// Búsqueda de modpacks
async function searchModpacks() {
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
      const offset = (modpackPage - 1) * MODPACK_PAGE_SIZE;
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

async function loadModInstanceSelector() {
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

function updateExploreMode() {
  modpackPage = 1;
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
  if (!instancePath) {
    mostrarMensaje('⚠️ Selecciona primero una instancia');
    return;
  }
  try {
    mostrarMensaje(`⬇️ Instalando ${title}...`);
    const result = await window.launcherAPI.installModrinthMod({ instancePath, projectId });
    if (result.success) {
      mostrarMensaje(`✅ ${title} instalado en la instancia`);
      addDownloadHistory(title, 'Modrinth Mod');
    } else {
      mostrarMensaje('❌ Error: ' + (result.error || 'No se pudo instalar'));
    }
  } catch (error) {
    mostrarMensaje('❌ Error: ' + error.message);
  }
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
      <div class="mod-info">
        <div class="mod-icon" style="background:#2563eb;"><i class="fa-solid fa-cubes"></i></div>
        <div class="mod-details">
          <h4>${escapeHtml(mod.title)}</h4>
          <p>${escapeHtml((mod.description || 'Sin descripción').slice(0, 150))}${(mod.description || '').length > 150 ? '...' : ''}</p>
          <div class="mod-stats"><span><i class="fa-solid fa-download"></i> ${(mod.downloads || 0).toLocaleString()}</span><span><i class="fa-solid fa-user"></i> ${escapeHtml(mod.author || 'Desconocido')}</span><span style="background:#2563eb;color:#fff;padding:0 8px;border-radius:4px;font-size:10px;">Modrinth</span></div>
          <div class="mod-tags">${loaders}${categories}</div>
        </div>
      </div>
      <div class="mod-action"><button class="btn-primary install-mod-btn" data-id="${escapeHtml(mod.id)}" data-title="${escapeHtml(mod.title)}" style="padding:6px 15px;font-size:12px;"><i class="fa-solid fa-download"></i> Instalar</button></div>
    </div>`;
  }).join('');

  container.querySelectorAll('.install-mod-btn').forEach(btn => {
    btn.addEventListener('click', () => installModFromModrinth(btn.dataset.id, btn.dataset.title));
  });
}

function modrinthBadge(text, icon = '') {
    return `<span style="background:var(--bg-primary);padding:3px 8px;border-radius:999px;border:1px solid var(--border-color);">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${escapeHtml(text)}</span>`;
}

function displaySearchResults(results) {
    const container = document.getElementById('search-results');
    if (!container) return;
    if (!Array.isArray(results) || results.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:42px;color:var(--text-muted);"><i class="fa-solid fa-box-open" style="font-size:28px;margin-bottom:10px;"></i><h3 style="margin:8px 0;">No se encontraron modpacks</h3><p>Prueba con otro nombre, autor o quita algún filtro.</p></div>`;
        return;
    }
    const favorites = JSON.parse(localStorage.getItem('modrinthFavorites') || '{}');
    container.innerHTML = results.map((pack, i) => {
        const loader = (pack.loaders?.[0] || 'vanilla').toLowerCase();
        const badge = loader === 'fabric' ? 'Fabric' : loader === 'neoforge' ? 'NeoForge' : loader === 'forge' ? 'Forge' : 'Vanilla';
        const version = pack.versions?.[0] || '?';
        const icon = pack.icon_url || pack.icon || '';
        const projectId = pack.project_id || pack.id;
        const fav = !!favorites[projectId];
        return `
        <div class="mod-item modrinth-project-card" data-project-id="${escapeHtml(projectId)}" style="display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--bg-secondary);padding:14px 18px;border-radius:var(--radius);border:1px solid var(--border-color);transition:var(--transition);">
            <div class="mod-info" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
                <div style="width:58px;height:58px;border-radius:10px;background:var(--bg-primary);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:1px solid var(--border-color);">
                    ${icon ? `<img src="${escapeHtml(icon)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<i class="fa-solid fa-cubes" style="font-size:22px;"></i>'}
                </div>
                <div class="mod-details" style="flex:1;min-width:0;">
                    <h4 style="font-size:15px;font-weight:700;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(pack.title || 'Modpack')}</h4>
                    <p style="font-size:12px;color:var(--text-secondary);margin:0 0 7px;">${escapeHtml((pack.description || 'Sin descripción').slice(0,180))}${(pack.description || '').length > 180 ? '...' : ''}</p>
                    <div style="display:flex;gap:6px;margin-top:4px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">
                        ${modrinthBadge(`${(pack.downloads || 0).toLocaleString()} descargas`, 'fa-download')}
                        ${modrinthBadge(pack.author || 'Desconocido', 'fa-user')}
                        ${modrinthBadge(badge)}
                        ${modrinthBadge(version)}
                        ${(pack.categories || []).slice(0,2).map(c => modrinthBadge(c)).join('')}
                    </div>
                </div>
            </div>
            <div class="mod-action" style="display:flex;gap:7px;flex-shrink:0;">
                <button class="btn-secondary modrinth-favorite-btn" data-id="${escapeHtml(projectId)}" title="Favorito" style="padding:7px 10px;">${fav ? '★' : '☆'}</button>
                <button class="btn-secondary modrinth-details-btn" data-id="${escapeHtml(projectId)}" style="padding:7px 12px;"><i class="fa-solid fa-circle-info"></i> Detalles</button>
                <button class="btn-primary install-btn" data-id="${escapeHtml(projectId)}" style="padding:7px 14px;"><i class="fa-solid fa-download"></i> Instalar</button>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.install-btn').forEach(btn => btn.addEventListener('click', () => abrirModalInstalacion(btn.dataset.id)));
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
    const modal = document.getElementById('modal-modrinth-details');
    const body = document.getElementById('modrinth-details-body');
    if (!modal || !body || !projectId) return;
    modal.classList.add('show');
    body.innerHTML = '<div style="padding:35px;text-align:center;color:var(--text-muted);"><div class="spinner"></div><p>Cargando información de Modrinth...</p></div>';
    try {
        const pack = await window.launcherAPI.getModrinthModpack(projectId);
        if (!pack) throw new Error('No se encontró el proyecto');
        document.getElementById('modrinth-details-title').textContent = pack.title || 'Proyecto Modrinth';
        const versions = Array.isArray(pack.versions) ? pack.versions : [];
        const latest = pack.latestVersion || versions[0];
        body.innerHTML = `
          <div style="display:grid;grid-template-columns:96px 1fr;gap:16px;align-items:start;">
            <div style="width:96px;height:96px;border-radius:14px;overflow:hidden;background:var(--bg-secondary);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;font-size:30px;">${pack.icon ? `<img src="${escapeHtml(pack.icon)}" style="width:100%;height:100%;object-fit:cover;">` : '📦'}</div>
            <div>
              <p style="color:var(--text-secondary);line-height:1.55;margin:0 0 10px;">${escapeHtml(pack.description || 'Sin descripción')}</p>
              <div style="display:flex;gap:7px;flex-wrap:wrap;font-size:11px;">
                ${modrinthBadge(`${(pack.downloads || 0).toLocaleString()} descargas`, 'fa-download')}
                ${modrinthBadge(pack.author || 'Desconocido', 'fa-user')}
                ${modrinthBadge(`${versions.length} versiones`, 'fa-code-branch')}
              </div>
            </div>
          </div>
          <div style="margin-top:18px;padding:14px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;">
            <h3 style="margin:0 0 10px;">Versiones compatibles</h3>
            <div style="max-height:260px;overflow:auto;display:flex;flex-direction:column;gap:7px;">
              ${versions.slice(0,30).map(v => `<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 10px;background:var(--bg-primary);border-radius:8px;"><span><strong>${escapeHtml(v.name || v.version_number || 'Versión')}</strong><br><small style="color:var(--text-muted);">${escapeHtml((v.game_versions || []).join(', '))} · ${escapeHtml((v.loaders || []).join(', ') || 'Vanilla')}</small></span><span style="font-size:11px;color:var(--text-muted);">${escapeHtml(v.version_type || 'release')}</span></div>`).join('') || '<p class="muted">No hay versiones disponibles.</p>'}
            </div>
          </div>
          <div class="form-actions" style="margin-top:16px;"><button class="btn-primary" id="modrinth-details-install"><i class="fa-solid fa-download"></i> Instalar ${escapeHtml(latest?.name || 'última versión')}</button><button class="btn-secondary" id="modrinth-details-close-2">Cerrar</button></div>`;
        document.getElementById('modrinth-details-install')?.addEventListener('click', () => { modal.classList.remove('show'); abrirModalInstalacion(projectId); });
        document.getElementById('modrinth-details-close-2')?.addEventListener('click', () => modal.classList.remove('show'));
    } catch (e) {
        body.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-muted);"><h3>No se pudo cargar el proyecto</h3><p>${escapeHtml(e.message)}</p></div>`;
    }
}

// Instancias
setupInstanceFilters();

async function loadInstances() {
    try {
        const instances = await window.launcherAPI.getInstances();
        updateInstanceCount(instances.length);
        for (const id of ['library-badge', 'instances-count-badge']) {
            const badge = document.getElementById(id);
            if (badge) badge.textContent = instances.length;
        }
        return instances;
    } catch (e) { console.error(e); return []; }
}

function renderModpackPagination(resultCount) {
  const host = document.getElementById('modpack-pagination');
  if (!host) return;
  const hasPrevious = modpackPage > 1;
  const hasNext = resultCount >= MODPACK_PAGE_SIZE;
  if (!hasPrevious && !hasNext) { host.innerHTML = ''; return; }
  const start = Math.max(1, modpackPage - 2);
  const end = modpackPage + 2;
  const buttons = [];
  if (hasPrevious) buttons.push(`<button class="btn-secondary modpack-page-btn" data-page="${modpackPage - 1}"><i class="fa-solid fa-chevron-left"></i> Anterior</button>`);
  for (let page = start; page <= end; page++) {
    buttons.push(`<button class="${page === modpackPage ? 'btn-primary' : 'btn-secondary'} modpack-page-btn" data-page="${page}">${page}</button>`);
  }
  if (hasNext) buttons.push(`<button class="btn-secondary modpack-page-btn" data-page="${modpackPage + 1}">Siguiente <i class="fa-solid fa-chevron-right"></i></button>`);
  host.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;margin-top:18px;"><span style="color:var(--text-muted);font-size:12px;margin-right:4px;">Página ${modpackPage}</span>${buttons.join('')}</div>`;
  host.querySelectorAll('.modpack-page-btn').forEach(btn => btn.addEventListener('click', () => {
    const page = Number(btn.dataset.page);
    if (!Number.isFinite(page) || page < 1) return;
    modpackPage = page;
    searchModpacks();
    document.getElementById('search-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function updateInstanceCount(count) {
    const el = document.getElementById('profile-instances-count');
    if (el) el.textContent = count;
}

async function displayInstances() {
    const container = document.getElementById('instances-grid');
    const loading = document.getElementById('instances-loading');
    if (!container) return;
    container.innerHTML = '';
    if (loading) loading.style.display = 'block';
    try {
        const [instances, profiles, activeProfile] = await Promise.all([
            window.launcherAPI.getInstances(),
            window.launcherAPI.getProfiles(),
            window.launcherAPI.getActiveProfile()
        ]);
        const search = (document.getElementById('instances-search')?.value || '').trim().toLowerCase();
        const filter = document.getElementById('instances-profile-filter')?.value || 'active';
        const favoritesOnly = !!document.getElementById('instances-favorites-only')?.checked;
        const configs = await Promise.all(instances.map(i => window.launcherAPI.getInstanceConfig(i.path)));
        const configByPath = new Map(instances.map((i, idx) => [i.path, configs[idx]]));
        const activeName = activeProfile?.name || 'Principal';
        const activeLabel = document.getElementById('instances-active-profile');
        if (activeLabel) activeLabel.textContent = `Perfil activo: ${activeName}`;
        const profileSelect = document.getElementById('instances-profile-filter');
        if (profileSelect) {
            const current = profileSelect.value || 'active';
            profileSelect.innerHTML = `<option value="active">Perfil activo</option><option value="all">Todos los perfiles</option>` + profiles.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
            profileSelect.value = profiles.some(p => p.id === current) || current === 'active' || current === 'all' ? current : 'active';
        }
        const filtered = instances.filter(inst => {
            const cfg = configByPath.get(inst.path) || {};
            const profileMatch = filter === 'all' ? true : filter === 'active' ? cfg.profileId === activeProfile?.id : cfg.profileId === filter;
            const textMatch = !search || `${inst.name} ${inst.version || ''} ${inst.loader || ''}`.toLowerCase().includes(search);
            return profileMatch && textMatch && (!favoritesOnly || cfg.favorite);
        });
        updateInstanceCount(filtered.length);
        document.getElementById('instances-count-badge')?.replaceChildren(document.createTextNode(String(filtered.length)));
        if (loading) loading.style.display = 'none';
        if (filtered.length === 0) {
            container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);"><i class="fa-solid fa-filter-circle-xmark" style="font-size:42px;margin-bottom:14px;opacity:.45;"></i><h3 style="color:var(--text-primary);">No hay instancias que coincidan</h3><p style="margin-top:6px;">Prueba otro perfil, búsqueda o desactiva «Solo favoritos».</p></div>`;
            return;
        }
        const colors = ['#4f8cff', '#8b5cf6', '#2ecc71', '#f39c12', '#e74c3c', '#e67e22'];
        let cards = '';
        for (const [index, inst] of filtered.entries()) {
            const color = colors[index % colors.length];
            let details = await window.launcherAPI.getInstanceDetails(inst.path);
            if (!details) details = { size: 0, lastModified: inst.installedAt, javaVersion: 'Desconocida' };
            const sizeStr = formatBytes(details.size);
            const timeStr = timeAgo(details.lastModified);
            const cfg = configByPath.get(inst.path) || {};
            const profile = profiles.find(p => p.id === cfg.profileId);
            cards += `
                <div class="instance-card" data-instance-path="${escapeHtml(inst.path)}" title="Haz clic para ver los mods y detalles">
                    <h4><i class="fa-solid fa-cube" style="color:${color};"></i> ${escapeHtml(inst.name)} ${cfg.favorite ? '<i class="fa-solid fa-star" style="color:#f5b942;font-size:12px;margin-left:5px;" title="Favorito"></i>' : ''}</h4>
                    <div class="instance-meta">
                        <span>📁 ${escapeHtml(inst.type || 'Modrinth')}</span><span>📦 ${escapeHtml(inst.version || '?')}</span>
                        ${inst.loader ? `<span style="background:var(--bg-card);padding:0 8px;border-radius:4px;">${escapeHtml(inst.loader)}</span>` : ''}
                        <span style="background:${profile?.color || '#4f8cff'}22;color:${profile?.color || '#4f8cff'};padding:0 8px;border-radius:4px;">${escapeHtml(profile?.name || 'Principal')}</span>
                    </div>
                    <div class="instance-details"><span><i class="fa-solid fa-java"></i> Java ${escapeHtml(details.javaVersion)}+</span><span><i class="fa-regular fa-hard-drive"></i> ${sizeStr}</span><span><i class="fa-regular fa-clock"></i> ${timeStr}</span></div>
                    <div class="instance-actions">
                        <button class="btn-play-green launch-btn" data-path="${escapeHtml(inst.path)}" aria-label="Jugar"><i class="fa-solid fa-play"></i> Jugar</button>
                        <button class="btn-folder folder-btn" data-path="${escapeHtml(inst.path)}" title="Abrir carpeta"><i class="fa-solid fa-folder"></i></button>
                        <button class="btn-secondary favorite-btn" data-path="${escapeHtml(inst.path)}" title="${cfg.favorite ? 'Quitar favorito' : 'Favorito'}"><i class="fa-solid fa-star"></i></button>
                        <button class="btn-secondary repair-btn" data-path="${escapeHtml(inst.path)}" title="Reparar"><i class="fa-solid fa-wrench"></i></button>
                        <button class="btn-secondary duplicate-btn" data-path="${escapeHtml(inst.path)}" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
                        <button class="btn-secondary config-btn" data-path="${escapeHtml(inst.path)}" title="Configuración"><i class="fa-solid fa-sliders"></i></button>
                        <button class="btn-delete delete-btn" data-path="${escapeHtml(inst.path)}" aria-label="Eliminar"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
        }
        container.innerHTML = cards;
        document.querySelectorAll('.launch-btn').forEach(btn => btn.addEventListener('click', async function(){ const original=this.innerHTML; this.disabled=true; this.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Cargando...'; await launchGame(this.dataset.path); this.innerHTML=original; this.disabled=false; }));
        document.querySelectorAll('.folder-btn').forEach(btn => btn.addEventListener('click', async function(){ const r=await window.launcherAPI.openInstanceFolder(this.dataset.path); if(!r.success) mostrarMensaje('❌ '+(r.error||'Error al abrir carpeta')); }));
        document.querySelectorAll('.favorite-btn').forEach(btn => btn.addEventListener('click', async function(){ const cfg=await window.launcherAPI.getInstanceConfig(this.dataset.path); await window.launcherAPI.setInstanceConfig(this.dataset.path,{favorite:!cfg.favorite}); displayInstances(); updateRightSidebar(); }));
        document.querySelectorAll('.repair-btn').forEach(btn => btn.addEventListener('click', async function(){ const original=this.innerHTML; this.disabled=true; this.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; mostrarMensaje('🛠️ Reparando instancia...'); const r=await window.launcherAPI.repairInstance(this.dataset.path); this.disabled=false; this.innerHTML=original; mostrarMensaje(r.success?'✅ Instancia reparada':'❌ '+(r.error||'No se pudo reparar')); if(r.success) displayInstances(); }));
        document.querySelectorAll('.duplicate-btn').forEach(btn => btn.addEventListener('click', async function(){ const name=prompt('Nombre para la copia:'); if(!name)return; const r=await window.launcherAPI.duplicateInstance(this.dataset.path,name); mostrarMensaje(r.success?`✅ ${r.name} creada`:'❌ '+(r.error||'No se pudo duplicar')); if(r.success){ await loadInstances(); displayInstances(); } }));
        document.querySelectorAll('.config-btn').forEach(btn => btn.addEventListener('click',()=>openInstanceConfig(btn.dataset.path)));
        document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', async function(){ if(confirm('¿Eliminar esta instancia?')){ await window.launcherAPI.deleteInstance(this.dataset.path); await loadInstances(); displayInstances(); updateLibrary(); updateActivityGrid(); } }));
        document.querySelectorAll('.instance-card[data-instance-path]').forEach(card=>card.addEventListener('click',event=>{if(event.target.closest('button')||event.target.closest('input')||event.target.closest('select'))return;openInstanceDetails(card.dataset.instancePath);}));
    } catch (e) {
        console.error(e); if(loading) loading.style.display='none'; container.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">Error al cargar instancias: ${escapeHtml(e.message)}</div>`;
    }
}

function setupInstanceFilters(){
    ['instances-search','instances-profile-filter','instances-favorites-only'].forEach(id=>{ const el=document.getElementById(id); if(!el || el.dataset.bound)return; el.dataset.bound='1'; el.addEventListener(id==='instances-search'?'input':'change',()=>displayInstances()); });
}

// Herramientas
async function loadToolInstances() {
    const box=document.getElementById('tool-instances-list'); if(!box) return;
    const instances=await window.launcherAPI.getInstances();
    if(!instances.length){ box.innerHTML='<div class="tool-card">No hay instancias instaladas.</div>'; return; }
    box.innerHTML=instances.map(i=>`<div class="tool-card"><div><strong>${i.name}</strong><p>${i.version||'?'} · ${i.loader||'vanilla'}</p></div><div style="display:flex;gap:6px"><button class="btn-secondary tool-diagnose" data-path="${i.path}"><i class="fa-solid fa-stethoscope"></i></button><button class="btn-primary tool-repair" data-path="${i.path}"><i class="fa-solid fa-wrench"></i> Reparar</button></div></div>`).join('');
    box.querySelectorAll('.tool-repair').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Reparando...';const r=await window.launcherAPI.repairInstance(b.dataset.path);mostrarMensaje(r.success?'✅ Reparación completada':'❌ '+(r.error||'Error'));b.disabled=false;b.innerHTML='<i class="fa-solid fa-wrench"></i> Reparar';}));
    box.querySelectorAll('.tool-diagnose').forEach(b=>b.addEventListener('click',async()=>{const r=await window.launcherAPI.diagnoseInstance(b.dataset.path);if(!r.success)return mostrarMensaje('❌ '+r.error);const issues=[];if(!r.minecraftPresent)issues.push('Minecraft base');if(r.missingFiles?.length)issues.push(`${r.missingFiles.length} archivos`);if(r.javaRequired&&(r.javaDetected||0)<r.javaRequired)issues.push(`Java ${r.javaRequired}`); if(r.languagesAvailable===false)issues.push('Idiomas de Minecraft');mostrarMensaje(issues.length?'⚠️ Problemas: '+issues.join(', '):'✅ Instancia saludable');}));
}

async function loadJavaManager() {
    const box=document.getElementById('java-manager-list'); if(!box) return;
    const data=await window.launcherAPI.getJavaStatus();
    box.innerHTML=[8,17,21,25].map(v=>{const sys=(data.system||0)>=v,local=(data.installed||[]).includes(v);return `<div class="tool-card"><div><strong>Java ${v}</strong><p>${sys?'Disponible en el sistema':local?'Instalado en MineSteam':'No instalado'}</p></div><button class="${sys||local?'btn-secondary':'btn-primary'} java-install" data-version="${v}" ${sys||local?'disabled':''}>${sys||local?'✓ Disponible':'Descargar'}</button></div>`}).join('');
    box.querySelectorAll('.java-install').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;b.textContent='Descargando...';const r=await window.launcherAPI.installJava(Number(b.dataset.version));mostrarMensaje(r.success?`✅ Java ${b.dataset.version} instalado`:'❌ '+(r.error||'Error'));loadJavaManager();}));
}

// Actividad reciente
async function updateActivityGrid() {
    const container = document.getElementById('activity-grid');
    if (!container) return;
    try {
        const instances = await window.launcherAPI.getInstances();
        const recent = instances.slice(-2).reverse();
        if (recent.length === 0) {
            container.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">No hay actividad reciente</div>`;
            return;
        }
        container.innerHTML = recent.map(inst => `
            <div class="activity-card">
                <h4>${inst.name}</h4>
                <div class="version">v${inst.version || '1.0.0'}</div>
                <div class="news">
                    <span><i class="fa-regular fa-clock"></i> ${timeAgo(inst.installedAt)}</span>
                    <span class="badge">${inst.loader || 'Vanilla'}</span>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

// Biblioteca
async function updateLibrary() {
    const container = document.getElementById('library-list');
    if (!container) return;
    try {
        const instances = await window.launcherAPI.getInstances();
        if (instances.length === 0) {
            container.innerHTML = `<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:8px;">No hay modpacks</div>`;
            return;
        }
        container.innerHTML = instances.slice(0, 5).map(inst => `
            <div class="library-item">
                <div class="info">
                    <span class="name">${inst.name}</span>
                    <span class="meta"><i class="fa-solid fa-cube"></i> ${inst.loader || 'Vanilla'} - ${inst.version || '?'}</span>
                </div>
                <button class="btn-play-green launch-btn-small" data-path="${inst.path}" style="padding:4px 12px; border-radius:6px; font-size:11px; font-weight:600;">JUGAR</button>
            </div>
        `).join('');
        document.querySelectorAll('.launch-btn-small').forEach(btn => {
            btn.addEventListener('click', async function() {
                const path = this.dataset.path;
                const ram = parseInt(localStorage.getItem('ram')) || 4096;
                await launchGame(path, ram);
            });
        });
    } catch (e) { console.error(e); }
}

// Featured modpack
async function updateFeaturedModpack() {
    try {
        const instances = await window.launcherAPI.getInstances();
        if (instances.length === 0) {
            document.getElementById('featured-title').textContent = 'Bienvenido a MineSteam';
            document.getElementById('featured-desc').textContent = 'Comienza tu aventura instalando un modpack';
            document.getElementById('featured-loader').textContent = 'Sin modpacks instalados';
            document.getElementById('featured-mods').textContent = 'Explora la biblioteca';
            return;
        }
        // Podríamos elegir el más reciente o el más jugado (por ahora, el último)
        const last = instances[instances.length - 1];
        document.getElementById('featured-title').textContent = last.name;
        document.getElementById('featured-desc').textContent = `Listo para jugar`;
        document.getElementById('featured-loader').textContent = `${last.loader || 'Vanilla'} ${last.version || '?'}`;
        document.getElementById('featured-mods').textContent = `${last.type || 'Modpack'}`;
        const playBtn = document.getElementById('btn-jugar');
        playBtn.onclick = async () => {
            await launchGame(last.path);
        };
    } catch (e) { console.error(e); }
}

// Lanzar juego
async function launchGame(instancePath) {
    mostrarMensaje('🚀 Lanzando Minecraft...');
    try {
        const cfg = await window.launcherAPI.getInstanceConfig(instancePath);
        let auth = null;
        const session = await null;
        if (session && session.user) {
            auth = { username: session.user.name, accessToken: session.user.accessToken || '0', uuid: session.user.uuid };
        } else {
            const offline = await window.launcherAPI.getCurrentUser();
            if (offline) auth = { username: offline.name, accessToken: offline.accessToken || '0', uuid: offline.uuid };
        }
        const result = await window.launcherAPI.launchMinecraft({
            instancePath,
            ram: Number(cfg?.ram || 4096),
            javaVersion: cfg?.javaVersion ?? undefined,
            jvmArgs: cfg?.jvmArgs || '',
            auth
        });
        if (result?.success) {
            markInstanceLaunching(instancePath);
            mostrarMensaje('🎮 Minecraft se está iniciando. Puedes seguir navegando por MineSteam.');
        } else {
            mostrarMensaje('❌ ' + (result?.error || 'No se pudo iniciar Minecraft'));
        }
    } catch (e) {
        mostrarMensaje('❌ Error al lanzar: ' + e.message);
    }
}

const runningInstances = new Map();
function markInstanceLaunching(instancePath) {
    runningInstances.set(instancePath, { startedAt: Date.now(), state: 'starting' });
    updateRunningInstanceButtons();
}
function updateRunningInstanceButtons() {
    document.querySelectorAll('.launch-btn, .launch-btn-small, #btn-jugar').forEach(btn => {
        const path = btn.dataset.path || btn.getAttribute('data-path');
        if (!path || !runningInstances.has(path)) return;
        btn.disabled = false;
        if (btn.classList.contains('launch-btn') || btn.classList.contains('launch-btn-small')) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> En ejecución';
        }
    });
}

// Gestor de contenido 2.8
function setupContentManager() {
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
    if (!instance) return mostrarMensaje('⚠️ Selecciona una instancia');
    const r = await window.launcherAPI.openContentFolder(instance, currentContentType);
    if (r?.error) mostrarMensaje('❌ ' + r.error);
  });
  document.getElementById('content-install-btn')?.addEventListener('click', () => {
    const instance = document.getElementById('content-instance-select')?.value;
    if (!instance) return mostrarMensaje('⚠️ Selecciona una instancia');
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
      mostrarMensaje('✅ Contenido importado correctamente');
      loadContent();
    } catch (error) {
      mostrarMensaje('❌ ' + error.message);
    }
  });
  updateContentHeader();
  const initialPanel = document.getElementById('content-modrinth-panel');
  if (initialPanel) initialPanel.style.display = currentContentType === 'worlds' ? 'none' : 'block';
  document.getElementById('content-modrinth-search-btn')?.addEventListener('click', () => searchContentModrinth(true));
  document.getElementById('content-modrinth-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchContentModrinth(true); });
}

async function loadContentInstances() {
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

async function loadContent() {
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
      if (r?.error) mostrarMensaje('❌ ' + r.error); else { mostrarMensaje(enabled ? '✅ Activado' : '✅ Desactivado'); loadContent(); }
    }));
    list.querySelectorAll('.content-backup-btn').forEach(btn => btn.addEventListener('click', async () => {
      const r = await window.launcherAPI.createWorldBackup(instance, btn.dataset.name);
      if (r?.success) mostrarMensaje('✅ Backup del mundo creado'); else mostrarMensaje('❌ ' + (r?.error || 'No se pudo crear el backup'));
    }));
    list.querySelectorAll('.content-rename-btn').forEach(btn => btn.addEventListener('click', async () => {
      const next = prompt('Nuevo nombre:', btn.dataset.name);
      if (!next || next === btn.dataset.name) return;
      const r = await window.launcherAPI.renameContent(instance, currentContentType, btn.dataset.name, next);
      if (r?.error) mostrarMensaje('❌ ' + r.error); else { mostrarMensaje('✅ Renombrado'); loadContent(); }
    }));
    list.querySelectorAll('.content-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${btn.dataset.name}"? Esta acción no se puede deshacer.`)) return;
      const r = await window.launcherAPI.deleteContent(instance, currentContentType, btn.dataset.name);
      if (r?.error) mostrarMensaje('❌ ' + r.error); else { mostrarMensaje('✅ Eliminado'); loadContent(); }
    }));
  } catch (error) {
    list.innerHTML = `<div class="feature-card"><h3>Error</h3><p class="muted">${escapeHtml(error.message)}</p></div>`;
  }
}

let contentModrinthOffset = 0;
async function searchContentModrinth(reset = true) {
  const results = document.getElementById('content-modrinth-results');
  const query = document.getElementById('content-modrinth-search')?.value?.trim() || '';
  const instance = document.getElementById('content-instance-select')?.value;
  if (!results) return;
  if (!instance) { mostrarMensaje('⚠️ Selecciona una instancia'); return; }
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
        mostrarMensaje(`✅ Instalado ${r.version ? `v${r.version}` : ''}`);
        await loadContent();
      } catch (e) { mostrarMensaje('❌ ' + e.message); }
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
        mostrarMensaje(`✅ Instalado ${selected.version_number}`); loadContent();
      } catch (e) { mostrarMensaje('❌ ' + e.message); }
    }));
  } catch (e) {
    results.innerHTML = `<div class="feature-card" style="grid-column:1/-1;"><h3>Error de Modrinth</h3><p class="muted">${escapeHtml(e.message)}</p></div>`;
  }
}


// Autenticación offline
async function checkSession() {
  try {
    const user = await window.launcherAPI.getCurrentUser();
    if (user) { localStorage.setItem('offlineUser', user.name); updateProfileUI(user); }
    else { localStorage.removeItem('offlineUser'); updateProfileUI(null); }
  } catch (_) { updateProfileUI(null); }
}

async function loginOffline() {
  const username = document.getElementById('offline-username')?.value?.trim();
  if (!username) {
    mostrarMensaje('⚠️ Por favor, ingresa un nombre de usuario');
    return;
  }
  try {
    const result = await window.launcherAPI.loginOffline(username);
    if (!result.success) throw new Error(result.error || 'No se pudo iniciar sesión offline');
    localStorage.setItem('offlineUser', result.user.name);
    updateProfileUI(result.user);
    loadAccounts();
    mostrarMensaje(`✅ Sesión offline iniciada como ${result.user.name}`);
  } catch (error) {
    console.error('Error en login offline:', error);
    mostrarMensaje('❌ Error: ' + error.message);
  }
}

async function logout() {
  await window.launcherAPI.logoutOffline();
  localStorage.removeItem('offlineUser');
  updateProfileUI(null);
  loadAccounts();
  mostrarMensaje('Sesión offline cerrada');
}

function updateProfileUI(user) {
  const nameDisplay = document.getElementById('username-display');
  const statusText = document.getElementById('status-text');
  const profileName = document.getElementById('profile-name');
  const profileType = document.getElementById('profile-type');
  const logoutBtn = document.getElementById('logout-btn');

  if (user) {
    if (nameDisplay) nameDisplay.textContent = user.name;
    if (statusText) {
      statusText.textContent = 'Modo offline';
      statusText.style.color = '#f39c12';
    }
    profileName.textContent = user.name;
    profileType.textContent = '🔓 Cuenta offline';
    profileType.style.color = '#f39c12';
    updateProfileAvatar(user.name);
    if (logoutBtn) {
      logoutBtn.style.display = 'inline-flex';
      logoutBtn.textContent = 'Cerrar Sesión';
    }
  } else {
    if (nameDisplay) nameDisplay.textContent = 'Invitado';
    if (statusText) {
      statusText.textContent = 'Modo offline';
      statusText.style.color = '#6b7280';
    }
    profileName.textContent = 'Jugador Offline';
    profileType.textContent = '🔓 Sin sesión activa';
    profileType.style.color = '#6b7280';
    updateProfileAvatar(null);
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// Caché
async function updateCacheSize() {
    try {
        const size = await window.launcherAPI.getCacheSize();
        const el = document.getElementById('cache-size');
        if (el) {
            const mb = (size / 1024 / 1024).toFixed(2);
            el.innerHTML = `📦 ${mb} MB en caché`;
        }
    } catch (e) {
        document.getElementById('cache-size').textContent = '⚠️ Error';
    }
}

async function clearCache() {
    if (!confirm('¿Limpiar caché? Se descargarán de nuevo los assets.')) return;
    try {
        const result = await window.launcherAPI.clearCache();
        if (result.success) {
            mostrarMensaje('✅ Caché limpiada');
            await updateCacheSize();
        } else {
            mostrarMensaje('❌ Error: ' + (result.error || 'Error desconocido'));
        }
    } catch (e) {
        mostrarMensaje('❌ Error: ' + e.message);
    }
}

// Toast
function mostrarMensaje(mensaje) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}


// 
let detailInstancePath = null;
let terminalEntries = [];
let terminalFilter = 'all';
let terminalSearch = '';

function terminalOpen() {
  const nav = document.querySelector('[data-target="page-terminal"]');
  if (nav) nav.click();
  const badge = document.getElementById('terminal-badge');
  if (badge) badge.style.display = 'inline-flex';
}

function terminalAppend(entry) {
  const normalized = {
    level: ['error','warn','info'].includes(entry?.level) ? entry.level : 'info',
    source: String(entry?.source || 'launcher'),
    message: String(entry?.message || ''),
    timestamp: entry?.timestamp || new Date().toISOString(),
    progress: entry?.progress
  };
  if (!normalized.message) return;
  terminalEntries.push(normalized);
  if (terminalEntries.length > 2500) terminalEntries.splice(0, terminalEntries.length - 2500);
  renderTerminal();
}

function renderTerminal() {
  const box = document.getElementById('terminal-log');
  if (!box) return;
  const query = terminalSearch.trim().toLowerCase();
  const filtered = terminalEntries.filter(e => {
    const typeOk = terminalFilter === 'all' || e.level === terminalFilter;
    const searchOk = !query || `${e.source} ${e.message}`.toLowerCase().includes(query);
    return typeOk && searchOk;
  });
  box.innerHTML = filtered.map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const progress = typeof e.progress === 'number' ? ` <span style="color:#64748b">(${e.progress}%)</span>` : '';
    return `<div class="terminal-line ${e.level}"><span class="terminal-time">[${escapeHtml(time)}]</span><span class="terminal-source">[${escapeHtml(e.source)}]</span>${escapeHtml(e.message)}${progress}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
  const left = document.getElementById('terminal-status-left');
  const right = document.getElementById('terminal-status-right');
  if (left) left.textContent = terminalEntries.length ? `Live Log · ${terminalEntries[terminalEntries.length - 1].source}` : 'Esperando actividad...';
  if (right) right.textContent = `${filtered.length} líneas`;
}

async function openInstanceDetails(instancePath) {
  detailInstancePath = instancePath;
  try {
    const instances = await window.launcherAPI.getInstances();
    const instance = instances.find(i => i.path === instancePath);
    const details = await window.launcherAPI.getInstanceDetails(instancePath);
    const cfg = await window.launcherAPI.getInstanceConfig(instancePath);
    const mods = await window.launcherAPI.listInstanceMods(instancePath);
    document.getElementById('instance-details-title').textContent = instance?.name || 'Instancia';
    document.getElementById('instance-details-subtitle').textContent = instancePath;
    document.getElementById('detail-version').textContent = instance?.version || details?.version || '—';
    document.getElementById('detail-loader').textContent = instance?.loader || 'Vanilla';
    document.getElementById('detail-mod-count').textContent = mods.length;
    const ramMb = Math.max(1024, Math.min(32768, Number(cfg.ram || 4096)));
    document.getElementById('detail-ram').textContent = `${(ramMb / 1024).toFixed(1)} GB`;
    const ramRange = document.getElementById('detail-ram-range');
    const ramInput = document.getElementById('detail-ram-input');
    const ramValue = document.getElementById('detail-ram-control-value');
    if (ramRange) ramRange.value = ramMb;
    if (ramInput) ramInput.value = ramMb;
    if (ramValue) ramValue.textContent = `${(ramMb / 1024).toFixed(1)} GB`;
    renderInstanceDetailMods(mods);
    document.getElementById('modal-instancia-detalles').classList.add('show');
  } catch (e) {
    mostrarMensaje('❌ No se pudieron cargar los detalles: ' + e.message);
  }
}

function closeInstanceDetails() {
  document.getElementById('modal-instancia-detalles')?.classList.remove('show');
  detailInstancePath = null;
}

function renderInstanceDetailMods(mods) {
  const box = document.getElementById('instance-detail-mods');
  if (!box) return;
  if (!mods.length) {
    box.innerHTML = `<div class="feature-card" style="text-align:center;padding:24px;"><div style="font-size:32px;margin-bottom:8px;">🧩</div><h3>No hay mods instalados</h3><p class="muted" style="margin-top:6px;">Puedes instalarlos desde Explorar.</p></div>`;
    return;
  }
  box.innerHTML = mods.map(mod => {
    const label = escapeHtml(mod.title || mod.name || mod.activeFile || mod.file || 'Mod');
    const file = escapeHtml(mod.file || mod.activeFile || '');
    const meta = [mod.version || mod.gameVersion || '', mod.loader || '', mod.disabled ? 'Desactivado' : 'Activo'].filter(Boolean).join(' · ');
    return `<div class="mod-row ${mod.disabled ? 'disabled' : ''}">
      <div class="mod-row-main"><div class="mod-row-name" title="${file}">${label}</div><div class="mod-row-meta">${escapeHtml(meta || file)}</div></div>
      <label class="toggle-switch" title="Activar/desactivar mod"><input type="checkbox" data-mod-file="${file}" ${mod.disabled ? '' : 'checked'}><span class="toggle-pill"></span><span>${mod.disabled ? 'Desactivado' : 'Activo'}</span></label>
    </div>`;
  }).join('');
  box.querySelectorAll('input[data-mod-file]').forEach(input => input.addEventListener('change', async function() {
    if (!detailInstancePath) return;
    const previous = !this.checked;
    try {
      const r = await window.launcherAPI.toggleInstanceMod(detailInstancePath, this.dataset.modFile, this.checked);
      if (!r.success) throw new Error(r.error || 'No se pudo cambiar el estado');
      terminalAppend({ level:'info', source:'mod-manager', message:`${this.checked ? 'Activado' : 'Desactivado'}: ${this.dataset.modFile}` });
      await openInstanceDetails(detailInstancePath);
    } catch (e) {
      this.checked = previous;
      mostrarMensaje('❌ ' + e.message);
    }
  }));
}

async function checkDetailUpdates() {
  if (!detailInstancePath) return;
  terminalOpen();
  terminalAppend({ level:'info', source:'mod-manager', message:'Buscando actualizaciones de mods...' });
  try {
    const result = await window.launcherAPI.checkModUpdates(detailInstancePath);
    const updates = Array.isArray(result) ? result : (result?.updates || []);
    const count = updates.length;
    terminalAppend({ level:'info', source:'mod-manager', message:`Comprobación terminada: ${count} actualización(es) disponible(s).` });
    if (!count) return mostrarMensaje('✅ Todos los mods están actualizados');
    const names = updates.slice(0,5).map(u => u.title || u.file || u.activeFile || 'Mod').join(', ');
    const shouldUpdate = confirm(`Se encontraron ${count} actualización(es).\n\n${names}${count > 5 ? '…' : ''}\n\n¿Actualizar ahora? MineSteam creará copias de seguridad de los archivos sustituidos.`);
    if (!shouldUpdate) return mostrarMensaje(`🔄 ${count} actualización(es) disponible(s)`);
    const updated = await window.launcherAPI.updateInstanceMods(detailInstancePath);
    if (updated?.success) {
      mostrarMensaje(`✅ ${updated.updated || count} mod(s) actualizado(s)`);
      terminalAppend({ level:'info', source:'mod-manager', message:`Actualización completada. Backups: ${updated.backupsCreated || 0}.` });
      await openInstanceDetails(detailInstancePath);
    } else {
      throw new Error(updated?.error || `${updated?.failed || 0} actualización(es) fallaron`);
    }
  } catch (e) { terminalAppend({level:'error',source:'mod-manager',message:e.message}); mostrarMensaje('❌ ' + e.message); }
}

document.getElementById('detail-check-modpack')?.addEventListener('click', checkSmartModpack);

async function exportCurrentInstance() {
  if (!detailInstancePath) return;
  terminalOpen();
  terminalAppend({ level:'info', source:'export', message:'Preparando exportación de la instancia...' });
  try {
    const r = await window.launcherAPI.exportInstance(detailInstancePath);
    if (!r.success) throw new Error(r.error || 'No se pudo exportar');
    terminalAppend({ level:'info', source:'export', message:`Instancia exportada: ${r.path}` });
    mostrarMensaje('✅ Instancia exportada correctamente');
  } catch (e) { terminalAppend({level:'error',source:'export',message:e.message}); mostrarMensaje('❌ ' + e.message); }
}

async function backupSelectedWorld() {
  const select = document.getElementById('content-instance-select');
  if (!select?.value || currentContentType !== 'worlds') return;
  const worlds = await window.launcherAPI.listContent(select.value, 'worlds');
  if (!worlds.length) { mostrarMensaje('⚠️ No hay mundos para respaldar'); return; }
  const name = prompt('Nombre exacto del mundo a respaldar:', worlds[0].name);
  if (!name) return;
  const r = await window.launcherAPI.createWorldBackup(select.value, name);
  if (r?.success) mostrarMensaje('✅ Copia de seguridad creada'); else mostrarMensaje('❌ ' + (r?.error || 'No se pudo crear la copia'));
}

async function loadAccounts() {
  const box = document.getElementById('accounts-list');
  if (!box || !window.launcherAPI.getAccounts) return;
  try {
    const [accounts, active] = await Promise.all([window.launcherAPI.getAccounts(), window.launcherAPI.getCurrentUser()]);
    if (!accounts.length) { box.innerHTML = '<div class="feature-card"><p class="muted">No hay cuentas locales guardadas.</p></div>'; return; }
    box.innerHTML = accounts.map(a => `<div class="tool-card"><div><strong>${escapeHtml(a.name)}</strong><p>${a.id === active?.id ? 'Cuenta activa' : 'Cuenta offline'}</p></div><div style="display:flex;gap:6px;"><button class="btn-secondary account-select-btn" data-id="${escapeAttr(a.id)}" ${a.id===active?.id?'disabled':''}>${a.id===active?.id?'✓ Activa':'Usar'}</button><button class="btn-delete account-delete-btn" data-id="${escapeAttr(a.id)}">Eliminar</button></div></div>`).join('');
    box.querySelectorAll('.account-select-btn').forEach(b=>b.addEventListener('click',async()=>{const r=await window.launcherAPI.selectAccount(b.dataset.id); if(r?.error) return mostrarMensaje('❌ '+r.error); localStorage.setItem('offlineUser', r.name); updateProfileUI(r); loadAccounts(); mostrarMensaje(`✅ Cuenta activa: ${r.name}`); }));
    box.querySelectorAll('.account-delete-btn').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar esta cuenta local?')) return; const r=await window.launcherAPI.deleteAccount(b.dataset.id); if(r?.error) return mostrarMensaje('❌ '+r.error); const active=await window.launcherAPI.getCurrentUser(); if(active) localStorage.setItem('offlineUser',active.name); else localStorage.removeItem('offlineUser'); updateProfileUI(active); loadAccounts(); }));
  } catch (e) { box.innerHTML = `<div class="feature-card"><p class="muted">${escapeHtml(e.message)}</p></div>`; }
}

async function setupCrashAnalyzer() {
  const select=document.getElementById('crash-instance-select'); if(!select) return;
  const instances=await window.launcherAPI.getInstances();
  select.innerHTML='<option value="">Selecciona una instancia</option>'+instances.map(i=>`<option value="${escapeAttr(i.path)}">${escapeHtml(i.name)} — ${escapeHtml(i.version||'?')}</option>`).join('');
  document.getElementById('crash-analyze-btn')?.addEventListener('click',async()=>{
    if(!select.value) return mostrarMensaje('⚠️ Selecciona una instancia');
    const box=document.getElementById('crash-analysis-result'); box.style.display='block'; box.innerHTML='<p class="muted">Analizando logs...</p>';
    const r=await window.launcherAPI.analyzeCrash(select.value);
    if(r?.error){box.innerHTML=`<p style="color:var(--red)">${escapeHtml(r.error)}</p>`;return;}
    const causes=(r.causes||[]).map(c=>`<li>${escapeHtml(c)}</li>`).join('');
    box.innerHTML=`<strong>${escapeHtml(r.likelyCause||'Sin causa determinada')}</strong><p class="muted" style="margin-top:6px;">Archivos analizados: ${r.analyzedFiles?.length||0}</p>${causes?`<ul style="margin:8px 0 0 18px;">${causes}</ul>`:''}`;
  });
}

async function setupOptimizer() {
  const select=document.getElementById('optimizer-instance-select'); if(!select) return;
  const instances=await window.launcherAPI.getInstances();
  select.innerHTML='<option value="">Selecciona una instancia</option>'+instances.map(i=>`<option value="${escapeAttr(i.path)}">${escapeHtml(i.name)} — ${escapeHtml(i.version||'?')}</option>`).join('');
  const render=async()=>{const p=select.value; if(!p) return; const r=await window.launcherAPI.optimizerRecommendations(p); const box=document.getElementById('optimizer-status'); box.style.display='block'; box.innerHTML=`<strong>${escapeHtml(r.profile)}</strong><p class="muted" style="margin-top:6px;">RAM del sistema: ${r.totalRamGb} GB · Distancia de render: ${r.settings.renderDistance} · Simulación: ${r.settings.simulationDistance}</p>`;};
  document.getElementById('optimizer-analyze-btn')?.addEventListener('click',render);
  document.getElementById('optimizer-apply-btn')?.addEventListener('click',async()=>{if(!select.value)return mostrarMensaje('⚠️ Selecciona una instancia'); const r=await window.launcherAPI.optimizerApply(select.value,{}); if(r?.error)return mostrarMensaje('❌ '+r.error); await render(); mostrarMensaje('✅ Optimización aplicada. Se utilizará al abrir Minecraft.');});
}

function setupAppUpdater(){
  const status=document.getElementById('app-update-status');
  const btn=document.getElementById('app-update-check-btn');
  let updateAvailable=false;
  btn?.addEventListener('click',async()=>{
    if(updateAvailable){ if(status) status.textContent='Descargando actualización...'; const r=await window.launcherAPI.downloadAppUpdate(); if(r?.error&&status)status.textContent='No se pudo descargar: '+r.error; return; }
    if(status) status.textContent='Buscando actualizaciones...'; const r=await window.launcherAPI.checkAppUpdate(); if(r?.error && status) status.textContent='No se pudo comprobar: '+r.error;
  });
  window.launcherAPI.onUpdateStatus?.(payload=>{if(status)status.textContent=payload.message||payload.status;});
  window.launcherAPI.onUpdateAvailable?.(info=>{updateAvailable=true; if(btn)btn.innerHTML='<i class="fa-solid fa-download"></i> Descargar actualización'; if(status)status.innerHTML=`Nueva versión <strong>${escapeHtml(info.version)}</strong> disponible.`;});
  window.launcherAPI.onUpdateNotAvailable?.(()=>{if(status)status.textContent='MineSteam está actualizado.';});
  window.launcherAPI.onUpdateDownloaded?.(info=>{if(status)status.textContent=`Actualización ${info?.version||''} descargada. Se instalará al reiniciar.`;});
}

async function openInstanceBackupsModal() {
  if (!detailInstancePath) return;
  const modal = document.getElementById('modal-instance-backups');
  const box = document.getElementById('instance-backups-list');
  if (!modal || !box) return;
  modal.classList.add('show');
  const backups = await window.launcherAPI.listInstanceBackups(detailInstancePath);
  box.innerHTML = backups.length ? backups.map(b => `<div class="tool-card"><div><strong>${escapeHtml(b.name)}</strong><p>${(b.size/1024/1024).toFixed(1)} MB · ${new Date(b.modifiedAt).toLocaleString()}</p></div><button class="btn-secondary restore-instance-backup" data-path="${escapeAttr(b.path)}">Restaurar</button></div>`).join('') : '<div class="feature-card"><p class="muted">No hay backups de esta instancia.</p></div>';
  box.querySelectorAll('.restore-instance-backup').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Restaurar este backup reemplazará el contenido actual de la instancia. ¿Continuar?')) return;
    btn.disabled = true;
    const r = await window.launcherAPI.restoreInstanceBackup(detailInstancePath, btn.dataset.path);
    btn.disabled = false;
    if (r?.error) return mostrarMensaje('❌ ' + r.error);
    modal.classList.remove('show');
    mostrarMensaje('✅ Backup restaurado.');
    displayInstances();
  }));
}

async function createCurrentInstanceBackup() {
  if (!detailInstancePath) return;
  terminalAppend({level:'info',source:'backup',message:'Creando backup completo de la instancia...'});
  const r = await window.launcherAPI.createInstanceBackup(detailInstancePath, 'manual');
  if (r?.error) return mostrarMensaje('❌ ' + r.error);
  terminalAppend({level:'info',source:'backup',message:`Backup creado: ${r.name}`});
  mostrarMensaje('✅ Backup completo creado.');
  openInstanceBackupsModal();
}

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
    if (!detailInstancePath) return;
    const ram = Math.max(1024, Math.min(32768, Number(ramInput?.value) || 4096));
    const result = await window.launcherAPI.setInstanceConfig(detailInstancePath, { ram });
    if (result?.error) { mostrarMensaje('❌ ' + result.error); return; }
    syncRamControls(ram);
    document.getElementById('detail-ram').textContent = `${(ram / 1024).toFixed(1)} GB`;
    mostrarMensaje(`✅ RAM guardada: ${(ram / 1024).toFixed(1)} GB`);
    displayInstances();
  });
  document.getElementById('detail-open-terminal')?.addEventListener('click', () => { closeInstanceDetails(); terminalOpen(); });
  document.getElementById('detail-play')?.addEventListener('click', async () => { if (!detailInstancePath) return; const p = detailInstancePath; closeInstanceDetails(); await launchGame(p); });
  document.getElementById('detail-check-updates')?.addEventListener('click', checkDetailUpdates);
  document.getElementById('detail-export-instance')?.addEventListener('click', exportCurrentInstance);
  document.getElementById('detail-backup-instance')?.addEventListener('click', openInstanceBackupsModal);
  document.getElementById('instance-backup-now')?.addEventListener('click', createCurrentInstanceBackup);
  document.getElementById('instance-backups-close')?.addEventListener('click', () => document.getElementById('modal-instance-backups')?.classList.remove('show'));
  document.getElementById('detail-repair-advanced')?.addEventListener('click', async () => { if (!detailInstancePath) return; if (!confirm('MineSteam creará un backup antes de reparar la instancia. ¿Continuar?')) return; const r=await window.launcherAPI.repairInstanceAdvanced(detailInstancePath); if(r?.error) return mostrarMensaje('❌ '+r.error); mostrarMensaje('✅ Reparación avanzada completada. Backup preventivo creado.'); displayInstances(); });
  document.getElementById('detail-open-logs')?.addEventListener('click', async () => { if (!detailInstancePath) return; const r=await window.launcherAPI.openInstanceLogs(detailInstancePath); if(r?.error) mostrarMensaje('❌ '+r.error); else mostrarMensaje('📄 Carpeta de logs abierta.'); });
  document.getElementById('detail-open-folder')?.addEventListener('click', async () => { if (detailInstancePath) await window.launcherAPI.openInstanceFolder(detailInstancePath); });
  document.getElementById('terminal-clear-btn')?.addEventListener('click', () => { terminalEntries = []; renderTerminal(); });
  document.getElementById('terminal-search')?.addEventListener('input', e => { terminalSearch = e.target.value; renderTerminal(); });
  document.querySelectorAll('[data-terminal-filter]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-terminal-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    terminalFilter = btn.dataset.terminalFilter;
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
    const text = terminalEntries.map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] [${e.source}] ${e.message}`).join('\n');
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
      btn.addEventListener('click', backupSelectedWorld);
      wrap.appendChild(btn);
    }
  }
}


document.getElementById('search-input')?.addEventListener('input', () => { modpackPage = 1; });

async function updateSteamDashboard25() {
  try {
    const instances = await window.launcherAPI.getInstances();
    const active = instances[instances.length - 1];
    const modCount = document.getElementById('dash-mod-count');
    const worldCount = document.getElementById('dash-world-count');
    const serverName = document.getElementById('dash-server-name');
    const serverAddress = document.getElementById('dash-server-address');

    if (active) {
      try {
        const mods = await window.launcherAPI.listInstanceMods(active.path);
        if (modCount) modCount.textContent = `${Array.isArray(mods) ? mods.filter(m => m.enabled !== false).length : 0} habilitados`;
      } catch (_) {
        if (modCount) modCount.textContent = 'Gestionar';
      }
      try {
        const worlds = await window.launcherAPI.listContent(active.path, 'worlds');
        if (worldCount) worldCount.textContent = `${Array.isArray(worlds) ? worlds.length : 0} mundos`;
      } catch (_) {
        if (worldCount) worldCount.textContent = 'Gestionar';
      }
    } else {
      if (modCount) modCount.textContent = 'Sin instancia';
      if (worldCount) worldCount.textContent = '0 mundos';
    }

    const servers = await window.launcherAPI.getServers();
    const favorite = (servers || []).find(s => s.favorite) || (servers || [])[0];
    if (favorite) {
      if (serverName) serverName.textContent = favorite.name || 'Servidor favorito';
      if (serverAddress) serverAddress.textContent = `${favorite.address || 'localhost'}:${favorite.port || 25565}`;
    } else {
      if (serverName) serverName.textContent = 'Sin servidor';
      if (serverAddress) serverAddress.textContent = 'Añade un servidor desde la sección Servidores';
    }
  } catch (error) {
    console.warn('No se pudo actualizar el dashboard 2.9.1:', error);
  }
}

function setupMineSteam25Navigation() {
  const go = (targetId) => {
    const link = document.querySelector(`.nav a[data-target="${targetId}"]`);
    if (link) link.click();
  };

  document.querySelectorAll('.steampunk-topnav a[data-target], .card-action[data-target], .hero-detail-link[data-target]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      go(el.dataset.target);
      document.querySelectorAll('.steampunk-topnav a[data-target]').forEach(a => a.classList.remove('topnav-active'));
      const top = document.querySelector(`.steampunk-topnav a[data-target="${el.dataset.target}"]`);
      if (top) top.classList.add('topnav-active');
    });
  });

  document.querySelectorAll('.nav a[data-target]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.steampunk-topnav a[data-target]').forEach(a => a.classList.remove('topnav-active'));
      const top = document.querySelector(`.steampunk-topnav a[data-target="${link.dataset.target}"]`);
      if (top) top.classList.add('topnav-active');
    });
  });

  updateSteamDashboard25();
  window.setInterval(updateSteamDashboard25, 30000);
}

