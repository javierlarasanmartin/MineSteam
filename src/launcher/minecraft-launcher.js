// src/launcher/minecraft-launcher.js
// Instancias, lanzamiento del juego, reparación y diagnóstico.
// Instalación: ./installer  ·  Modpacks/mods/importación: ./modpackService

const path = require('path');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const javaManager = require('../utils/javaManager');
const { assertInstancePath } = require('../core/security');
const { sha1File, fileMatchesSha1 } = require('../minecraft/libraryManager');
const loaderManager = require('../loaders/loaderManager');
const { sendProgress, sanitizeName, ensureInsideDirectory, findWorkingMirror, getVersionManifest, getLatestMinecraftVersion, getVersionList, getReleaseVersionList, downloadMinecraftVanilla, downloadAssets, downloadLibraries, getRequiredJavaVersion, downloadJava, installFabric, installForge, installNeoForge, getLoaderVersionList, INSTANCES_DIR, CACHE_DIR, ASSETS_CACHE, LIBRARIES_CACHE, JAVA_CACHE, installGameAndLoader, installLoader } = require('./installer');
const { launchMinecraft } = require('./gameLauncher');
const { searchModrinth, getModrinthModpack, installModpack, checkModpackUpdate, searchModrinthMods, getModrinthMod, listInstanceMods, toggleInstanceMod, checkInstanceModUpdates, updateInstanceMods, installModrinthMod, removeInstanceMod, importZipFile, importCurseForgeZip, normalizeMrpackPath, tryDownloadEntry } = require('./modpackService');

async function crearInstanciaPersonalizada(data) {
    const { nombre, version, ram = 4096, loaderVersion = null } = data;

    const loader = loaderManager.normalizeLoader(data?.loader || 'vanilla');

    if (!version) {
        return { success: false, error: 'No se indicó una versión de Minecraft' };
    }

    const nombreLimpio = sanitizeName(nombre);

    const instanceDir = path.join(INSTANCES_DIR, nombreLimpio);

    if (fs.existsSync(instanceDir)) {
        return { success: false, error: 'Ya existe una instancia con ese nombre' };
    }

    fs.ensureDirSync(instanceDir);

    const minecraftDir = path.join(instanceDir, '.minecraft');

    fs.ensureDirSync(minecraftDir);

    const versionJson = {
        name: nombreLimpio,
        minecraftVersion: version,
        loader,
        loaderVersion: loaderVersion || null,
        ram: Math.max(1024, Math.min(65536, Number(ram) || 4096)),
        gameVersions: [version],
        installedAt: new Date().toISOString(),
        type: 'custom'
    };

    fs.writeJsonSync(path.join(instanceDir, 'version.json'), versionJson, { spaces: 2 });

    const loaderInfo = await installGameAndLoader(version, minecraftDir, loader, loaderVersion);

    if (loaderInfo?.version) {
        versionJson.loaderVersion = loaderInfo.version;

        fs.writeJsonSync(path.join(instanceDir, 'version.json'), versionJson, { spaces: 2 });
    }

    return { success: true, path: instanceDir, loaderJar: loaderInfo };
}

// Perfiles de loader

// Modrinth


async function getInstances() {
    if (!fs.existsSync(INSTANCES_DIR)) {
        return [];
    }

    const dirs = fs.readdirSync(INSTANCES_DIR);

    const instances = [];

    for (const dir of dirs) {
        const instancePath = path.join(INSTANCES_DIR, dir);

        const versionPath = path.join(instancePath, 'version.json');

        if (!fs.existsSync(versionPath)) {
            continue;
        }

        try {
            const data = fs.readJsonSync(versionPath);

            instances.push({
                name: data.name || dir,
                path: instancePath,
                type: data.type || 'custom',
                loader: data.loader || 'vanilla',
                loaderVersion: data.loaderVersion || null,
                version: data.gameVersions?.[0] || data.minecraftVersion || '1.20.4',
                installedAt: data.installedAt || new Date().toISOString()
            });
        } catch (error) {
            logger.warn(`No se pudo leer ${dir}: ` + error.message);
        }
    }

    return instances;
}

async function deleteInstance(instancePath) {
    if (!instancePath || !fs.existsSync(instancePath)) {
        return { success: false, error: 'La instancia no existe' };
    }

    await fs.remove(instancePath);

    return { success: true };
}

