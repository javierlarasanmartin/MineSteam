# Changelog

## 2.4.2

### Correcciones
- Volvieron a funcionar activar/desactivar mods, buscar y actualizar mods, actualizar modpacks y cargar las versiones de Fabric, Forge y NeoForge: `launcherService` no exponía esos métodos.
- El lanzamiento ya no bloquea la interfaz hasta que se cierra el juego; el resultado llega por el evento `launch-state`.
- `loadInstances()` y `updateProfileUI()` ya no fallan si falta algún elemento del HTML.
- La detección de Java del launcher usa la de `javaManager` (con Java 8 leía la versión 1). Ahora también se puede instalar Java 16.
- Updater: resultado serializable por IPC, evento `update-available` sin duplicar, listeners registrados una sola vez y sin reinicio automático.
- `unhandledRejection` solo se registra en el log, sin diálogo bloqueante.
- Se eliminó la clave `updateInstanceMods` duplicada en `preload.js`.

### Cambios internos
- `index.html` separado en `index.html`, `styles.css` y `renderer.js`, con Content-Security-Policy.
- Arranque del renderer en `src/renderer/bootstrap.js`; configuración básica en `src/core/appConfig.js`.
- `minecraft-launcher.js` dividido en `installer.js`, `modpackService.js`, `gameLauncher.js` y `minecraft-launcher.js`.
- `launchMinecraft`, `installModrinthModpack` y `repairInstance` partidos en funciones pequeñas; instalación del juego y del loader unificada en `installGameAndLoader` / `installLoader`.
- Código repetido eliminado (descargas, comprobación de SHA-1, detección de Java) y dependencias sin uso (`express`, `dotenv`, `open`) fuera de `package.json` y del lockfile.
- Versión 2.4.2 en `package.json`, lockfile, interfaz y cabeceras `User-Agent`.
