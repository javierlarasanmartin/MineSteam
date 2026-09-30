/**
 * Configuración central de MineSteam.
 *
 * El número de versión no se duplica aquí: Electron lo obtiene desde
 * package.json mediante app.getVersion(). Este archivo concentra únicamente
 * valores de ejecución que no dependen del paquete publicado.
 */

const APP_ID = 'com.javierlarasanmartin.minesteam';
const WINDOW = Object.freeze({ width: 1280, height: 720, minWidth: 900, minHeight: 600 });

module.exports = Object.freeze({ APP_ID, WINDOW });
