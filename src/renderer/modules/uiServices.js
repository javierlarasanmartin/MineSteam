import { escapeHtml } from './utils.js';

let deps = {
  updateProfileAvatar: () => {},
  loadAccounts: () => {},
  mostrarMensaje: () => {},
};

export function initUIServices(options = {}) {
  deps = { ...deps, ...options };
}

export function mostrarMensaje(mensaje) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

export async function checkSession() {
  try {
    const user = await window.launcherAPI.getCurrentUser();
    if (user) { localStorage.setItem('offlineUser', user.name); updateProfileUI(user); }
    else { localStorage.removeItem('offlineUser'); updateProfileUI(null); }
  } catch (_) { updateProfileUI(null); }
}

export async function loginOffline() {
  const username = document.getElementById('offline-username')?.value?.trim();
  if (!username) return mostrarMensaje('⚠️ Por favor, ingresa un nombre de usuario');
  try {
    const result = await window.launcherAPI.loginOffline(username);
    if (!result.success) throw new Error(result.error || 'No se pudo iniciar sesión offline');
    localStorage.setItem('offlineUser', result.user.name);
    updateProfileUI(result.user);
    deps.loadAccounts();
    mostrarMensaje(`✅ Sesión offline iniciada como ${result.user.name}`);
  } catch (error) {
    console.error('Error en login offline:', error);
    mostrarMensaje('❌ Error: ' + error.message);
  }
}

export async function logout() {
  await window.launcherAPI.logoutOffline();
  localStorage.removeItem('offlineUser');
  updateProfileUI(null);
  deps.loadAccounts();
  mostrarMensaje('Sesión offline cerrada');
}

export function updateProfileUI(user) {
  const nameDisplay = document.getElementById('username-display');
  const statusText = document.getElementById('status-text');
  const profileName = document.getElementById('profile-name');
  const profileType = document.getElementById('profile-type');
  const logoutBtn = document.getElementById('logout-btn');

  if (user) {
    if (nameDisplay) nameDisplay.textContent = user.name;
    if (statusText) { statusText.textContent = 'Modo offline'; statusText.style.color = '#f39c12'; }
    if (profileName) profileName.textContent = user.name;
    if (profileType) { profileType.textContent = '🔓 Cuenta offline'; profileType.style.color = '#f39c12'; }
    deps.updateProfileAvatar(user.name);
    if (logoutBtn) { logoutBtn.style.display = 'inline-flex'; logoutBtn.textContent = 'Cerrar Sesión'; }
  } else {
    if (nameDisplay) nameDisplay.textContent = 'Invitado';
    if (statusText) { statusText.textContent = 'Modo offline'; statusText.style.color = '#6b7280'; }
    if (profileName) profileName.textContent = 'Jugador Offline';
    if (profileType) { profileType.textContent = '🔓 Sin sesión activa'; profileType.style.color = '#6b7280'; }
    deps.updateProfileAvatar(null);
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

export async function updateCacheSize() {
  try {
    const size = await window.launcherAPI.getCacheSize();
    const el = document.getElementById('cache-size');
    if (el) el.textContent = `📦 ${(size / 1024 / 1024).toFixed(2)} MB en caché`;
  } catch (_) {
    const el = document.getElementById('cache-size');
    if (el) el.textContent = '⚠️ Error';
  }
}

export async function clearCache() {
  if (!confirm('¿Limpiar caché? Se descargarán de nuevo los assets.')) return;
  try {
    const result = await window.launcherAPI.clearCache();
    if (result.success) { mostrarMensaje('✅ Caché limpiada'); await updateCacheSize(); }
    else mostrarMensaje('❌ Error: ' + (result.error || 'Error desconocido'));
  } catch (e) { mostrarMensaje('❌ Error: ' + e.message); }
}

export async function loadAccounts() {
  const box = document.getElementById('accounts-list');
  if (!box || !window.launcherAPI.getAccounts) return;
  try {
    const [accounts, active] = await Promise.all([window.launcherAPI.getAccounts(), window.launcherAPI.getCurrentUser()]);
    if (!accounts.length) { box.innerHTML = '<div class="feature-card"><p class="muted">No hay cuentas locales guardadas.</p></div>'; return; }
    box.innerHTML = accounts.map(a => `<div class="tool-card"><div><strong>${escapeHtml(a.name)}</strong><p>${a.id === active?.id ? 'Cuenta activa' : 'Cuenta offline'}</p></div><div style="display:flex;gap:6px;"><button class="btn-secondary account-select-btn" data-id="${escapeHtml(a.id)}" ${a.id===active?.id?'disabled':''}>${a.id===active?.id?'✓ Activa':'Usar'}</button><button class="btn-delete account-delete-btn" data-id="${escapeHtml(a.id)}">Eliminar</button></div></div>`).join('');
    box.querySelectorAll('.account-select-btn').forEach(b => b.addEventListener('click', async () => {
      const r = await window.launcherAPI.selectAccount(b.dataset.id);
      if (r?.error) return mostrarMensaje('❌ ' + r.error);
      localStorage.setItem('offlineUser', r.name); updateProfileUI(r); loadAccounts(); mostrarMensaje(`✅ Cuenta activa: ${r.name}`);
    }));
    box.querySelectorAll('.account-delete-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta cuenta local?')) return;
      const r = await window.launcherAPI.deleteAccount(b.dataset.id);
      if (r?.error) return mostrarMensaje('❌ ' + r.error);
      const active = await window.launcherAPI.getCurrentUser();
      if (active) localStorage.setItem('offlineUser', active.name); else localStorage.removeItem('offlineUser');
      updateProfileUI(active); loadAccounts();
    }));
  } catch (e) { box.innerHTML = `<div class="feature-card"><p class="muted">${escapeHtml(e.message)}</p></div>`; }
}

export function setupAppUpdater() {
  const status = document.getElementById('app-update-status');
  const btn = document.getElementById('app-update-check-btn');
  let updateAvailable = false;
  btn?.addEventListener('click', async () => {
    if (updateAvailable) { if (status) status.textContent = 'Descargando actualización...'; const r = await window.launcherAPI.downloadAppUpdate(); if (r?.error && status) status.textContent = 'No se pudo descargar: ' + r.error; return; }
    if (status) status.textContent = 'Buscando actualizaciones...';
    const r = await window.launcherAPI.checkAppUpdate();
    if (r?.error && status) status.textContent = 'No se pudo comprobar: ' + r.error;
  });
  window.launcherAPI.onUpdateStatus?.(payload => { if (status) status.textContent = payload.message || payload.status; });
  window.launcherAPI.onUpdateAvailable?.(info => { updateAvailable = true; if (btn) btn.innerHTML = '<i class="fa-solid fa-download"></i> Descargar actualización'; if (status) status.innerHTML = `Nueva versión <strong>${escapeHtml(info.version)}</strong> disponible.`; });
  window.launcherAPI.onUpdateNotAvailable?.(() => { if (status) status.textContent = 'MineSteam está actualizado.'; });
  window.launcherAPI.onUpdateDownloaded?.(info => { if (status) status.textContent = `Actualización ${info?.version || ''} descargada. Se instalará al reiniciar.`; });
}
