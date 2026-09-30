from pathlib import Path
p=Path('/mnt/data/work9/src/renderer/app.js')
s=p.read_text()
# capture blocks by markers
blocks={}
markers=[
('progress','// ============================================\n// PROGRESS BAR\n// ============================================','// ============================================\n// SKINS\n// ============================================'),
('import','// ============================================\n// IMPORTAR ZIP\n// ============================================','// ============================================\n// HISTORIAL DE DESCARGAS\n// ============================================'),
('version','// ============================================\n// VERSIÓN MÁS RECIENTE\n// ============================================','// ============================================\n// RAM SLIDER\n// ============================================'),
('ram','// ============================================\n// RAM SLIDER\n// ============================================','// ============================================\n// LOADER BUTTONS\n// ============================================'),
('loader','// ============================================\n// LOADER BUTTONS\n// ============================================','// ============================================\n// MODAL CREAR INSTANCIA\n// ============================================'),
('create','// ============================================\n// MODAL CREAR INSTANCIA\n// ============================================','// ============================================\n// MODAL INSTALAR MODPACK\n// ============================================'),
('install','// ============================================\n// MODAL INSTALAR MODPACK\n// ============================================','// ============================================\n// INSTANCIAS\n// ============================================'),
('launch','// ============================================\n// LANZAR JUEGO\n// ============================================','// ============================================\n// AUTENTICACIÓN OFFLINE\n// ============================================'),
('details','async function openInstanceDetails(instancePath) {','async function backupSelectedWorld() {'),
]
for name,a,b in markers:
    ia=s.find(a)
    ib=s.find(b, ia+len(a)) if ia>=0 else -1
    if ia<0 or ib<0: raise SystemExit(f'missing {name}')
    blocks[name]=s[ia:ib]
# details needs include through before backup; this includes open/close/render/check/export
# launch block has section heading and running map funcs.
# Build module with required functions from app blocks
module='''// Gestión de UI y flujos de instancia. Mantiene la lógica de instancia fuera del renderer principal.\nimport { sanitizeName, escapeHtml } from './utils.js';\nimport appState from '../state/appState.js';\n\nlet selectedLoader = 'vanilla';\nlet pendingInstallId = null;\n\nexport function initInstanceUI(deps = {}) {\n    const { loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje, terminalOpen, terminalAppend, updateProfileAvatar } = deps;\n    setupProgressBar();\n    setupRamSlider();\n    setupLoaderButtons();\n    setupModal({ loadInstances, displayInstances, updateActivityGrid, addDownloadHistory, mostrarMensaje });\n    setupModalInstalacion({ loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje });\n    setupDetailActions({ mostrarMensaje, terminalOpen, terminalAppend });\n    return { abrirModal, cerrarModal, abrirModalInstalacion, launchGame, openInstanceDetails, importZipHandler };\n}\n\n'''
# convert standalone function blocks by replacing section comments and making dependencies local via module-level deps
module += "let instanceDeps = {};\n\n"
# progress, version, ram, loader can be copied directly, but progress standalone
for key in ['progress','version','ram','loader']:
    text=blocks[key]
    # remove section header comments only; retain functions
    module += text + '\n'
