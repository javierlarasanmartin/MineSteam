// src/launcher/modpackService.js
// Modrinth (modpacks y mods), importación de ZIP/MRPACK/CurseForge y mantenimiento de mods.

const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const AdmZip = require('adm-zip');
const extract = require('extract-zip');
const logger = require('../utils/logger');
const modrinthMods = require('../mods/modrinthMods');
const modrinth = require('../modpacks/modrinth');
const { assertInstancePath } = require('../core/security');
const { sha1File, fileMatchesSha1 } = require('../minecraft/libraryManager');
const loaderManager = require('../loaders/loaderManager');
const { sendProgress, sanitizeName, ensureInsideDirectory, downloadFile, downloadMinecraftVanilla, downloadAssets, downloadLibraries, installGameAndLoader, INSTANCES_DIR, CACHE_DIR, MODRINTH_API } = require('./installer');

async function searchModrinth(query, limit = 20, filters = {}, offset = 0) {
    try {
        const params = new URLSearchParams();
        const facets = [];

        params.set('query', String(query || '').trim());
        params.set('index', ['relevance','downloads','follows','newest','updated'].includes(filters.sort) ? filters.sort : 'relevance');
        params.set('limit', String(Math.max(1, Math.min(Number(limit) || 20, 100))));
        params.set('offset', String(Math.max(0, Number(offset) || 0)));

        // MineSteam usa esta búsqueda para instalar modpacks.
        // Por seguridad y para no mostrar mods .jar como .mrpack,
        // limitamos los resultados a proyectos cuyo tipo sea modpack.
        facets.push(['project_type:modpack']);

        if (filters.categories?.length) {
            facets.push(filters.categories.map(value => `categories:${value}`));
        }

        if (filters.loaders?.length) {
            facets.push(filters.loaders.map(value => `categories:${value}`));
        }

        if (filters.versions?.length) {
            facets.push(filters.versions.map(value => `versions:${value}`));
        }

        params.set('facets', JSON.stringify(facets));

        const response = await axios.get(
            `${MODRINTH_API}/search?${params.toString()}`,
            { timeout: 20000, headers: { 'User-Agent': 'MineSteam/2.4.2' } }
        );

        const hits = Array.isArray(response.data?.hits) ? response.data.hits : [];

        // Segunda barrera: aunque la API responda algo inesperado,
        // nunca entregamos proyectos que no sean modpacks al instalador.
        return hits.filter(item => item.project_type === 'modpack').map(item => ({
                ...item,
                id: item.project_id,
                title: item.title || item.slug || 'Modpack',
                description: item.description || 'Sin descripción',
                icon: item.icon_url || null,
                icon_url: item.icon_url || null,
                author: item.author || 'Desconocido',
                loaders: Array.isArray(item.categories) ? item.categories.filter(v => ['fabric','forge','neoforge','quilt'].includes(String(v).toLowerCase())).map(v => String(v).toLowerCase()) : [],
                versions: item.versions || [],
                downloads: Number(item.downloads || 0),
                follows: Number(item.follows || 0)
            }));
    } catch (error) {
        logger.error(`Error buscando en Modrinth: ${error.message}`);

        return [];
    }
}

async function getModrinthModpack(projectId) {
    if (!projectId) {
        return null;
    }

    try {
        const projectResponse =
            await axios.get(
                `${MODRINTH_API}/project/${encodeURIComponent(projectId)}`,
                { timeout: 20000 }
            );

        const project = projectResponse.data;

        if (project.project_type !== 'modpack') {
            throw new Error(
                `El proyecto de Modrinth "${project.title || project.id || projectId}" no es un modpack. ` +
                `Es de tipo "${project.project_type || 'desconocido'}".`
            );
        }

        const versionsResponse =
            await axios.get(
                `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`,
                { timeout: 20000 }
            );

        const versions =
            (Array.isArray(versionsResponse.data) ? versionsResponse.data : [])
                .filter(version => Array.isArray(version.files) && version.files.length)
                .sort((a, b) => {
                    const releaseA = a.version_type === 'release' ? 1 : 0;
                    const releaseB = b.version_type === 'release' ? 1 : 0;
                    if (releaseA !== releaseB) return releaseB - releaseA;
                    return new Date(b.date_published || 0) - new Date(a.date_published || 0);
                });

        const validVersions = versions.filter(
            version => Array.isArray(version.files) && version.files.length > 0
        );

        if (!validVersions.length) {
            return null;
        }

        validVersions.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));

        return { ...project, versions: validVersions, latestVersion: validVersions[0] };
    } catch (error) {
        logger.error(`Error obteniendo modpack Modrinth: ` + error.message);

        return null;
    }
}

