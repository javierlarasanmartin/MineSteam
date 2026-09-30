
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');

const launcher = require('./src/core/launcherService');
const instanceService = require('./src/core/instanceService');
const { assertInstancePath, assertReadableFile } = require('./src/core/security');
const logger = require('./src/utils/logger');
const profileManager = require('./src/managers/profileManager');
const contentManager = require('./src/managers/contentManager');
const contentModrinth = require('./src/managers/contentModrinthManager');
const instanceTools = require('./src/managers/instanceToolsManager');
const instanceBackup = require('./src/managers/instanceBackupManager');
const accountManager = require('./src/managers/accountManager');
const optimizerManager = require('./src/managers/optimizerManager');
const diagnosticManager = require('./src/managers/diagnosticManager');
const updater = require('./src/utils/updater');
const javaManager = require('./src/utils/javaManager');
const { APP_ID, WINDOW } = require('./src/core/appConfig');

// Single instance lock (Prevenir múltiples instancias)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Configuración de app (Windows)
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.stack}`);
  dialog.showErrorBox('Error Inesperado', 
    `Ha ocurrido un error inesperado:\n\n${error.message}\n\nPor favor, reinicia la aplicación.`
  );
});

process.on('unhandledRejection', (reason) => {
  // Solo se registra: una promesa rechazada (p. ej. fallo de red) no justifica un diálogo bloqueante.
  logger.error(`Unhandled Rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

// Variables globales
let mainWindow = null;
let ipcRegistered = false;

// Helper para enviar mensajes al renderer de forma segura
function sendToRenderer(channel, data) {
  const win = mainWindow || BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(channel, data);
    } catch (error) {
      logger.error(`Error al enviar mensaje al renderer: ${error.message}`);
    }
  }
}

// Creación de ventana
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    frame: true,
    webPreferences: {
      nodeIntegration: false,           // ✅ Seguridad
      contextIsolation: true,           // ✅ Seguridad
      sandbox: false,                   // Se mantiene temporalmente mientras se completa la compatibilidad del preload
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.svg'),
    show: false // Esperar a que cargue
  });

  // Cargar la aplicación
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // ✅ Mostrar cuando esté lista
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Seguridad web
  
  // Bloquear navegación a sitios externos
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isFile = url.startsWith('file://');
    const isDev = process.env.NODE_ENV === 'development' && url.includes('localhost');
    
    if (!isFile && !isDev) {
      event.preventDefault();
      logger.warn(`Navegación bloqueada a: ${url}`);
    }
  });

  // Abrir enlaces externos en el navegador
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Dev tools (Solo en desarrollo)
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Manejo de cierre
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Configurar updater
  try {
    updater.setUpdater(mainWindow);
  } catch (error) {
    logger.warn(`Updater no disponible: ${error.message}`);
  }
}

// IPC register
const JAVA_VERSIONS = [8, 16, 17, 21, 25];

function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await handler(event, ...args);
      return result;
    } catch (error) {
      logger.error(`IPC ${channel}: ${error.stack || error.message}`);
      return { success: false, error: error.message };
    }
  });
}

