// Gestión de UI y flujos de instancia. Mantiene la lógica de instancia fuera del renderer principal.
import { sanitizeName, escapeHtml } from './utils.js';
import appState from '../state/appState.js';

let selectedLoader = 'vanilla';
let pendingInstallId = null;

export function initInstanceUI(deps = {}) {
    const { loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje, terminalOpen, terminalAppend, updateProfileAvatar } = deps;
    setupProgressBar();
    setupRamSlider();
    setupLoaderButtons();
    setupModal({ loadInstances, displayInstances, updateActivityGrid, addDownloadHistory, mostrarMensaje });
    setupModalInstalacion({ loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje });
    setupDetailActions({ mostrarMensaje, terminalOpen, terminalAppend });
    return { abrirModal, cerrarModal, abrirModalInstalacion, launchGame, openInstanceDetails, importZipHandler };
}

let instanceDeps = {};

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
function setupModal(deps = {}) {
    instanceDeps = deps;
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
    if (!nombre) { instanceDeps.mostrarMensaje?.('⚠️ Ingresa un nombre'); return; }
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
            instanceDeps.mostrarMensaje?.(`✅ Instancia "${nombre}" creada`);
            cerrarModal();
            instanceDeps.loadInstances?.();
            instanceDeps.displayInstances?.();
                    instanceDeps.updateActivityGrid?.();
            instanceDeps.addDownloadHistory?.(nombre, 'Personalizada');
        } else {
            instanceDeps.mostrarMensaje?.('❌ Error: ' + (result.error || 'Error desconocido'));
        }
    } catch (e) {
        instanceDeps.mostrarMensaje?.('❌ Error: ' + e.message);
    } finally {
        document.getElementById('form-crear-instancia').style.display = 'block';
        document.getElementById('modal-loading').style.display = 'none';
    }
}


// Modal instalar modpack
function setupModalInstalacion(deps = {}) {
    instanceDeps = deps;
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
    if (!projectId) { instanceDeps.mostrarMensaje?.('❌ Error: ID del modpack no válido'); return; }
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
        instanceDeps.mostrarMensaje?.('❌ ' + e.message);
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
    if (!pendingInstallId || !nombre) { instanceDeps.mostrarMensaje?.('⚠️ Completa el nombre de la instancia'); return; }
    if (!versionId) { instanceDeps.mostrarMensaje?.('⚠️ Selecciona una versión del modpack'); return; }
    document.getElementById('form-instalar-modpack').style.display = 'none';
    document.getElementById('modal-instalar-loading').style.display = 'block';
    try {
        const packInfo = await window.launcherAPI.getModrinthModpack(pendingInstallId);
        if (!packInfo?.versions?.length) throw new Error('Este modpack no tiene versiones instalables');
        const selected = packInfo.versions.find(v => v.id === versionId);
        if (!selected) throw new Error('La versión seleccionada ya no está disponible');
        const result = await window.launcherAPI.installModpack({ platform:'modrinth', projectId:pendingInstallId, versionId:selected.id, instanceName:nombre });
        if (result.success) {
            instanceDeps.mostrarMensaje?.(`✅ ${packInfo.title} instalado`);
            cerrarModalInstalacion();
            instanceDeps.loadInstances?.(); instanceDeps.displayInstances?.(); instanceDeps.updateLibrary?.(); instanceDeps.updateActivityGrid?.();
            instanceDeps.addDownloadHistory?.(packInfo.title, 'Modrinth');
        } else {
            instanceDeps.mostrarMensaje?.('❌ Error: ' + (result.error || 'Error desconocido'));
        }
    } catch (e) {
        instanceDeps.mostrarMensaje?.('❌ Error: ' + e.message);
    } finally {
        document.getElementById('form-instalar-modpack').style.display = 'block';
        document.getElementById('modal-instalar-loading').style.display = 'none';
    }
}



