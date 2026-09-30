# MineSteam 2.4.2

Launcher de Minecraft centrado en una experiencia sencilla para usuarios nuevos, con una interfaz **Steampunk + Minecraft Vanilla** y herramientas avanzadas para gestionar instancias.

## Características

- Fabric, Forge y NeoForge.
- Java automático y Java por instancia.
- RAM por instancia hasta 32 GB.
- Backups y restauración.
- Reparación normal y avanzada.
- Assets e idiomas vanilla.
- Crash reports y diagnóstico.
- Logs por instancia.
- Perfiles y servidores.
- Modrinth para mods y modpacks.
- Gestión de mundos, resource packs y shaders.
- Configuración JVM por instancia.
- Interfaz simplificada y responsive.

## Requisitos

- Node.js compatible con Electron del proyecto.
- npm.
- Java según la versión de Minecraft que se vaya a ejecutar.

## Instalación para desarrollo

```bash
npm install
npm start
```

## Crear instalador Windows

```bash
npm run build:win
```

También están disponibles los scripts de build para Linux y macOS definidos en `package.json`.

## Pruebas

```bash
npm run test:architecture
```

## Estructura

```text
MineSteam-2.4.2/
├── assets/
├── scripts/
├── src/
│   ├── core/
│   ├── diagnostics/
│   ├── launcher/
│   ├── loaders/
│   ├── managers/
│   ├── minecraft/
│   ├── modpacks/
│   ├── mods/
│   ├── renderer/
│   └── utils/
├── index.html
├── main.js
├── preload.js
├── renderer.js
├── styles.css
├── package.json
├── package-lock.json
├── CHANGELOG.md
└── README.md
```

## GitHub

Repositorio oficial:
https://github.com/javierlarasanmartin/Minesteam

## Licencia

MIT

## Fase 6.1.2 — Bootstrap del renderer

El arranque del renderer se encuentra separado en `src/renderer/bootstrap.js`.
`renderer.js` conserva la lógica existente de la interfaz y ya no registra sus propios
handlers de `DOMContentLoaded`. Esto permite seguir modularizando el renderer sin
alterar el comportamiento de la interfaz.
