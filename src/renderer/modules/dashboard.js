import appState from '../state/appState.js';

/** Dashboard principal: datos y navegación de la home. */
export async function updateActivityGrid() {
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
                <h4>${escapeHtmlLocal(inst.name)}</h4>
                <div class="version">v${escapeHtmlLocal(inst.version || '1.0.0')}</div>
                <div class="news">
                    <span><i class="fa-regular fa-clock"></i> ${escapeHtmlLocal(timeAgoLocal(inst.installedAt))}</span>
                    <span class="badge">${escapeHtmlLocal(inst.loader || 'Vanilla')}</span>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

export async function updateLibrary({ launchGame } = {}) {
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
                    <span class="name">${escapeHtmlLocal(inst.name)}</span>
                    <span class="meta"><i class="fa-solid fa-cube"></i> ${escapeHtmlLocal(inst.loader || 'Vanilla')} - ${escapeHtmlLocal(inst.version || '?')}</span>
                </div>
                <button class="btn-play-green launch-btn-small" data-path="${escapeAttrLocal(inst.path)}" style="padding:4px 12px; border-radius:6px; font-size:11px; font-weight:600;">JUGAR</button>
            </div>
        `).join('');
        document.querySelectorAll('.launch-btn-small').forEach(btn => {
            btn.addEventListener('click', async function() {
                if (typeof launchGame !== 'function') return;
                const ram = parseInt(localStorage.getItem('ram')) || 4096;
                await launchGame(this.dataset.path, ram);
            });
        });
    } catch (e) { console.error(e); }
}

export async function updateFeaturedModpack({ launchGame } = {}) {
    try {
        const instances = await window.launcherAPI.getInstances();
        if (instances.length === 0) {
            setText('featured-title', 'Bienvenido a MineSteam');
            setText('featured-desc', 'Comienza tu aventura instalando un modpack');
            setText('featured-loader', 'Sin modpacks instalados');
            setText('featured-mods', 'Explora la biblioteca');
            return;
        }
        const last = instances[instances.length - 1];
        setText('featured-title', last.name);
        setText('featured-desc', 'Listo para jugar');
        setText('featured-loader', `${last.loader || 'Vanilla'} ${last.version || '?'}`);
        setText('featured-mods', last.type || 'Modpack');
        const playBtn = document.getElementById('btn-jugar');
        if (playBtn && typeof launchGame === 'function') playBtn.onclick = () => launchGame(last.path);
    } catch (e) { console.error(e); }
}

export async function updateSteamDashboard25() {
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
            } catch (_) { if (modCount) modCount.textContent = 'Gestionar'; }
            try {
                const worlds = await window.launcherAPI.listContent(active.path, 'worlds');
                if (worldCount) worldCount.textContent = `${Array.isArray(worlds) ? worlds.length : 0} mundos`;
            } catch (_) { if (worldCount) worldCount.textContent = 'Gestionar'; }
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
        appState.dashboard.lastUpdated = Date.now();
    } catch (error) { console.warn('No se pudo actualizar el dashboard:', error); }
}

export function setupDashboardNavigation({ updateDashboard = updateSteamDashboard25 } = {}) {
    const go = (targetId) => {
        const link = document.querySelector(`.nav a[data-target="${targetId}"]`);
        if (link) link.click();
    };
    document.querySelectorAll('.steampunk-topnav a[data-target], .card-action[data-target], .hero-detail-link[data-target]').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            go(el.dataset.target);
            document.querySelectorAll('.steampunk-topnav a[data-target]').forEach(a => a.classList.remove('topnav-active'));
            document.querySelector(`.steampunk-topnav a[data-target="${el.dataset.target}"]`)?.classList.add('topnav-active');
        });
    });
    document.querySelectorAll('.nav a[data-target]').forEach(link => {
        link.addEventListener('click', () => {
            document.querySelectorAll('.steampunk-topnav a[data-target]').forEach(a => a.classList.remove('topnav-active'));
            document.querySelector(`.steampunk-topnav a[data-target="${link.dataset.target}"]`)?.classList.add('topnav-active');
        });
    });
    updateDashboard();
    window.setInterval(updateDashboard, 30000);
}

function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value ?? ''; }
function escapeHtmlLocal(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
function escapeAttrLocal(value) { return escapeHtmlLocal(value).replace(/"/g, '&quot;'); }
function timeAgoLocal(date) { if (!date) return 'sin fecha'; const diff = Date.now() - new Date(date).getTime(); const mins = Math.floor(diff / 60000); if (mins < 1) return 'ahora'; if (mins < 60) return `hace ${mins} min`; const hours = Math.floor(mins / 60); if (hours < 24) return `hace ${hours} h`; return `hace ${Math.floor(hours / 24)} d`; }
