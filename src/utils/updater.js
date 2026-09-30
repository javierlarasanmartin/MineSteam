// src/utils/updater.js
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');

let mainWindow = null;
let listenersRegistered = false;

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function setUpdater(mainWin) {
    mainWindow = mainWin;

    // Los listeners se registran una sola vez aunque se recree la ventana.
    if (listenersRegistered) return;
    listenersRegistered = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Eventos del updater
    autoUpdater.on('error', (err) => {
        logger.error(`Error en actualizador: ${err.message}`);
        sendStatus('error', `Error: ${err.message}`);
    });

    autoUpdater.on('checking-for-update', () => {
        logger.info('Buscando actualizaciones...');
        sendStatus('checking', 'Buscando actualizaciones...');
    });

    autoUpdater.on('update-available', (info) => {
        logger.info(`Actualización disponible: ${info.version}`);
        sendStatus('available', `Nueva versión ${info.version} disponible`);
        // Preguntar al usuario si quiere descargar
        send('update-available', { version: info.version, releaseDate: info.releaseDate });
    });

    autoUpdater.on('update-not-available', () => {
        logger.info('Sin actualizaciones disponibles');
        sendStatus('not-available', 'Ya tienes la última versión');
        send('update-not-available');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        logger.info(`Descargando actualización: ${percent}%`);
        send('update-download-progress', {
            percent: percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        logger.info(`Actualización descargada: ${info.version}`);
        sendStatus('downloaded', `Actualización ${info.version} lista para instalar`);
        send('update-downloaded', info);
        // Se instala al cerrar la app (autoInstallOnAppQuit); no se reinicia sin avisar.
    });
}

function sendStatus(status, message) {
    send('update-status', { status, message });
}

function checkForUpdates() {
    logger.info('Iniciando comprobación de actualizaciones...');
    return autoUpdater.checkForUpdates();
}

function downloadUpdate() {
    logger.info('Descargando actualización...');
    return autoUpdater.downloadUpdate();
}

module.exports = { setUpdater, checkForUpdates, downloadUpdate, autoUpdater };