# For create modal: strip setupModal and make it use instanceDeps
create=blocks['create']
create=create.replace("function setupModal() {", "function setupModal(deps = {}) {\n    instanceDeps = deps;")
# Since setupModal sets instanceDeps, installation overwrites; okay but same deps shape. Better explicit helper below.
# rewrite functions to use instanceDeps already available.
module += create + '\n'
install=blocks['install']
install=install.replace("function setupModalInstalacion() {", "function setupModalInstalacion(deps = {}) {\n    instanceDeps = deps;")
module += install + '\n'
# import handler
imp=blocks['import']
module += imp + '\n'
# launch
module += blocks['launch'] + '\n'
# details block starts at function and ends before backup; no heading, good
module += blocks['details'] + '\n'
# helper for detail actions, and make deps available
module += '''\nfunction setupDetailActions(deps = {}) {\n    instanceDeps = { ...instanceDeps, ...deps };\n    document.getElementById('detail-check-modpack')?.addEventListener('click', checkSmartModpack);\n}\n\nasync function checkSmartModpack() {\n  if(!appState.instance.detailPath) return;\n  try { const r=await window.launcherAPI.checkModpackUpdate(appState.instance.detailPath); if(!r.isModpack){instanceDeps.mostrarMensaje?.('ℹ️ Esta instancia no es un modpack de Modrinth');return;} if(r.updateAvailable){instanceDeps.mostrarMensaje?.(`🆕 ${r.title}: ${r.currentVersion} → ${r.latestVersion}`); instanceDeps.terminalAppend?.({level:'info',source:'modpack',message:`Actualización disponible: ${r.currentVersion} → ${r.latestVersion}`});} else instanceDeps.mostrarMensaje?.('✅ El modpack está actualizado'); } catch(e){instanceDeps.mostrarMensaje?.('❌ '+e.message);}\n}\n'''
# The create/install setup functions set instanceDeps, but init calls setupModal then setupModalInstalacion. fine.
# Replace deps in functions where original names are globals.
repls={
"mostrarMensaje(": "instanceDeps.mostrarMensaje?.(",
"loadInstances();": "instanceDeps.loadInstances?.();",
"displayInstances();": "instanceDeps.displayInstances?.();",
"updateActivityGrid();": "instanceDeps.updateActivityGrid?.();",
"addDownloadHistory(": "instanceDeps.addDownloadHistory?.(",
"updateLibrary();": "instanceDeps.updateLibrary?.();",
"terminalAppend(": "instanceDeps.terminalAppend?.(",
"terminalOpen();": "instanceDeps.terminalOpen?.();",
}
# Avoid replacing function declaration names / strings by careful broad acceptable; restore accidental declarations none in module except updateLibrary? no.
for a,b in repls.items(): module=module.replace(a,b)
# This accidentally changes setupModal deps object property? no.
# setupModal function now calls setupModal? no.
# import event file.path preserved.
# append export for selected loader state? no.
module += "\nexport { importZipHandler, setupModal, setupModalInstalacion, setupProgressBar, setupRamSlider, setupLoaderButtons, abrirModal, cerrarModal, crearInstancia, abrirModalInstalacion, cerrarModalInstalacion, confirmarInstalacion, launchGame, openInstanceDetails, closeInstanceDetails, exportCurrentInstance, checkDetailUpdates, backupSelectedWorld, markInstanceLaunching, updateRunningInstanceButtons };\n"
Path('/mnt/data/work9/src/renderer/modules/instanceUI.js').write_text(module)
# Remove blocks from app, longest positions first based on original string, except details exact range
for name,a,b in markers:
    ia=s.find(a); ib=s.find(b, ia+len(a)) if ia>=0 else -1
    s=s[:ia]+s[ib:]
# Remove checkSmartModpack standalone left near navigation
start=s.find('async function checkSmartModpack()')
if start>=0:
    end=s.find('\n// ============================================\n// NAVEGACIÓN', start)
    if end<0: raise SystemExit('checkSmart end missing')
    s=s[:start]+s[end+1:]
# Remove selectedLoader declaration and running map duplicate if details/launch removed
s=s.replace("let selectedLoader = 'vanilla';\n","")
# import instance module and initialize
needle="import { initUIServices, mostrarMensaje, checkSession, loginOffline, logout, updateProfileUI, updateCacheSize, clearCache, loadAccounts, setupAppUpdater } from './modules/uiServices.js';"
s=s.replace(needle, needle+"\nimport { initInstanceUI, importZipHandler, abrirModal, abrirModalInstalacion, launchGame, openInstanceDetails } from './modules/instanceUI.js';")
# init after UI services init
s=s.replace("    setupNavigation({", "    initInstanceUI({ loadInstances, displayInstances, updateActivityGrid, updateLibrary, addDownloadHistory, mostrarMensaje, terminalOpen, terminalAppend, updateProfileAvatar });\n\n    setupNavigation({")
# remove now duplicate calls setupModal etc
s=s.replace("    setupModal();\n    setupModalInstalacion();\n    setupSkinModal();", "    setupSkinModal();")
# setupEventListeners still calls import handler locally; imported symbol okay
# remove local references setupProgressBar/setupRamSlider/setupLoaderButtons/loadLatestVersion no longer defined; imported only needed calls. Add import names.
s=s.replace("import { initInstanceUI, importZipHandler, abrirModal, abrirModalInstalacion, launchGame, openInstanceDetails } from './modules/instanceUI.js';", "import { initInstanceUI, importZipHandler, abrirModal, abrirModalInstalacion, launchGame, openInstanceDetails, setupProgressBar, setupRamSlider, setupLoaderButtons, loadLatestVersion } from './modules/instanceUI.js';")
# openInstanceDetails likely used by inline handlers via global? app.js event? Keep export and assign window funcs below init.
# update setupEventListeners: open creation functions local import okay. import handler local imported.
p.write_text(s)