async function installModpack(data) {
    const { platform, projectId, versionId, instanceName } = data;

    if (platform === 'modrinth') {
        return installModrinthModpack(projectId, versionId, instanceName);
    }

    return { success: false, error: 'Plataforma no soportada' };
}

// Buscar archivo recursivo

function findFileRecursive(dir, filename) {
    if (!fs.existsSync(dir)) {
        return null;
    }

    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            const found = findFileRecursive(fullPath, filename);

            if (found) {
                return found;
            }
        } else if (item === filename) {
            return fullPath;
        }
    }

    return null;
}

// Instalar modpack Modrinth

// Mrpack: helpers compartidos (instalación desde Modrinth e importación local)

const LOADER_DEPENDENCY_KEYS = [
    ['fabric', 'fabric-loader'],
    ['neoforge', 'neoforge'],
    ['forge', 'forge']
];

function isModrinthIndexName(entryName) {
    const name = String(entryName || '').replace(/\\/g, '/').replace(/^\.\//, '');
    return name === 'modrinth.index.json' || name.endsWith('/modrinth.index.json');
}

// Un .mrpack es un ZIP con modrinth.index.json. Un mod .jar también es un ZIP,
// así que se valida el índice para dar un error claro y no extraer un .jar en la instancia.
function assertMrpackArchive(zipPath) {
    let entries;

    try {
        entries = new AdmZip(zipPath).getEntries();
    } catch (archiveError) {
        throw new Error(
            `El archivo descargado no es un ZIP/MRPACK válido: ${archiveError.message}`
        );
    }

    if (!entries.some(entry => isModrinthIndexName(entry.entryName))) {
        throw new Error(
            'El archivo descargado no es un modpack de Modrinth: ' +
            'no contiene modrinth.index.json. ' +
            'Es posible que se haya seleccionado un mod (.jar) en lugar de un modpack.'
        );
    }
}

function detectMrpackLoader(dependencies = {}, versionLoaders = []) {
    for (const [loader, key] of LOADER_DEPENDENCY_KEYS) {
        if (dependencies[key]) {
            return { loader, loaderVersion: dependencies[key] };
        }
    }

    if (Array.isArray(versionLoaders)) {
        const detected = versionLoaders.find(item =>
            ['fabric', 'forge', 'neoforge'].includes(String(item).toLowerCase())
        );

        if (detected) {
            return { loader: loaderManager.normalizeLoader(detected), loaderVersion: null };
        }
    }

    return { loader: 'vanilla', loaderVersion: null };
}

async function fetchModrinthPackVersion(versionId) {
    if (!versionId) {
        throw new Error('No se indicó versionId del modpack');
    }

    const { data: version } = await axios.get(
        `${MODRINTH_API}/version/${encodeURIComponent(versionId)}`,
        { timeout: 20000 }
    );

    const gameVersion = version.game_versions?.[0];
    if (!gameVersion) {
        throw new Error('El modpack no indica una versión de Minecraft');
    }

    const file = version.files?.find(item => item.primary) || version.files?.[0];
    if (!file?.url) {
        throw new Error('No se encontró el archivo .mrpack');
    }

    return { version, gameVersion, file };
}

// Si el índice está dentro de una carpeta, sube el contenido a la raíz de la instancia.
function flattenModpackRoot(instanceDir, indexPath) {
    const indexRoot = path.dirname(indexPath);

    if (path.resolve(indexRoot) === path.resolve(instanceDir)) return;

    for (const item of fs.readdirSync(indexRoot)) {
        const source = path.join(indexRoot, item);
        const destination = path.join(instanceDir, item);

        if (path.resolve(source) === path.resolve(indexPath)) continue;

        if (fs.existsSync(destination)) {
            fs.removeSync(destination);
        }

        fs.moveSync(source, destination);
    }
}

function normalizeMrpackPath(rawPath) {
    const relative = String(rawPath || '').replace(/\\/g, '/');

    if (
        !relative || relative.startsWith('/') || relative.split('/').some(part => part === '..') ||
        /^[A-Za-z]:\//.test(relative)
    ) {
        throw new Error(`Ruta inválida en modrinth.index.json: ${relative}`);
    }

    return relative;
}

// Prueba cada URL de la entrada hasta obtener un archivo válido (SHA-1 incluido).
// Devuelve true si lo consiguió; nunca lanza.
async function tryDownloadEntry(entry, destination, relative) {
    const downloads = Array.isArray(entry.downloads) ? entry.downloads : [];

    for (const url of downloads) {
        try {
            let ok = await downloadFile(url, destination, 3);

            if (ok && entry.hashes?.sha1 && !fileMatchesSha1(destination, entry.hashes.sha1)) {
                fs.removeSync(destination);
                ok = false;
            }

            if (ok) return true;
        } catch (error) {
            logger.warn(`Falló descarga ${relative}: ${error.message}`);
        }
    }

    return false;
}

async function downloadMrpackEntry(entry, destination, relative) {
    if (!(await tryDownloadEntry(entry, destination, relative))) {
        throw new Error(`No se pudo descargar ${relative}`);
    }
}

async function downloadMrpackFiles(filesList, minecraftDir) {
    const total = filesList.length;
    let completed = 0;

    sendProgress('mods', 0, total, `Descargando archivos: 0/${total}`);

    for (const entry of filesList) {
        if (entry.env?.client !== 'unsupported') {
            const relative = normalizeMrpackPath(entry.path);
            const destination = path.join(minecraftDir, relative);

            if (!ensureInsideDirectory(minecraftDir, destination)) {
                throw new Error(`Ruta fuera de la instancia: ${relative}`);
            }

            fs.ensureDirSync(path.dirname(destination));

            if (!fileMatchesSha1(destination, entry.hashes?.sha1)) {
                await downloadMrpackEntry(entry, destination, relative);
            }
        }

        completed++;

        if (completed % 5 === 0 || completed === total) {
            sendProgress('mods', completed, total, `Archivos: ${completed}/${total}`);
        }
    }
}

function writeInstanceMetadata(instanceDir, metadata) {
    fs.writeJsonSync(path.join(instanceDir, 'version.json'), metadata, { spaces: 2 });
    fs.writeJsonSync(path.join(instanceDir, 'instance.json'), metadata, { spaces: 2 });
}

function buildRepairManifest(gameVersion, loader, loaderVersion, filesList) {
    return {
        format: 1,
        generatedAt: new Date().toISOString(),
        minecraftVersion: gameVersion,
        loader,
        loaderVersion,
        files: filesList.map(entry => ({
            path: entry.path,
            hashes: entry.hashes || {},
            downloads: entry.downloads || [],
            env: entry.env || {}
        }))
    };
}

async function installModrinthModpack(projectId, versionId, instanceName) {
    const nombreLimpio = sanitizeName(instanceName);
    const instanceDir = path.join(INSTANCES_DIR, nombreLimpio);

    if (fs.existsSync(instanceDir)) {
        return { success: false, error: 'Ya existe una instancia con ese nombre' };
    }

    const zipPath = path.join(INSTANCES_DIR, `${nombreLimpio}.mrpack`);

    try {
        // Nunca reutilizar un archivo de una instalación fallida anterior:
        // downloadFile() considera válido cualquier archivo no vacío.
        fs.removeSync(zipPath);

        sendProgress('modpack', 0, 1, 'Descargando modpack...');

        const { version, gameVersion, file } = await fetchModrinthPackVersion(versionId);

        if (!(await downloadFile(file.url, zipPath, 5))) {
            throw new Error('No se pudo descargar el modpack desde Modrinth');
        }

        fs.ensureDirSync(instanceDir);
        assertMrpackArchive(zipPath);
        await extract(zipPath, { dir: instanceDir });

        const indexPath = findFileRecursive(instanceDir, 'modrinth.index.json');
        if (!indexPath) {
            throw new Error('No se encontró modrinth.index.json');
        }

        const index = fs.readJsonSync(indexPath);
        const { loader, loaderVersion } = detectMrpackLoader(index.dependencies, version.loaders);

        logger.info(
            `Modrinth: Minecraft ${gameVersion}; ` +
            `loader=${loader}; loaderVersion=${loaderVersion || 'n/a'}`
        );

        flattenModpackRoot(instanceDir, indexPath);

        const minecraftDir = path.join(instanceDir, '.minecraft');
        fs.ensureDirSync(minecraftDir);

        const filesList = Array.isArray(index.files) ? index.files : [];
        await downloadMrpackFiles(filesList, minecraftDir);

        const overrides = path.join(instanceDir, 'overrides');
        if (fs.existsSync(overrides)) {
            fs.copySync(overrides, minecraftDir, { overwrite: true });
            fs.removeSync(overrides);
        }

        const instanceMeta = {
            name: nombreLimpio,
            type: 'modrinth',
            projectId,
            versionId,
            minecraftVersion: gameVersion,
            gameVersions: [gameVersion],
            loader,
            loaderVersion,
            installedAt: new Date().toISOString(),
            authType: 'offline'
        };

        fs.writeJsonSync(
            path.join(instanceDir, 'repair-manifest.json'),
            buildRepairManifest(gameVersion, loader, loaderVersion, filesList),
            { spaces: 2 }
        );
        writeInstanceMetadata(instanceDir, instanceMeta);

        const loaderInfo = await installGameAndLoader(gameVersion, minecraftDir, loader, loaderVersion);

        if (loaderInfo?.version && loaderInfo.version !== loaderVersion) {
            instanceMeta.loaderVersion = loaderInfo.version;
            writeInstanceMetadata(instanceDir, instanceMeta);
        }

        try { fs.removeSync(zipPath); } catch (_) {}
        try { fs.removeSync(path.join(instanceDir, 'modrinth.index.json')); } catch (_) {}

        sendProgress('modpack', 1, 1, 'Modpack instalado');

        return {
            success: true,
            path: instanceDir,
            loader,
            loaderVersion: loaderInfo?.version || loaderVersion
        };
    } catch (error) {
        logger.error(`Error instalando Modrinth: ${error.stack || error.message}`);

        try {
            fs.removeSync(zipPath);
            fs.removeSync(instanceDir);
        } catch (_) {}

        return { success: false, error: `Error instalando modpack: ${error.message}` };
    }
}

// Modpacks inteligentes

async function checkModpackUpdate(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const metadataPath = path.join(safeInstancePath, 'version.json');
    if (!fs.existsSync(metadataPath)) return { success: true, isModpack: false, updateAvailable: false };
    let metadata;
    try { metadata = fs.readJsonSync(metadataPath); } catch (_) { return { success: true, isModpack: false, updateAvailable: false }; }
    if (!metadata.projectId || metadata.type !== 'modrinth') return { success: true, isModpack: false, updateAvailable: false };
    const info = await modrinth.getModrinthModpack(metadata.projectId);
    const currentVersionId = metadata.versionId;
    const current = info.versions.find(v => v.id === currentVersionId);
    const compatible = info.versions.filter(v => {
        const gameOk = !metadata.minecraftVersion || (v.game_versions || []).includes(metadata.minecraftVersion);
        const loaderOk = !metadata.loader || metadata.loader === 'vanilla' || (v.loaders || []).map(modrinth.normalizeLoader).includes(modrinth.normalizeLoader(metadata.loader));
        return gameOk && loaderOk && v.version_type === 'release';
    }).sort((a,b) => new Date(b.date_published || 0) - new Date(a.date_published || 0));
    const latest = compatible[0] || info.latestVersion;
    return {
        success: true,
        isModpack: true,
        projectId: metadata.projectId,
        currentVersionId,
        currentVersion: current?.version_number || current?.name || currentVersionId || 'Desconocida',
        latestVersionId: latest?.id || null,
        latestVersion: latest?.version_number || latest?.name || null,
        updateAvailable: !!latest && latest.id !== currentVersionId,
        title: info.title,
        minecraftVersion: metadata.minecraftVersion,
        loader: metadata.loader
    };
}

// Gestor de mods Modrinth

async function searchModrinthMods(query, limit = 30, filters = {}) {
    return modrinthMods.searchMods(query, limit, filters);
}

async function getModrinthMod(projectId) {
    return modrinthMods.getMod(projectId);
}

async function listInstanceMods(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    if (!fs.existsSync(modsDir)) return [];
    const metadataPath = path.join(safeInstancePath, '.minesteam-mods.json');
    let metadata = {};
    try { if (fs.existsSync(metadataPath)) metadata = fs.readJsonSync(metadataPath); } catch (_) {}
    return fs.readdirSync(modsDir).filter(file => /\.jar(?:\.disabled)?$/i.test(file)).map(file => {
            const disabled = /\.disabled$/i.test(file);
            const activeFile = disabled ? file.replace(/\.disabled$/i, '') : file;
            const fullPath = path.join(modsDir, file);
            const stat = fs.statSync(fullPath);
            const meta = metadata[activeFile] || {};
            return { file, activeFile, path: fullPath, size: stat.size, modifiedAt: stat.mtime.toISOString(), disabled, ...meta };
        });
}

async function toggleInstanceMod(instancePath, fileName, enabled) {
    if (!fileName || /[\\/]/.test(fileName) || !/\.jar(?:\.disabled)?$/i.test(fileName)) throw new Error('Nombre de mod inválido');
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const targetName = enabled ? fileName.replace(/\.disabled$/i, '') : (fileName.endsWith('.disabled') ? fileName : `${fileName}.disabled`);
    const from = path.resolve(modsDir, fileName);
    const to = path.resolve(modsDir, targetName);
    const root = path.resolve(modsDir);
    if (!(from.startsWith(root + path.sep) && to.startsWith(root + path.sep))) throw new Error('Ruta de mod inválida');
    if (!fs.existsSync(from)) return { success:false, error:'El mod no existe' };
    if (fs.existsSync(to)) fs.removeSync(to);
    fs.moveSync(from, to);
    return { success:true, file:targetName, enabled };
}

async function checkInstanceModUpdates(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const mods = await listInstanceMods(safeInstancePath);
    const updates = [];
    for (const mod of mods) {
        if (!mod.projectId || !mod.versionId || mod.disabled) continue;
        try {
            const info = await modrinthMods.getMod(mod.projectId);
            const compatible = info.versions
                .filter(v => v.id !== mod.versionId && Array.isArray(v.files) && v.files.length)
                .filter(v => !mod.gameVersion || v.game_versions?.includes(mod.gameVersion))
                .filter(v => !mod.loader || mod.loader === 'vanilla' || v.loaders?.map(modrinthMods.normalizeLoader).includes(modrinthMods.normalizeLoader(mod.loader)))
                .sort((a,b) => new Date(b.date_published||0)-new Date(a.date_published||0))[0];
            if (compatible && compatible.id !== mod.versionId) {
                updates.push({ ...mod, latestVersionId: compatible.id, latestVersion: compatible.version_number || compatible.id, updateAvailable:true });
            }
        } catch (_) {}
    }
    return updates;
}

async function updateInstanceMods(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const updates = await checkInstanceModUpdates(safeInstancePath);
    const results = [];
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const backupDir = path.join(safeInstancePath, '.minesteam-backups', 'mods', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.ensureDirSync(backupDir);
    let backupsCreated = 0;

    for (const update of updates) {
        const oldFile = update.activeFile || update.file;
        try {
            const oldPath = oldFile ? path.join(modsDir, oldFile) : null;
            let backupPath = null;
            if (oldPath && fs.existsSync(oldPath)) {
                backupPath = path.join(backupDir, oldFile);
                fs.copyFileSync(oldPath, backupPath);
                backupsCreated += 1;
            }
            const result = await installModrinthMod({ instancePath: safeInstancePath, projectId: update.projectId, versionId: update.latestVersionId, gameVersion: update.gameVersion, loader: update.loader });
            if (oldFile && result.file !== oldFile) { if (oldPath && fs.existsSync(oldPath)) fs.removeSync(oldPath); }
            results.push({ success:true, projectId:update.projectId, oldFile, newFile:result.file, versionId:result.versionId, backupPath });
        } catch (error) {
            results.push({ success:false, projectId:update.projectId, file:oldFile, error:error.message });
        }
    }
    if (!results.length) { try { fs.removeSync(backupDir); } catch (_) {} }
    return { success:results.every(r=>r.success), checked:updates.length, updated:results.filter(r=>r.success).length, failed:results.filter(r=>!r.success).length, backupsCreated, backupDir: backupsCreated ? backupDir : null, results };
}

async function installModrinthMod(data) {
    const { instancePath, projectId, versionId, gameVersion, loader } = data || {};
    if (!instancePath) throw new Error('No se indicó la instancia donde instalar el mod');
    if (!projectId) throw new Error('No se indicó el proyecto de Modrinth');

    const safeInstancePath = assertInstancePath(instancePath);
    const instanceMinecraftDir = path.join(safeInstancePath, '.minecraft');
    fs.ensureDirSync(instanceMinecraftDir);
    const modsDir = path.join(instanceMinecraftDir, 'mods');
    fs.ensureDirSync(modsDir);

    const metaPath = path.join(safeInstancePath, 'version.json');
    let instanceMeta = {};
    if (fs.existsSync(metaPath)) {
        try { instanceMeta = fs.readJsonSync(metaPath); } catch (_) {}
    }

    const targetGameVersion = gameVersion || instanceMeta.minecraftVersion || instanceMeta.gameVersions?.[0];
    const targetLoader = loader || instanceMeta.loader || 'vanilla';
    const modVersion = await modrinthMods.resolveCompatibleVersion(projectId, versionId, targetGameVersion, targetLoader);
    if (!modVersion) {
        throw new Error(`No se encontró una versión compatible del mod para ${targetGameVersion || 'la instancia'} / ${targetLoader}`);
    }

    const file = modVersion.files?.find(item => item.primary) || modVersion.files?.[0];
    if (!file?.url) throw new Error('El mod no tiene un archivo descargable');

    const fileName = path.basename(file.filename || new URL(file.url).pathname);
    if (!/^.+\.jar$/i.test(fileName)) throw new Error('El archivo seleccionado no es un mod .jar válido');

    const destination = path.join(modsDir, fileName);
    const tempPath = `${destination}.download`;

    try {
        sendProgress('mod', 0, 1, `Descargando ${fileName}...`);
        const ok = await downloadFile(file.url, tempPath, 5);
        if (!ok) throw new Error(`No se pudo descargar ${fileName}`);

        if (file.hashes?.sha1) {
            const hash = sha1File(tempPath);
            if (hash.toLowerCase() !== String(file.hashes.sha1).toLowerCase()) {
                throw new Error(`Hash SHA-1 inválido para ${fileName}`);
            }
        }

        fs.moveSync(tempPath, destination, { overwrite: true });
        const metadataPath = path.join(safeInstancePath, '.minesteam-mods.json');
        let metadata = {};
        try { if (fs.existsSync(metadataPath)) metadata = fs.readJsonSync(metadataPath); } catch (_) {}
        metadata[fileName] = { projectId, versionId: modVersion.id, gameVersion: targetGameVersion, loader: targetLoader, installedAt: new Date().toISOString() };
        fs.writeJsonSync(metadataPath, metadata, { spaces: 2 });
        sendProgress('mod', 1, 1, `${fileName} instalado`);
        return { success: true, projectId, versionId: modVersion.id, file: fileName, path: destination, gameVersion: targetGameVersion, loader: targetLoader };
    } finally {
        if (fs.existsSync(tempPath)) { try { fs.removeSync(tempPath); } catch (_) {} }
    }
}

async function removeInstanceMod(instancePath, fileName) {
    if (!fileName || /[\\/]/.test(fileName) || !/\.jar(?:\.disabled)?$/i.test(fileName)) throw new Error('Nombre de mod inválido');
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const target = path.resolve(modsDir, fileName);
    const root = path.resolve(modsDir);
    if (!(target === root || target.startsWith(root + path.sep))) throw new Error('Ruta de mod inválida');
    if (!fs.existsSync(target)) return { success: false, error: 'El mod no existe' };
    fs.removeSync(target);
    return { success: true, file: fileName };
}

function safeArchiveExtract(archive, destination) {
    fs.ensureDirSync(destination);
    for (const entry of archive.getEntries()) {
        const normalized = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = normalized.split('/');
        if (parts.some(part => part === '..')) throw new Error(`Ruta insegura dentro del ZIP: ${entry.entryName}`);
        const target = path.resolve(destination, normalized);
        const root = path.resolve(destination);
        if (!(target === root || target.startsWith(root + path.sep))) throw new Error(`Ruta fuera del destino: ${entry.entryName}`);
        if (entry.isDirectory) fs.ensureDirSync(target);
        else { fs.ensureDirSync(path.dirname(target)); fs.writeFileSync(target, entry.getData()); }
    }
}

async function importModrinthMrpack(zipPath, instanceName) {
    const name = sanitizeName(instanceName || path.basename(zipPath, path.extname(zipPath)));
    const instanceDir = path.join(INSTANCES_DIR, name);
    const tempDir = path.join(CACHE_DIR, `import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    if (fs.existsSync(instanceDir)) return { success: false, error: 'Ya existe una instancia con ese nombre' };

    try {
        const archive = new AdmZip(zipPath);
        if (!archive.getEntries().some(entry => isModrinthIndexName(entry.entryName))) {
            throw new Error('El ZIP no contiene modrinth.index.json');
        }
        safeArchiveExtract(archive, tempDir);
        const indexPath = findFileRecursive(tempDir, 'modrinth.index.json');
        if (!indexPath) throw new Error('No se pudo leer modrinth.index.json');

        const index = fs.readJsonSync(indexPath);
        const dependencies = index.dependencies || {};
        const gameVersion = dependencies.minecraft;
        if (!gameVersion) throw new Error('El modpack no indica la versión de Minecraft');

        const { loader, loaderVersion } = detectMrpackLoader(dependencies);

        const minecraftDir = path.join(instanceDir, '.minecraft');
        fs.ensureDirSync(minecraftDir);

        await downloadMrpackFiles(Array.isArray(index.files) ? index.files : [], minecraftDir);

        const overrides = findFileRecursive(tempDir, 'overrides');
        if (overrides && fs.statSync(overrides).isDirectory()) fs.copySync(overrides, minecraftDir, { overwrite: true });

        const loaderInfo = await installGameAndLoader(gameVersion, minecraftDir, loader, loaderVersion);

        const metadata = { name, type: 'modrinth', source: 'local-import', minecraftVersion: gameVersion, gameVersions: [gameVersion], loader, loaderVersion: loaderInfo?.version || loaderVersion, installedAt: new Date().toISOString(), authType: 'offline' };
        writeInstanceMetadata(instanceDir, metadata);
        return { success: true, path: instanceDir, loader, loaderVersion: metadata.loaderVersion };
    } catch (error) {
        try { if (fs.existsSync(instanceDir)) fs.removeSync(instanceDir); } catch (_) {}
        return { success: false, error: `Error importando MRPACK: ${error.message}` };
    } finally {
        if (fs.existsSync(tempDir)) { try { fs.removeSync(tempDir); } catch (_) {} }
    }
}

async function importZipFile(zipPath, instanceName) {
    if (!zipPath || !fs.existsSync(zipPath)) return { success: false, error: 'El archivo ZIP no existe' };
    const archive = new AdmZip(zipPath);
    const entries = archive.getEntries().map(entry => String(entry.entryName || '').replace(/\\/g, '/').replace(/^\.\//, ''));
    const hasModrinth = entries.some(isModrinthIndexName);
    const hasCurseForge = entries.some(name => name === 'manifest.json' || name.endsWith('/manifest.json'));
    if (hasModrinth) return importModrinthMrpack(zipPath, instanceName);
    if (hasCurseForge) return importCurseForgeZip(zipPath, instanceName);

    const name = sanitizeName(instanceName || path.basename(zipPath, path.extname(zipPath)));
    const instanceDir = path.join(INSTANCES_DIR, name);
    if (fs.existsSync(instanceDir)) return { success: false, error: 'Ya existe una instancia con ese nombre' };
    const tempDir = path.join(CACHE_DIR, `generic-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
        fs.ensureDirSync(instanceDir);
        safeArchiveExtract(archive, tempDir);
        const minecraftSource = fs.existsSync(path.join(tempDir, '.minecraft')) ? path.join(tempDir, '.minecraft') : tempDir;
        const minecraftDir = path.join(instanceDir, '.minecraft');
        fs.copySync(minecraftSource, minecraftDir, { overwrite: true });
        const metadata = { name, type: 'zip-import', source: 'local-import', installedAt: new Date().toISOString(), authType: 'offline' };
        fs.writeJsonSync(path.join(instanceDir, 'version.json'), metadata, { spaces: 2 });
        fs.writeJsonSync(path.join(instanceDir, 'instance.json'), metadata, { spaces: 2 });
        return { success: true, path: instanceDir, loader: 'unknown' };
    } catch (error) {
        try { if (fs.existsSync(instanceDir)) fs.removeSync(instanceDir); } catch (_) {}
        return { success: false, error: `Error importando ZIP: ${error.message}` };
    } finally {
        if (fs.existsSync(tempDir)) { try { fs.removeSync(tempDir); } catch (_) {} }
    }
}

// CurseForge

async function importCurseForgeZip(zipPath, instanceName) {
    const nombreLimpio = sanitizeName(instanceName);

    const instanceDir = path.join(INSTANCES_DIR, nombreLimpio);

    if (fs.existsSync(instanceDir)) {
        return { success: false, error: 'Ya existe una instancia con ese nombre' };
    }

    if (!zipPath || !fs.existsSync(zipPath)) {
        return { success: false, error: 'El archivo CurseForge no existe' };
    }

    try {
        fs.ensureDirSync(instanceDir);

        await extract(zipPath, { dir: instanceDir });

        // Buscar manifest

        const manifestPath = findFileRecursive(instanceDir, 'manifest.json');

        // ZIP simple sin manifest

        if (!manifestPath) {
            const minecraftDir = path.join(instanceDir, '.minecraft');

            fs.ensureDirSync(minecraftDir);

            const modsSource = findFileRecursive(instanceDir, 'mods');

            if (modsSource && fs.statSync(modsSource).isDirectory()) {
                const modsDest = path.join(minecraftDir, 'mods');

                fs.copySync(modsSource, modsDest, { overwrite: true });
            }

            const versionJson = {
                name: nombreLimpio,
                minecraftVersion: '1.20.4',
                gameVersions: ['1.20.4'],
                loader: 'vanilla',
                type: 'curseforge',
                installedAt: new Date().toISOString()
            };

            fs.writeJsonSync(path.join(instanceDir, 'version.json'), versionJson, { spaces: 2 });

            await downloadMinecraftVanilla('1.20.4', minecraftDir);

            await downloadAssets('1.20.4', minecraftDir);

            await downloadLibraries('1.20.4', minecraftDir);

            return { success: true, path: instanceDir };
        }

        // Manifest CurseForge

        const manifest = fs.readJsonSync(manifestPath);

        const gameVersion = manifest.minecraft?.version || '1.20.4';

        const minecraftDir = path.join(instanceDir, '.minecraft');

        fs.ensureDirSync(minecraftDir);

        // Localizar root del manifest

        const manifestRoot = path.dirname(manifestPath);

        const modsSource = path.join(manifestRoot, 'mods');

        const modsDest = path.join(minecraftDir, 'mods');

        if (fs.existsSync(modsSource)) {
            fs.copySync(modsSource, modsDest, { overwrite: true });
        }

        // Overrides

        const overrides = path.join(manifestRoot, 'overrides');

        if (fs.existsSync(overrides)) {
            fs.copySync(overrides, minecraftDir, { overwrite: true });
        }

        // Loader

        const modLoaderId = manifest.minecraft?.modLoaders?.[0]?.id || '';

        const lowerLoader = String(modLoaderId).toLowerCase();

        let loader = 'vanilla';

        if (lowerLoader.includes('neoforge')) {
            loader = 'neoforge';
        } else if (lowerLoader.includes('forge')) {
            loader = 'forge';
        } else if (lowerLoader.includes('fabric')) {
            loader = 'fabric';
        }

        loader = loaderManager.normalizeLoader(loader);

        let loaderVersion = null;

        if (modLoaderId.includes('-')) {
            const parts = modLoaderId.split('-');

            loaderVersion = parts.slice(1).join('-');
        }

        const versionJson = {
            name: nombreLimpio,
            minecraftVersion: gameVersion,
            gameVersions: [gameVersion],
            loader,
            loaderVersion,
            type: 'curseforge',
            installedAt: new Date().toISOString()
        };

        fs.writeJsonSync(path.join(instanceDir, 'version.json'), versionJson, { spaces: 2 });

        // Minecraft base + loader

        const installed = await installGameAndLoader(
            gameVersion,
            minecraftDir,
            loader,
            loaderVersion
        );

        if (installed?.version) {
            versionJson.loaderVersion = installed.version;

            fs.writeJsonSync(path.join(instanceDir, 'version.json'), versionJson, { spaces: 2 });
        }

        return {
            success: true,
            path: instanceDir,
            loader,
            loaderVersion: versionJson.loaderVersion
        };
    } catch (error) {
        logger.error(`Error importando CurseForge: ` + `${error.stack || error.message}`);

        try {
            if (fs.existsSync(instanceDir)) {
                fs.removeSync(instanceDir);
            }
        } catch (_) {}

        return { success: false, error: `Error importando CurseForge: ${error.message}` };
    }
}

// Instancias

module.exports = {
    searchModrinth,
    getModrinthModpack,
    installModpack,
    checkModpackUpdate,
    searchModrinthMods,
    getModrinthMod,
    listInstanceMods,
    toggleInstanceMod,
    checkInstanceModUpdates,
    updateInstanceMods,
    installModrinthMod,
    removeInstanceMod,
    importZipFile,
    importCurseForgeZip,
    normalizeMrpackPath,
    tryDownloadEntry
};