// Importar ZIP
async function importZipHandler(event) {
    const file = event.target.files[0];
    if (!file) return;
    const name = prompt('Nombre para la instancia:', file.name.replace('.zip', ''));
    if (!name) { event.target.value = ''; return; }
    try {
        instanceDeps.mostrarMensaje?.(`📥 Importando ${file.name}...`);
        const result = await window.launcherAPI.importZip(file.path, name);
        if (result.success) {
            instanceDeps.mostrarMensaje?.(`✅ Modpack "${name}" importado`);
            instanceDeps.loadInstances?.();
            instanceDeps.displayInstances?.();
                    instanceDeps.updateActivityGrid?.();
            instanceDeps.addDownloadHistory?.(name, 'Importación ZIP');
        } else {
            instanceDeps.mostrarMensaje?.('❌ Error al importar: ' + (result.error || 'Error desconocido'));
        }
    } catch (error) {
        instanceDeps.mostrarMensaje?.('❌ Error: ' + error.message);
    } finally {
        event.target.value = '';
    }
}


// Lanzar juego
async function launchGame(instancePath) {
    instanceDeps.mostrarMensaje?.('🚀 Lanzando Minecraft...');
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
            instanceDeps.mostrarMensaje?.('🎮 Minecraft se está iniciando. Puedes seguir navegando por MineSteam.');
        } else {
            instanceDeps.mostrarMensaje?.('❌ ' + (result?.error || 'No se pudo iniciar Minecraft'));
        }
    } catch (e) {
        instanceDeps.mostrarMensaje?.('❌ Error al lanzar: ' + e.message);
    }
}

export const runningInstances = new Map();
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


async function openInstanceDetails(instancePath) {
  appState.instance.detailPath = instancePath;
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
    instanceDeps.mostrarMensaje?.('❌ No se pudieron cargar los detalles: ' + e.message);
  }
}

function closeInstanceDetails() {
  document.getElementById('modal-instancia-detalles')?.classList.remove('show');
  appState.instance.detailPath = null;
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
    if (!appState.instance.detailPath) return;
    const previous = !this.checked;
    try {
      const r = await window.launcherAPI.toggleInstanceMod(appState.instance.detailPath, this.dataset.modFile, this.checked);
      if (!r.success) throw new Error(r.error || 'No se pudo cambiar el estado');
      instanceDeps.terminalAppend?.({ level:'info', source:'mod-manager', message:`${this.checked ? 'Activado' : 'Desactivado'}: ${this.dataset.modFile}` });
      await openInstanceDetails(appState.instance.detailPath);
    } catch (e) {
      this.checked = previous;
      instanceDeps.mostrarMensaje?.('❌ ' + e.message);
    }
  }));
}

async function checkDetailUpdates() {
  if (!appState.instance.detailPath) return;
  instanceDeps.terminalOpen?.();
  instanceDeps.terminalAppend?.({ level:'info', source:'mod-manager', message:'Buscando actualizaciones de mods...' });
  try {
    const result = await window.launcherAPI.checkModUpdates(appState.instance.detailPath);
    const updates = Array.isArray(result) ? result : (result?.updates || []);
    const count = updates.length;
    instanceDeps.terminalAppend?.({ level:'info', source:'mod-manager', message:`Comprobación terminada: ${count} actualización(es) disponible(s).` });
    if (!count) return instanceDeps.mostrarMensaje?.('✅ Todos los mods están actualizados');
    const names = updates.slice(0,5).map(u => u.title || u.file || u.activeFile || 'Mod').join(', ');
    const shouldUpdate = confirm(`Se encontraron ${count} actualización(es).\n\n${names}${count > 5 ? '…' : ''}\n\n¿Actualizar ahora? MineSteam creará copias de seguridad de los archivos sustituidos.`);
    if (!shouldUpdate) return instanceDeps.mostrarMensaje?.(`🔄 ${count} actualización(es) disponible(s)`);
    const updated = await window.launcherAPI.updateInstanceMods(appState.instance.detailPath);
    if (updated?.success) {
      instanceDeps.mostrarMensaje?.(`✅ ${updated.updated || count} mod(s) actualizado(s)`);
      instanceDeps.terminalAppend?.({ level:'info', source:'mod-manager', message:`Actualización completada. Backups: ${updated.backupsCreated || 0}.` });
      await openInstanceDetails(appState.instance.detailPath);
    } else {
      throw new Error(updated?.error || `${updated?.failed || 0} actualización(es) fallaron`);
    }
  } catch (e) { instanceDeps.terminalAppend?.({level:'error',source:'mod-manager',message:e.message}); instanceDeps.mostrarMensaje?.('❌ ' + e.message); }
}

