import appState from '../state/appState.js';
import { formatBytes, timeAgo, escapeHtml } from './utils.js';

function updateInstanceCount(count) {
    const el = document.getElementById('profile-instances-count');
    if (el) el.textContent = count;
}

export async function loadInstances() {
    try {
        const instances = await window.launcherAPI.getInstances();
        updateInstanceCount(instances.length);
        appState.instances.list = instances;
        for (const id of ['library-badge', 'instances-count-badge']) {
            const badge = document.getElementById(id);
            if (badge) badge.textContent = instances.length;
        }
        return instances;
    } catch (e) { console.error(e); return []; }
}

export async function displayInstances() {
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
        appState.instances.list = instances;
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
        document.querySelectorAll('.launch-btn').forEach(btn => btn.addEventListener('click', async function(){ const original=this.innerHTML; this.disabled=true; this.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Cargando...'; await window.mineSteamUI?.launchGame?.(this.dataset.path); this.innerHTML=original; this.disabled=false; }));
        document.querySelectorAll('.folder-btn').forEach(btn => btn.addEventListener('click', async function(){ const r=await window.launcherAPI.openInstanceFolder(this.dataset.path); if(!r.success) window.mineSteamUI?.mostrarMensaje?.('❌ '+(r.error||'Error al abrir carpeta')); }));
        document.querySelectorAll('.favorite-btn').forEach(btn => btn.addEventListener('click', async function(){ const cfg=await window.launcherAPI.getInstanceConfig(this.dataset.path); await window.launcherAPI.setInstanceConfig(this.dataset.path,{favorite:!cfg.favorite}); displayInstances(); window.mineSteamUI?.updateRightSidebar?.(); }));
        document.querySelectorAll('.repair-btn').forEach(btn => btn.addEventListener('click', async function(){ const original=this.innerHTML; this.disabled=true; this.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>'; window.mineSteamUI?.mostrarMensaje?.('🛠️ Reparando instancia...'); const r=await window.launcherAPI.repairInstance(this.dataset.path); this.disabled=false; this.innerHTML=original; window.mineSteamUI?.mostrarMensaje?.(r.success?'✅ Instancia reparada':'❌ '+(r.error||'No se pudo reparar')); if(r.success) displayInstances(); }));
        document.querySelectorAll('.duplicate-btn').forEach(btn => btn.addEventListener('click', async function(){ const name=prompt('Nombre para la copia:'); if(!name)return; const r=await window.launcherAPI.duplicateInstance(this.dataset.path,name); window.mineSteamUI?.mostrarMensaje?.(r.success?`✅ ${r.name} creada`:'❌ '+(r.error||'No se pudo duplicar')); if(r.success){ await loadInstances(); displayInstances(); } }));
        document.querySelectorAll('.config-btn').forEach(btn => btn.addEventListener('click',()=>window.mineSteamUI?.openInstanceConfig?.(btn.dataset.path)));
        document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', async function(){ if(confirm('¿Eliminar esta instancia?')){ await window.launcherAPI.deleteInstance(this.dataset.path); await loadInstances(); displayInstances(); window.mineSteamUI?.updateLibrary?.(); window.mineSteamUI?.updateActivityGrid?.(); } }));
        document.querySelectorAll('.instance-card[data-instance-path]').forEach(card=>card.addEventListener('click',event=>{if(event.target.closest('button')||event.target.closest('input')||event.target.closest('select'))return;window.mineSteamUI?.openInstanceDetails?.(card.dataset.instancePath);}));
    } catch (e) {
        console.error(e); if(loading) loading.style.display='none'; container.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);">Error al cargar instancias: ${escapeHtml(e.message)}</div>`;
    }
}

export function setupInstanceFilters(){
    ['instances-search','instances-profile-filter','instances-favorites-only'].forEach(id=>{ const el=document.getElementById(id); if(!el || el.dataset.bound)return; el.dataset.bound='1'; el.addEventListener(id==='instances-search'?'input':'change',()=>displayInstances()); });
}