// Handler de launch Minecraft
async function handleLaunchMinecraft(_event, data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datos de lanzamiento inválidos');
  }

  const safePath = assertInstancePath(data.instancePath);
  const saved = profileManager.getInstanceConfig(safePath);

  const launchData = {
    ...data,
    instancePath: safePath,
    ram: Number(data.ram || saved?.ram || 4096),
    javaVersion: data.javaVersion ?? saved?.javaVersion ?? undefined,
    jvmArgs: data.jvmArgs ?? saved?.jvmArgs ?? ''
  };

  // El lanzamiento dura hasta que se cierra el juego: no se espera aquí.
  // El resultado llega al renderer por el evento 'launch-state'.
  launcher.launchMinecraft(launchData).then(result => {
      sendToRenderer('launch-state', { instancePath: safePath, state: 'finished', result });
    })
    .catch(error => {
      logger.error(`Lanzamiento ${safePath} falló: ${error.stack || error.message}`);
      sendToRenderer('launch-state', { instancePath: safePath, state: 'error', error: error.message });
      sendToRenderer('terminal-log', {
        level: 'error',
        source: 'launcher',
        message: `Error al lanzar Minecraft: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    });

  return { success: true, started: true, instancePath: safePath };
}

// Handler de cuentas
async function handleLoginOffline(_event, username) {
  const activeProfile = profileManager.getActiveProfile();
  if (!activeProfile || !activeProfile.id) {
    throw new Error('No hay un perfil activo');
  }
  
  const user = accountManager.createOfflineAccount(username, activeProfile.id);
  logger.info(`Cuenta offline iniciada: ${user.name}`);
  return { success: true, user };
}

async function handleGetCurrentUser() {
  const activeProfile = profileManager.getActiveProfile();
  if (!activeProfile || !activeProfile.id) {
    return null;
  }
  return accountManager.getActiveAccount(activeProfile.id);
}

async function handleAccountsList() {
  const activeProfile = profileManager.getActiveProfile();
  if (!activeProfile || !activeProfile.id) {
    return [];
  }
  return accountManager.getAccountsForProfile(activeProfile.id);
}

// Setup IPC handlers
function setupIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  // Instancias
  register('get-instances', () => launcher.getInstances());
  register('get-instance-details', (_event, instancePath) =>
    instanceService.getDetails(assertInstancePath(instancePath))
  );
  register('repair-instance', (_event, instancePath) =>
    launcher.repairInstance(assertInstancePath(instancePath))
  );
  register('duplicate-instance', (_event, instancePath, newName) =>
    launcher.duplicateInstance(assertInstancePath(instancePath), newName)
  );
  register('diagnose-instance', (_event, instancePath) =>
    launcher.getInstanceDiagnostics(assertInstancePath(instancePath))
  );
  register('delete-instance', (_event, instancePath) =>
    launcher.deleteInstance(assertInstancePath(instancePath))
  );
  register('open-instance-folder', async (_event, instancePath) => {
    const safePath = assertInstancePath(instancePath);
    const error = await shell.openPath(safePath);
    if (error) throw new Error(error);
    return { success: true };
  });
  register('crear-instancia', (_event, data) => launcher.crearInstanciaPersonalizada(data));

  // Lanzamiento
  register('launch-minecraft', handleLaunchMinecraft);

  // Modrinth
  register('search-modrinth', (_event, query, limit, filters, offset) =>
    launcher.searchModrinth(query, limit, filters, offset)
  );
  register('get-modrinth-pack', (_event, projectId) => launcher.getModrinthModpack(projectId));
  register('install-modpack', (_event, data) => launcher.installModpack(data));
  register('search-modrinth-mods', (_event, query, limit, filters) =>
    launcher.searchModrinthMods(query, limit, filters)
  );
  register('get-modrinth-mod', (_event, projectId) => launcher.getModrinthMod(projectId));
  register('install-modrinth-mod', (_event, data) => {
    if (!data || typeof data !== 'object') throw new Error('Datos de instalación de mod inválidos');
    return launcher.installModrinthMod({
      ...data,
      instancePath: assertInstancePath(data.instancePath)
    });
  });

  // Mods
  register('list-instance-mods', (_event, instancePath) =>
    launcher.listInstanceMods(assertInstancePath(instancePath))
  );
  register('toggle-instance-mod', (_event, instancePath, fileName, enabled) =>
    launcher.toggleInstanceMod(assertInstancePath(instancePath), fileName, Boolean(enabled))
  );
  register('check-mod-updates', (_event, instancePath) =>
    launcher.checkInstanceModUpdates(assertInstancePath(instancePath))
  );
  register('update-instance-mods', (_event, instancePath) =>
    launcher.updateInstanceMods(assertInstancePath(instancePath))
  );
  register('remove-instance-mod', (_event, instancePath, fileName) =>
    launcher.removeInstanceMod(assertInstancePath(instancePath), fileName)
  );

  // Importación
  register('import-curseforge-zip', (_event, zipPath, instanceName) =>
    launcher.importCurseForgeZip(assertReadableFile(zipPath, ['.zip']), instanceName)
  );
  register('import-zip', (_event, zipPath, instanceName) =>
    launcher.importZipFile(assertReadableFile(zipPath, ['.zip']), instanceName)
  );

  // Perfiles
  register('profiles-list', () => profileManager.getProfiles());
  register('profile-active', () => profileManager.getActiveProfile());
  register('profile-create', (_event, data) => profileManager.createProfile(data));
  register('profile-update', (_event, id, data) => profileManager.updateProfile(id, data));
  register('profile-delete', (_event, id) => profileManager.deleteProfile(id));
  register('profile-select', (_event, id) => profileManager.setActiveProfile(id));
  register('profile-stats', (_event, id) => profileManager.getProfileStats(id));

  // Configuración de instancia
  register('instance-config-get', (_event, instancePath) =>
    profileManager.getInstanceConfig(assertInstancePath(instancePath))
  );
  register('instance-config-set', (_event, instancePath, data) =>
    profileManager.setInstanceConfig(assertInstancePath(instancePath), data)
  );

  // Servidores
  register('servers-list', () => profileManager.getServers());
  register('server-add', (_event, data) => profileManager.addServer(data));
  register('server-update', (_event, id, data) => profileManager.updateServer(id, data));
  register('server-delete', (_event, id) => profileManager.deleteServer(id));
  register('server-ping', (_event, data) => profileManager.pingServer(data));
  register('modpack-check-update', (_event, instancePath) => launcher.checkModpackUpdate(assertInstancePath(instancePath)));

  // Contenido
  register('content-list', (_event, instancePath, type) =>
    contentManager.list(assertInstancePath(instancePath), type)
  );
  register('content-delete', (_event, instancePath, type, name) =>
    contentManager.remove(assertInstancePath(instancePath), type, name)
  );
  register('content-rename', (_event, instancePath, type, oldName, newName) =>
    contentManager.rename(assertInstancePath(instancePath), type, oldName, newName)
  );
  register('content-toggle', (_event, instancePath, type, name, enabled) =>
    contentManager.toggle(assertInstancePath(instancePath), type, name, Boolean(enabled))
  );
  register('content-install-file', (_event, instancePath, type, filePath) =>
    contentManager.installFile(assertInstancePath(instancePath), type, filePath)
  );
  register('world-import', (_event, instancePath, filePath) =>
    contentManager.importWorld(assertInstancePath(instancePath), assertReadableFile(filePath, ['.zip']))
  );
  register('content-modrinth-search', (_event, type, query, limit, offset, gameVersion) =>
    contentModrinth.search(type, query, limit, offset, gameVersion)
  );
  register('content-modrinth-install', (_event, instancePath, type, projectId, versionId) =>
    contentModrinth.install(assertInstancePath(instancePath), type, projectId, versionId)
  );
  register('content-modrinth-versions', (_event, projectId, gameVersion) =>
    contentModrinth.getVersions(projectId, gameVersion)
  );

  register('content-open-folder', async (_event, instancePath, type) => {
    const folder = await contentManager.openFolder(assertInstancePath(instancePath), type);
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return { success: true, path: folder };
  });

  // Herramientas de instancia
  register('world-backups-list', (_event, instancePath) =>
    instanceTools.listWorldBackups(assertInstancePath(instancePath))
  );
  register('world-backup-create', (_event, instancePath, worldName) =>
    instanceTools.backupWorld(assertInstancePath(instancePath), worldName)
  );
  register('world-backup-restore', (_event, instancePath, backupPath) =>
    instanceTools.restoreWorldBackup(assertInstancePath(instancePath), backupPath)
  );
  register('instance-export', (_event, instancePath) =>
    instanceTools.exportInstance(assertInstancePath(instancePath))
  );
  register('instance-backup-create', (_event, instancePath, reason) =>
    instanceBackup.createInstanceBackup(assertInstancePath(instancePath), reason || 'manual')
  );
  register('instance-backups-list', (_event, instancePath) =>
    instanceBackup.listInstanceBackups(assertInstancePath(instancePath))
  );
  register('instance-backup-restore', (_event, instancePath, backupPath) =>
    instanceBackup.restoreInstanceBackup(assertInstancePath(instancePath), assertReadableFile(backupPath, ['.zip']))
  );
  register('instance-logs-list', (_event, instancePath) =>
    instanceBackup.listLogs(assertInstancePath(instancePath))
  );
  register('instance-log-read', (_event, instancePath, fileName) =>
    instanceBackup.readLog(assertInstancePath(instancePath), fileName)
  );
  register('instance-logs-open', (_event, instancePath) =>
    instanceBackup.openLogsFolder(assertInstancePath(instancePath))
  );
  register('instance-repair-advanced', async (_event, instancePath) => {
    const safe = assertInstancePath(instancePath);
    const backup = await instanceBackup.createInstanceBackup(safe, 'before-repair');
    const repair = await launcher.repairInstance(safe);
    const diagnostics = await launcher.getInstanceDiagnostics(safe);
    return { ...repair, backup, diagnostics };
  });
  register('instance-exports-folder', async () => {
    const folder = await instanceTools.openExportsFolder();
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return { success: true, path: folder };
  });

  // Versiones
  register('get-latest-version', () => launcher.getLatestMinecraftVersion());
  register('get-version-list', () => launcher.getVersionList());
  register('get-release-version-list', () => launcher.getReleaseVersionList());
  register('get-loader-version-list', (_event, loader, minecraftVersion) =>
    launcher.getLoaderVersionList(loader, minecraftVersion)
  );

  // Cuentas
  register('login-offline', handleLoginOffline);
  register('logout-offline', () => accountManager.logout());
  register('get-current-user', handleGetCurrentUser);
  register('accounts-list', handleAccountsList);
  register('account-select', async (_event, id) => {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile || !activeProfile.id) {
      throw new Error('No hay un perfil activo');
    }
    return accountManager.selectAccount(id, activeProfile.id);
  });
  register('account-delete', async (_event, id) => {
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile || !activeProfile.id) {
      throw new Error('No hay un perfil activo');
    }
    return accountManager.deleteAccount(id, activeProfile.id);
  });

  // Java
  register('java-status', async () => {
    return {
      system: javaManager.detectSystemJavaVersion(),
      installed: JAVA_VERSIONS.filter(v => !!javaManager.getLocalJavaPath(v)),
      requiredSupported: JAVA_VERSIONS
    };
  });
  register('java-install', async (_event, version) => {
    const numericVersion = Number(version);
    if (!JAVA_VERSIONS.includes(numericVersion)) {
      throw new Error('Versión de Java no soportada');
    }
    const javaPath = await javaManager.downloadJava(numericVersion);
    return { success: true, version: numericVersion, path: javaPath };
  });

  // Diagnóstico y optimización
  register('analyze-crash', (_event, instancePath) =>
    diagnosticManager.analyzeCrash(assertInstancePath(instancePath))
  );
  register('optimizer-recommendations', (_event, instancePath) =>
    optimizerManager.recommendations(assertInstancePath(instancePath))
  );
  register('optimizer-status', (_event, instancePath) =>
    optimizerManager.getStatus(assertInstancePath(instancePath))
  );
  register('optimizer-apply', (_event, instancePath, settings) =>
    optimizerManager.apply(assertInstancePath(instancePath), settings || {})
  );

  // Actualizaciones
  register('check-app-update', async () => {
    try {
      // Los eventos update-available / update-not-available los emite updater.js.
      const result = await updater.checkForUpdates();
      return { success: true, version: result?.updateInfo?.version || null };
    } catch (error) {
      logger.error(`Error checking updates: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  register('download-app-update', async () => {
    try {
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      logger.error(`Error downloading update: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Información de la app
  register('get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    appId: APP_ID,
    platform: process.platform,
    arch: process.arch
  }));

  // Caché
  register('clear-cache', () => launcher.clearCache());
  register('get-cache-size', () => launcher.getCacheSize());
}

// App life cycle
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
  logger.info(`MineSteam iniciado (v${app.getVersion()})`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
