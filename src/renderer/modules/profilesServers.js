import { escapeHtml } from './utils.js';
import appState from '../state/appState.js';

let editingProfileId = null;
let editingServerId = null;

let deps = {};

export function initProfilesServers(dependencies) {
  deps = dependencies;
  setupProfilesServers();
}

const mostrarMensaje = (...args) => deps.mostrarMensaje?.(...args);
const displayInstances = (...args) => deps.displayInstances?.(...args);
const updateSteamDashboard25 = (...args) => deps.updateSteamDashboard25?.(...args);

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

export async function loadProfilesPage() {
  const grid = document.getElementById('profiles-grid');
  if (!grid) return;
  try {
    const [profiles, active] = await Promise.all([window.launcherAPI.getProfiles(), window.launcherAPI.getActiveProfile()]);
    appState.profiles.list = profiles || [];
    appState.profiles.active = active || null;
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

export async function loadServersPage() {
  const grid=document.getElementById('servers-grid'); if(!grid) return;
  try {
    const servers=await window.launcherAPI.getServers();
    appState.servers = appState.servers || { list: [], favorite: null };
    appState.servers.list = servers || [];
    appState.servers.favorite = (servers || []).find(s => s.favorite) || null;
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