document.getElementById('detail-check-modpack')?.addEventListener('click', checkSmartModpack);

async function exportCurrentInstance() {
  if (!appState.instance.detailPath) return;
  instanceDeps.terminalOpen?.();
  instanceDeps.terminalAppend?.({ level:'info', source:'export', message:'Preparando exportación de la instancia...' });
  try {
    const r = await window.launcherAPI.exportInstance(appState.instance.detailPath);
    if (!r.success) throw new Error(r.error || 'No se pudo exportar');
    instanceDeps.terminalAppend?.({ level:'info', source:'export', message:`Instancia exportada: ${r.path}` });
    instanceDeps.mostrarMensaje?.('✅ Instancia exportada correctamente');
  } catch (e) { instanceDeps.terminalAppend?.({level:'error',source:'export',message:e.message}); instanceDeps.mostrarMensaje?.('❌ ' + e.message); }
}



function setupDetailActions(deps = {}) {
    instanceDeps = { ...instanceDeps, ...deps };
    document.getElementById('detail-check-modpack')?.addEventListener('click', checkSmartModpack);
}

async function checkSmartModpack() {
  if(!appState.instance.detailPath) return;
  try { const r=await window.launcherAPI.checkModpackUpdate(appState.instance.detailPath); if(!r.isModpack){instanceDeps.mostrarMensaje?.('ℹ️ Esta instancia no es un modpack de Modrinth');return;} if(r.updateAvailable){instanceDeps.mostrarMensaje?.(`🆕 ${r.title}: ${r.currentVersion} → ${r.latestVersion}`); instanceDeps.terminalAppend?.({level:'info',source:'modpack',message:`Actualización disponible: ${r.currentVersion} → ${r.latestVersion}`});} else instanceDeps.mostrarMensaje?.('✅ El modpack está actualizado'); } catch(e){instanceDeps.mostrarMensaje?.('❌ '+e.message);}
}

async function backupSelectedWorld() {
  const select = document.getElementById('content-instance-select');
  if (!select?.value || appState.content?.type && appState.content.type !== 'worlds') return;
  const worlds = await window.launcherAPI.listContent(select.value, 'worlds');
  if (!worlds?.length) { instanceDeps.mostrarMensaje?.('⚠️ No hay mundos para respaldar'); return; }
  const name = prompt('Nombre exacto del mundo a respaldar:', worlds[0].name);
  if (!name) return;
  const r = await window.launcherAPI.createWorldBackup(select.value, name);
  if (r?.success) instanceDeps.mostrarMensaje?.('✅ Copia de seguridad creada');
  else instanceDeps.mostrarMensaje?.('❌ ' + (r?.error || 'No se pudo crear la copia'));
}

export { importZipHandler, setupModal, setupModalInstalacion, setupProgressBar, setupRamSlider, setupLoaderButtons, loadLatestVersion, abrirModal, cerrarModal, crearInstancia, abrirModalInstalacion, cerrarModalInstalacion, confirmarInstalacion, launchGame, openInstanceDetails, closeInstanceDetails, exportCurrentInstance, checkDetailUpdates, backupSelectedWorld, markInstanceLaunching, updateRunningInstanceButtons };