// Reparación

async function repairModpackFiles(safeInstancePath, minecraftDir) {
    const manifestPath = path.join(safeInstancePath, 'repair-manifest.json');

    if (!fs.existsSync(manifestPath)) return;

    const manifest = fs.readJsonSync(manifestPath);
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    let done = 0;

    for (const entry of files) {
        await repairModpackEntry(entry, minecraftDir);

        done++;

        if (done % 10 === 0 || done === files.length) {
            sendProgress(
                'repair',
                done,
                Math.max(files.length, 1),
                `Comprobando mods: ${done}/${files.length}`
            );
        }
    }
}

// Repara un archivo del modpack. Las entradas no aplicables o con rutas inseguras se omiten.
async function repairModpackEntry(entry, minecraftDir) {
    if (entry.env?.client === 'unsupported') return;

    let relative;

    try {
        relative = normalizeMrpackPath(entry.path);
    } catch (_) {
        return;
    }

    const destination = path.join(minecraftDir, relative);

    if (!ensureInsideDirectory(minecraftDir, destination)) return;

    if (fileMatchesSha1(destination, entry.hashes?.sha1)) return;

    if (!Array.isArray(entry.downloads) || !entry.downloads.length) return;

    fs.ensureDirSync(path.dirname(destination));

    if (!(await tryDownloadEntry(entry, destination, relative))) {
        throw new Error(`No se pudo reparar ${relative}`);
    }
}

async function repairInstance(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const metaPath = path.join(safeInstancePath, 'version.json');

    if (!fs.existsSync(metaPath)) {
        throw new Error('Falta version.json');
    }

    const meta = fs.readJsonSync(metaPath);
    const minecraftVersion = meta.minecraftVersion || meta.gameVersions?.[0];

    if (!minecraftVersion) {
        throw new Error('No se pudo determinar la versión de Minecraft');
    }

    const minecraftDir = path.join(safeInstancePath, '.minecraft');
    fs.ensureDirSync(minecraftDir);

    sendProgress('repair', 0, 4, 'Reparando Minecraft...');
    await downloadMinecraftVanilla(minecraftVersion, minecraftDir);

    sendProgress('repair', 1, 4, 'Reparando assets...');
    await downloadAssets(minecraftVersion, minecraftDir);

    sendProgress('repair', 2, 4, 'Reparando librerías...');
    await downloadLibraries(minecraftVersion, minecraftDir);

    await repairModpackFiles(safeInstancePath, minecraftDir);

    await installLoader(
        loaderManager.normalizeLoader(meta.loader || 'vanilla'),
        minecraftVersion,
        minecraftDir,
        meta.loaderVersion || null
    );

    sendProgress('repair', 4, 4, 'Reparación completada');

    return { success: true, path: instancePath, message: 'Instancia reparada correctamente' };
}

// Duplicar instancia

async function duplicateInstance(instancePath, newName) {
    if (!instancePath || !fs.existsSync(instancePath)) {
        throw new Error('La instancia original no existe');
    }

    const name = sanitizeName(newName);

    const destination = path.join(INSTANCES_DIR, name);

    if (fs.existsSync(destination)) {
        throw new Error('Ya existe una instancia con ese nombre');
    }

    await fs.copy(instancePath, destination);

    const metaPath = path.join(destination, 'version.json');

    if (fs.existsSync(metaPath)) {
        const meta = fs.readJsonSync(metaPath);

        meta.name = name;

        meta.installedAt = new Date().toISOString();

        fs.writeJsonSync(metaPath, meta, { spaces: 2 });

        const instanceMeta = path.join(destination, 'instance.json');

        if (fs.existsSync(instanceMeta)) {
            fs.writeJsonSync(instanceMeta, meta, { spaces: 2 });
        }
    }

    return { success: true, path: destination, name };
}

// Diagnósticos

async function getInstanceDiagnostics(instancePath) {
    if (!instancePath || !fs.existsSync(instancePath)) {
        throw new Error('La instancia no existe');
    }

    const metaPath = path.join(instancePath, 'version.json');

    const meta = fs.existsSync(metaPath) ? fs.readJsonSync(metaPath) : {};

    const minecraftVersion = meta.minecraftVersion || meta.gameVersions?.[0] || null;

    const javaRequired = minecraftVersion ? await getRequiredJavaVersion(minecraftVersion) : null;

    const javaDetected = javaManager.detectSystemJavaVersion();

    const minecraftJar =
        minecraftVersion
            ? path.join(
                instancePath,
                '.minecraft',
                'versions',
                minecraftVersion,
                `${minecraftVersion}.jar`
            )
            : null;

    const manifestPath = path.join(instancePath, 'repair-manifest.json');

    const missing = [];

    if (fs.existsSync(manifestPath)) {
        const manifest = fs.readJsonSync(manifestPath);

        for (const file of manifest.files || []) {
            const relative = String(file.path || '');

            const destination = path.join(instancePath, '.minecraft', relative);

            if (!fs.existsSync(destination)) {
                missing.push(relative);

                continue;
            }

            if (file.hashes?.sha1) {
                try {
                    const hash = sha1File(destination);

                    if (hash.toLowerCase() !== String(file.hashes.sha1).toLowerCase()) {
                        missing.push(`${relative} (hash)`);
                    }
                } catch (_) {
                    missing.push(`${relative} (error)`);
                }
            }
        }
    }

    const minecraftPresent = Boolean(minecraftJar && fs.existsSync(minecraftJar));

    const javaCompatible = !javaRequired || javaDetected === Number(javaRequired);

    const languagePackPath = path.join(instancePath, '.minecraft', 'resourcepacks', 'MineSteam-Languages', 'pack.mcmeta');
    let languagesAvailable = false;
    try {
        languagesAvailable = fs.existsSync(languagePackPath) && fs.existsSync(path.join(instancePath, '.minecraft', 'resourcepacks', 'MineSteam-Languages', 'assets', 'minecraft', 'lang', 'en_us.json'));
    } catch (_) {}

    return {
        success: true,
        minecraftVersion,
        loader: meta.loader || 'vanilla',
        loaderVersion: meta.loaderVersion || null,
        javaRequired,
        javaDetected,
        minecraftPresent,
        languagesAvailable,
        missingFiles: missing.slice(0, 100),
        healthy: missing.length === 0 && minecraftPresent && javaCompatible
    };
}

// Caché

async function clearCache() {
    await fs.remove(CACHE_DIR);

    fs.ensureDirSync(CACHE_DIR);

    fs.ensureDirSync(ASSETS_CACHE);

    fs.ensureDirSync(LIBRARIES_CACHE);

    fs.ensureDirSync(JAVA_CACHE);

    return { success: true };
}

async function calculateDirectorySize(directory) {
    if (!fs.existsSync(directory)) {
        return 0;
    }

    let size = 0;

    const items = await fs.readdir(directory);

    for (const item of items) {
        const fullPath = path.join(directory, item);

        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
            size += await calculateDirectorySize(fullPath);
        } else {
            size += stat.size;
        }
    }

    return size;
}

async function getCacheSize() {
    if (!fs.existsSync(CACHE_DIR)) return 0;
    try {
        return await calculateDirectorySize(CACHE_DIR);
    } catch (error) {
        logger.warn(`No se pudo calcular el tamaño de caché: ${error.message}`);
        return 0;
    }
}

// Exports

module.exports = {
    launchMinecraft,
    findWorkingMirror,
    getVersionManifest,
    getLatestMinecraftVersion,
    getVersionList,
    getReleaseVersionList,
    getLoaderVersionList,
    downloadMinecraftVanilla,
    downloadAssets,
    downloadLibraries,
    installFabric,
    installForge,
    installNeoForge,
    crearInstanciaPersonalizada,
    getInstances,
    deleteInstance,
    repairInstance,
    duplicateInstance,
    getInstanceDiagnostics,
    searchModrinth,
    getModrinthModpack,
    installModpack,
    checkModpackUpdate,
    importCurseForgeZip,
    importZipFile,
    searchModrinthMods,
    getModrinthMod,
    installModrinthMod,
    listInstanceMods,
    toggleInstanceMod,
    checkInstanceModUpdates,
    updateInstanceMods,
    removeInstanceMod,
    clearCache,
    getCacheSize,
    downloadJava,
    getRequiredJavaVersion
};