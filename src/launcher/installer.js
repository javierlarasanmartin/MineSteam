// src/launcher/installer.js
// Descarga e instalación de Minecraft: versiones, assets, librerías, Java y loaders.

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const { app, BrowserWindow } = require('electron');
const logger = require('../utils/logger');
const pLimit = require('p-limit');
const javaManager = require('../utils/javaManager');
const libraryManager = require('../minecraft/libraryManager');
const { sha1File, copyFromCache } = require('../minecraft/libraryManager');
const loaderManager = require('../loaders/loaderManager');

const downloadConcurrency = pLimit(24);
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const activeDownloads = new Map();

// Constantes y rutas

const INSTANCES_DIR = path.join(app.getPath('userData'), 'instances');
const CACHE_DIR = path.join(app.getPath('userData'), 'cache');

const ASSETS_CACHE = path.join(CACHE_DIR, 'assets');
const LIBRARIES_CACHE = path.join(CACHE_DIR, 'libraries');
const JAVA_CACHE = path.join(CACHE_DIR, 'java');

const BUNDLED_VERSIONS_DIR = path.join(
    process.resourcesPath || path.join(__dirname, '..', '..'),
    'bundled_versions'
);

fs.ensureDirSync(INSTANCES_DIR);
fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(ASSETS_CACHE);
fs.ensureDirSync(LIBRARIES_CACHE);
fs.ensureDirSync(JAVA_CACHE);

// URLs

const activeMirror = {
    name: 'Mojang (directo)',
    librariesUrl: 'https://libraries.minecraft.net/',
    manifestUrl: 'https://launchermeta.mojang.com/mc/game/version_manifest.json'
};

const MODRINTH_API = 'https://api.modrinth.com/v2';

// Progreso

function getMainWindow() {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

function sendProgress(stage, current, total, message = '') {
    try {
        const mainWindow = getMainWindow();

        if (!mainWindow) return;

        const progress =
            total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;

        mainWindow.webContents.send('download-progress', {
            stage,
            current,
            total,
            progress,
            message
        });
        mainWindow.webContents.send('terminal-log', {
            level: 'info',
            source: 'launcher',
            message: `[${stage}] ${message || `${current}/${total}`}`,
            progress,
            timestamp: new Date().toISOString()
        });
    } catch (_) {
        // La ventana puede haberse cerrado.
    }
}

// Utilidades

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeName(name) {
    if (!name) return 'instancia';

    return String(name).replace(/[\\/:\*?"<>|()\s]/g, '_').trim() || 'instancia';
}

function generateOfflineUUID(username) {
    const digest = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();

    digest[6] = (digest[6] & 0x0f) | 0x30;
    digest[8] = (digest[8] & 0x3f) | 0x80;

    const hex = digest.toString('hex');

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join('-');
}

function getPlatformName() {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'osx';
    return 'linux';
}

function ensureInsideDirectory(root, target) {
    const rootResolved = path.resolve(root);
    const targetResolved = path.resolve(target);

    return (targetResolved === rootResolved || targetResolved.startsWith(rootResolved + path.sep));
}

// Mirror

async function findWorkingMirror() {
    return activeMirror;
}

// Manifest de Minecraft

const FALLBACK_RELEASE_VERSIONS = [
    '26.2', '26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7',
    '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
    '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20',
    '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19', '1.18.2', '1.18.1',
    '1.18', '1.17.1', '1.17', '1.16.5', '1.16.4', '1.16.3', '1.16.2',
    '1.16.1', '1.15.2', '1.15.1', '1.15', '1.14.4', '1.14.3', '1.14.2',
    '1.14.1', '1.14', '1.13.2', '1.13.1', '1.13', '1.12.2', '1.12.1',
    '1.12', '1.11.2', '1.11.1', '1.11', '1.10.2', '1.10', '1.9.4',
    '1.9.3', '1.9.2', '1.9', '1.8.9', '1.8.8', '1.8.7', '1.8', '1.7.10',
    '1.7.9', '1.7.8', '1.7.2', '1.6.4', '1.6.2', '1.5.2', '1.4.7',
    '1.3.2', '1.2.5', '1.1', '1.0'
];

function getFallbackManifest() {
    return {
        latest: { release: FALLBACK_RELEASE_VERSIONS[0], snapshot: FALLBACK_RELEASE_VERSIONS[0] },
        versions: FALLBACK_RELEASE_VERSIONS.map(id => ({
            id, type: 'release', releaseTime: null, url: null
        }))
    };
}

async function getVersionManifest() {
    try {
        const response = await axios.get(activeMirror.manifestUrl, {
            timeout: 20000,
            headers: { 'User-Agent': 'MineSteam/2.4.2', 'Accept': 'application/json' }
        });

        if (!response.data || !Array.isArray(response.data.versions)) {
            throw new Error('El manifest de Mojang no tiene un formato válido');
        }

        return response.data;
    } catch (error) {
        logger.warn(`No se pudo obtener el manifest de Mojang; usando catálogo local: ${error.message}`);
        return getFallbackManifest();
    }
}

async function getLatestMinecraftVersion() {
    const manifest = await getVersionManifest();

    if (!manifest.latest?.release) {
        throw new Error('Mojang no indicó la última versión estable');
    }

    return manifest.latest.release;
}

async function getVersionList() {
    const manifest = await getVersionManifest();

    return manifest.versions.map(version => version.id).filter(Boolean);
}

async function getReleaseVersionList() {
    const manifest = await getVersionManifest();
    return manifest.versions.filter(version => version && version.type === 'release')
        .map(version => ({
            id: version.id,
            type: version.type,
            releaseTime: version.releaseTime || null,
            url: version.url || null
        }))
        .filter(version => version.id);
}

// Descargas

async function downloadFile(url, destPath, retries = 3, progressCallback = null) {
    if (!url) throw new Error('URL de descarga vacía');

    if (fs.existsSync(destPath)) {
        try {
            const stat = fs.statSync(destPath);
            if (stat.isFile() && stat.size > 0) return true;
            fs.removeSync(destPath);
        } catch (_) {}
    }

    const key = path.resolve(destPath);
    if (activeDownloads.has(key)) return activeDownloads.get(key);

    const task = (async () => {
        fs.ensureDirSync(path.dirname(destPath));
        const temporaryPath = `${destPath}.part`;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (fs.existsSync(temporaryPath)) fs.removeSync(temporaryPath);

                const response = await axios({
                    method: 'GET',
                    url,
                    responseType: 'stream',
                    timeout: 180000,
                    maxRedirects: 10,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    decompress: true,
                    httpsAgent,
                    httpAgent,
                    headers: {
                        'User-Agent': 'MineSteam/2.4.2',
                        'Accept': '*/*',
                        'Connection': 'keep-alive'
                    }
                });

                const totalLength = Number(response.headers['content-length']) || 0;
                let downloaded = 0;
                const writer = fs.createWriteStream(temporaryPath, { highWaterMark: 1024 * 1024 });

                response.data.on('data', chunk => {
                    downloaded += chunk.length;
                    if (progressCallback) progressCallback(downloaded, totalLength);
                });

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                    response.data.on('error', reject);
                    response.data.pipe(writer);
                });

                const stat = fs.statSync(temporaryPath);
                if (stat.size <= 0) throw new Error('El servidor devolvió un archivo vacío');

                fs.moveSync(temporaryPath, destPath, { overwrite: true });
                return true;
            } catch (error) {
                logger.warn(`Descarga fallida ${path.basename(destPath)} (${attempt}/${retries}): ${error.message}`);
                try { if (fs.existsSync(temporaryPath)) fs.removeSync(temporaryPath); } catch (_) {}
                if (attempt < retries) await sleep(Math.min(1000 * attempt, 3000));
            }
        }
        return false;
    })();

    activeDownloads.set(key, task);
    try { return await task; }
    finally { activeDownloads.delete(key); }
}

// Hash del cliente

// Librerías - reglas

function libraryAllowedByCurrentOS(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return true;
    }

    const currentOS = getPlatformName();

    let allowed = false;
    let hasAllowRule = false;

    for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue;

        const ruleOS = rule.os?.name;

        const matchesOS = !ruleOS || ruleOS === currentOS;

        if (!matchesOS) continue;

        if (rule.action === 'allow') {
            allowed = true;
            hasAllowRule = true;
        }

        if (rule.action === 'disallow') {
            return false;
        }
    }

    return hasAllowRule ? allowed : true;
}

function selectNativeClassifier(lib) {
    const classifiers = lib?.downloads?.classifiers || {};

    const preferred =
        process.platform === 'win32'
            ? ['natives-windows-64', 'natives-windows', 'natives-windows-x86']
            : process.platform === 'darwin' ? ['natives-osx', 'natives-macos'] : ['natives-linux'];

    for (const key of preferred) {
        if (classifiers[key]) {
            return classifiers[key];
        }
    }

    for (const [key, value] of Object.entries(classifiers)) {
        const lower = key.toLowerCase();

        if (!lower.includes('natives')) continue;

        if (process.platform === 'win32' && lower.includes('windows')) {
            return value;
        }

        if (process.platform === 'darwin' && (lower.includes('osx') || lower.includes('mac'))) {
            return value;
        }

        if (process.platform === 'linux' && lower.includes('linux')) {
            return value;
        }
    }

    return null;
}

// Minecraft vanilla

async function downloadMinecraftVanilla(minecraftVersion, instanceMinecraftDir) {
    const versionDir = path.join(instanceMinecraftDir, 'versions', minecraftVersion);

    const jarPath = path.join(versionDir, `${minecraftVersion}.jar`);

    const jsonPath = path.join(versionDir, `${minecraftVersion}.json`);

    // Ya instalado.
    if (fs.existsSync(jarPath) && fs.existsSync(jsonPath)) {
        const stats = fs.statSync(jarPath);

        if (stats.size > 0) {
            logger.info(
                `Minecraft ${minecraftVersion} ya existe ` +
                `(${(stats.size / 1024 / 1024).toFixed(2)} MB)`
            );

            return true;
        }

        fs.removeSync(jarPath);
    }

    fs.ensureDirSync(versionDir);

    // Bundled version

    const bundledDir = path.join(BUNDLED_VERSIONS_DIR, minecraftVersion);

    const bundledJar = path.join(bundledDir, `${minecraftVersion}.jar`);

    const bundledJson = path.join(bundledDir, `${minecraftVersion}.json`);

    if (fs.existsSync(bundledJar) && fs.existsSync(bundledJson)) {
        fs.copyFileSync(bundledJar, jarPath);
        fs.copyFileSync(bundledJson, jsonPath);

        logger.info(`Minecraft ${minecraftVersion} copiado desde bundled_versions`);

        return true;
    }

    // Manifest

    sendProgress('minecraft', 0, 2, `Preparando Minecraft ${minecraftVersion}...`);

    const manifest = await getVersionManifest();

    const versionInfo = manifest.versions.find(version => version.id === minecraftVersion);

    if (!versionInfo) {
        throw new Error(`La versión ${minecraftVersion} no existe en el manifest de Mojang`);
    }

    const jsonResponse = await axios.get(
        versionInfo.url,
        { timeout: 20000, headers: { 'User-Agent': 'MineSteam/2.4.2' } }
    );

    const versionJson = jsonResponse.data;

    if (!versionJson) {
        throw new Error(`Mojang devolvió un JSON vacío para ${minecraftVersion}`);
    }

    fs.writeJsonSync(jsonPath, versionJson, { spaces: 2 });

    sendProgress('minecraft', 1, 2, `Descargando cliente ${minecraftVersion}...`);

    // Client JAR

    let clientUrl = versionJson.downloads?.client?.url || null;

    // Compatibilidad con versiones extremadamente antiguas.
    if (!clientUrl) {
        clientUrl =
            `https://s3.amazonaws.com/Minecraft.Download/versions/` +
            `${minecraftVersion}/${minecraftVersion}.jar`;

        logger.warn(
            `${minecraftVersion} no tiene downloads.client; ` +
            `probando repositorio histórico de Minecraft`
        );
    }

    const downloaded = await downloadFile(clientUrl, jarPath, 5);

    if (!downloaded) {
        throw new Error(`No se pudo descargar ${minecraftVersion}.jar`);
    }

    const jarStats = fs.statSync(jarPath);

    if (jarStats.size <= 0) {
        throw new Error(`${minecraftVersion}.jar quedó vacío`);
    }

    // Server JAR para versiones antiguas

    const serverUrl =
        versionJson.downloads?.server?.url ||
        (
            /^1\.(\d+)(?:\.(\d+))?$/.test(minecraftVersion) &&
            parseInt(minecraftVersion.split('.')[1], 10) <= 12
                ? `https://s3.amazonaws.com/Minecraft.Download/versions/` +
                  `${minecraftVersion}/${minecraftVersion}_server.jar`
                : null
        );

    if (serverUrl) {
        const serverPath = path.join(versionDir, `${minecraftVersion}-server.jar`);

        await downloadFile(serverUrl, serverPath, 3).catch(error => {
            logger.warn(
                `No se pudo descargar server.jar de ${minecraftVersion}: ` + error.message
            );
        });
    }

    sendProgress('minecraft', 2, 2, 'Minecraft listo');

    return true;
}

// Idiomas / recurso de compatibilidad

const MINESTEAM_LANGUAGE_NAMES = {
    en_us: ['English (US)', 'United States'],
    en_gb: ['English (UK)', 'United Kingdom'],
    es_es: ['Español (España)', 'España'],
    es_mx: ['Español (México)', 'México'],
    es_ar: ['Español (Argentina)', 'Argentina'],
    es_cl: ['Español (Chile)', 'Chile'],
    es_ec: ['Español (Ecuador)', 'Ecuador'],
    es_uy: ['Español (Uruguay)', 'Uruguay'],
    es_ve: ['Español (Venezuela)', 'Venezuela'],
    pt_br: ['Português (Brasil)', 'Brasil'],
    pt_pt: ['Português (Portugal)', 'Portugal'],
    fr_fr: ['Français', 'France'],
    fr_ca: ['Français (Canada)', 'Canada'],
    de_de: ['Deutsch', 'Deutschland'],
    it_it: ['Italiano', 'Italia'],
    ja_jp: ['日本語', '日本'],
    ko_kr: ['한국어', '대한민국'],
    zh_cn: ['简体中文', '中国'],
    zh_tw: ['繁體中文', '台灣'],
    ru_ru: ['Русский', 'Россия'],
    uk_ua: ['Українська', 'Україна'],
    pl_pl: ['Polski', 'Polska'],
    nl_nl: ['Nederlands', 'Nederland'],
    tr_tr: ['Türkçe', 'Türkiye'],
    sv_se: ['Svenska', 'Sverige'],
    da_dk: ['Dansk', 'Danmark'],
    fi_fi: ['Suomi', 'Suomi'],
    nb_no: ['Norsk Bokmål', 'Norge'],
    cs_cz: ['Čeština', 'Česko'],
    hu_hu: ['Magyar', 'Magyarország'],
    ro_ro: ['Română', 'România'],
    el_gr: ['Ελληνικά', 'Ελλάδα'],
    bg_bg: ['Български', 'България'],
    sk_sk: ['Slovenčina', 'Slovensko'],
    hr_hr: ['Hrvatski', 'Hrvatska'],
    sl_si: ['Slovenščina', 'Slovenija'],
    ca_es: ['Català', 'Catalunya'],
    eu_es: ['Euskara', 'Euskal Herria'],
    gl_es: ['Galego', 'Galicia'],
    he_il: ['עברית', 'ישראל'],
    ar_sa: ['العربية', 'العربية'],
    hi_in: ['हिन्दी', 'भारत'],
    id_id: ['Bahasa Indonesia', 'Indonesia'],
    ms_my: ['Bahasa Melayu', 'Malaysia'],
    vi_vn: ['Tiếng Việt', 'Việt Nam'],
    th_th: ['ไทย', 'ประเทศไทย']
};

function getResourcePackFormat(minecraftVersion) {
    const v = String(minecraftVersion || '');
    const exact = {
        '1.21': 34, '1.21.1': 34,
        '1.21.2': 42, '1.21.3': 42,
        '1.21.4': 46, '1.21.5': 55,
        '1.21.6': 63, '1.21.7': 64, '1.21.8': 64,
        '1.21.9': 69, '1.21.10': 69, '1.21.11': 75,
        '26.1': 84, '26.1.1': 84, '26.1.2': 84,
        '26.2': 88
    };
    if (exact[v]) return exact[v];
    if (/^1\.20\.5|^1\.20\.6/.test(v)) return 32;
    if (/^1\.20\.([1-4])$/.test(v)) return 22;
    if (/^1\.19/.test(v)) return 13;
    return 34;
}

function updateOptionsResourcePack(instanceMinecraftDir) {
    const optionsPath = path.join(instanceMinecraftDir, 'options.txt');
    let text = '';
    try { if (fs.existsSync(optionsPath)) text = fs.readFileSync(optionsPath, 'utf8'); } catch (_) {}
    const pack = 'file/MineSteam-Languages';
    const regex = /^resourcePacks:(.*)$/m;
    let packs = ['vanilla'];
    const match = text.match(regex);
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) packs = parsed.map(String);
        } catch (_) {}
    }
    if (!packs.includes('vanilla')) packs.unshift('vanilla');
    if (!packs.includes(pack)) packs.push(pack);
    const line = `resourcePacks:${JSON.stringify(packs)}`;
    if (regex.test(text)) text = text.replace(regex, line);
    else text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
    try { fs.writeFileSync(optionsPath, text, 'utf8'); } catch (_) {}
}

function ensureLanguageResourcePack(minecraftVersion, instanceMinecraftDir, indexData) {
    const objects = indexData?.objects || {};
    const languageEntries = Object.entries(objects).filter(([name]) => {
        const normalized = String(name).replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('minecraft/lang/') && normalized.endsWith('.json');
    });
    if (!languageEntries.length) return { count: 0, path: null };

    const packRoot = path.join(instanceMinecraftDir, 'resourcepacks', 'MineSteam-Languages');
    const langRoot = path.join(packRoot, 'assets', 'minecraft', 'lang');
    fs.ensureDirSync(langRoot);
    const languageMeta = {};
    let copied = 0;

    for (const [assetName, object] of languageEntries) {
        const hash = object?.hash;
        if (!hash || hash.length < 2) continue;
        const source = path.join(instanceMinecraftDir, 'assets', 'objects', hash.substring(0, 2), hash);
        if (!fs.existsSync(source) || fs.statSync(source).size <= 0) continue;
        const code = path.basename(assetName, '.json').toLowerCase();
        const destination = path.join(langRoot, `${code}.json`);
        try {
            fs.copyFileSync(source, destination);
            const meta = MINESTEAM_LANGUAGE_NAMES[code] || [`Minecraft (${code})`, code];
            languageMeta[code] = { name: meta[0], region: meta[1], bidirectional: ['ar_sa', 'he_il'].includes(code) };
            copied++;
        } catch (_) {}
    }

    const packFormat = getResourcePackFormat(minecraftVersion);
    const packDefinition = packFormat >= 65
        ? {
            min_format: [packFormat, 0],
            max_format: [packFormat, 0],
            description: 'MineSteam - Idiomas de Minecraft',
            language: languageMeta
        }
        : {
            pack_format: packFormat,
            description: 'MineSteam - Idiomas de Minecraft',
            language: languageMeta
        };
    const packMeta = { pack: packDefinition };
    fs.writeJsonSync(path.join(packRoot, 'pack.mcmeta'), packMeta, { spaces: 2 });
    updateOptionsResourcePack(instanceMinecraftDir);
    return { count: copied, path: packRoot };
}

// Assets

async function downloadAssets(minecraftVersion, instanceMinecraftDir) {
    const versionDir = path.join(instanceMinecraftDir, 'versions', minecraftVersion);
    const jsonPath = path.join(versionDir, `${minecraftVersion}.json`);
    if (!fs.existsSync(jsonPath)) throw new Error(`Falta el JSON de Minecraft ${minecraftVersion}`);

    const versionJson = fs.readJsonSync(jsonPath);
    const assetsId = versionJson.assetIndex?.id || versionJson.assets || minecraftVersion;
    const assetsUrl = versionJson.assetIndex?.url;
    const assetsSha1 = versionJson.assetIndex?.sha1 || null;
    const assetsDir = path.join(instanceMinecraftDir, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const objectsDir = path.join(assetsDir, 'objects');
    fs.ensureDirSync(indexesDir);
    fs.ensureDirSync(objectsDir);
    if (!assetsUrl) throw new Error(`Minecraft ${minecraftVersion} no proporciona assetIndex`);

    const indexPath = path.join(indexesDir, `${assetsId}.json`);
    const indexValid = () => {
        try {
            if (!fs.existsSync(indexPath) || fs.statSync(indexPath).size <= 0) return false;
            if (assetsSha1 && sha1File(indexPath).toLowerCase() !== assetsSha1.toLowerCase()) return false;
            const data = fs.readJsonSync(indexPath);
            return data && typeof data.objects === 'object';
        } catch (_) { return false; }
    };
    if (!indexValid()) {
        try { fs.removeSync(indexPath); } catch (_) {}
        const ok = await downloadFile(assetsUrl, indexPath, 5);
        if (!ok || !indexValid()) throw new Error(`No se pudo validar el índice de assets ${assetsId}`);
    }

    const indexData = fs.readJsonSync(indexPath);
    const entries = Object.entries(indexData.objects || {});
    const languageEntries = entries.filter(([assetPath]) => {
        const normalized = String(assetPath).replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('minecraft/lang/') && normalized.endsWith('.json');
    });
    logger.info(`Índice ${assetsId}: ${languageEntries.length} archivos de idioma detectados.`);

    let completed = 0;
    sendProgress('assets', 0, Math.max(1, entries.length), `Descargando ${entries.length} assets...`);
    await Promise.all(entries.map(([assetName, object]) => downloadConcurrency(async () => {
        const hash = object?.hash;
        if (!hash || hash.length < 2) throw new Error(`Asset sin hash: ${assetName}`);
        const subPath = hash.substring(0, 2);
        const objectPath = path.join(objectsDir, subPath, hash);
        const cachePath = path.join(ASSETS_CACHE, subPath, hash);
        const expectedSize = Number(object?.size || 0);
        let valid = false;
        const check = file => {
            try {
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
                const stat = fs.statSync(file);
                if (stat.size <= 0 || (expectedSize > 0 && stat.size !== expectedSize)) return false;
                return sha1File(file).toLowerCase() === hash.toLowerCase();
            } catch (_) { return false; }
        };
        valid = check(objectPath);
        if (!valid && check(cachePath)) {
            fs.ensureDirSync(path.dirname(objectPath));
            fs.copyFileSync(cachePath, objectPath);
            valid = true;
        }
        if (!valid) {
            try { fs.removeSync(objectPath); } catch (_) {}
            const url = `https://resources.download.minecraft.net/${subPath}/${hash}`;
            const ok = await downloadFile(url, objectPath, 5);
            if (!ok || !check(objectPath)) {
                try { fs.removeSync(objectPath); } catch (_) {}
                throw new Error(`No se pudo verificar asset ${assetName}`);
            }
            fs.ensureDirSync(path.dirname(cachePath));
            fs.copyFileSync(objectPath, cachePath);
        }
        completed++;
        if (completed % 25 === 0 || completed === entries.length) sendProgress('assets', completed, entries.length, `Assets: ${completed}/${entries.length}`);
    })));

    // Fallback robusto: además del asset index oficial, generamos un pequeño
    // resource pack activo con los idiomas vanilla. Así Minecraft puede
    // descubrir y mostrar los idiomas incluso cuando una instalación externa
    // trae un asset index incompleto o una configuración antigua.
    const languagePack = ensureLanguageResourcePack(minecraftVersion, instanceMinecraftDir, indexData);
    if (languagePack.count > 0) logger.info(`MineSteam Languages: ${languagePack.count} idiomas disponibles.`);
    else logger.warn(`No se pudieron materializar los idiomas vanilla de ${minecraftVersion}.`);

    sendProgress('assets', entries.length, entries.length, `Assets completos · ${languagePack.count} idiomas disponibles`);
    return { success: true, assets: entries.length, languages: languagePack.count, languagePack: languagePack.path };
}

// Librerías vanilla

async function downloadLibraries(minecraftVersion, instanceMinecraftDir) {
    const versionDir = path.join(instanceMinecraftDir, 'versions', minecraftVersion);

    const jsonPath = path.join(versionDir, `${minecraftVersion}.json`);

    if (!fs.existsSync(jsonPath)) {
        return [];
    }

    const versionJson = fs.readJsonSync(jsonPath);

    const allLibraries = [];

    for (const lib of versionJson.libraries || []) {
        if (lib.rules && !libraryAllowedByCurrentOS(lib.rules)) {
            continue;
        }

        // Artifact normal.
        if (lib.downloads?.artifact?.path && lib.downloads?.artifact?.url) {
            allLibraries.push({
                type: 'artifact',
                path: lib.downloads.artifact.path,
                url: lib.downloads.artifact.url
            });
        }

        // Native.
        const native = selectNativeClassifier(lib);

        if (native?.path && native?.url) {
            allLibraries.push({ type: 'native', path: native.path, url: native.url });
        }
    }

    const librariesDir = path.join(instanceMinecraftDir, 'libraries');

    const nativesDir = path.join(versionDir, 'natives');

    fs.ensureDirSync(librariesDir);
    fs.ensureDirSync(nativesDir);

    const total = allLibraries.length;

    sendProgress('libraries', 0, total, `Descargando ${total} librerías...`);

    const result = [];
    let completed = 0;

    // Las librerías son independientes: descargarlas en paralelo reduce
    // mucho el tiempo total de instalación.
    await Promise.all(allLibraries.map(lib => downloadConcurrency(async () => {
        const libraryPath = path.join(librariesDir, lib.path);
        const cachePath = path.join(LIBRARIES_CACHE, lib.path);

        if (!fs.existsSync(libraryPath)) {
            if (!copyFromCache(cachePath, libraryPath)) {
                const url = String(lib.url).replace(
                    'https://libraries.minecraft.net/',
                    activeMirror.librariesUrl
                );
                const ok = await downloadFile(url, libraryPath, 5);
                if (!ok) throw new Error(`No se pudo descargar la librería ${lib.path}`);
                fs.ensureDirSync(path.dirname(cachePath));
                fs.copyFileSync(libraryPath, cachePath);
            }
        }

        if (lib.type === 'native' && fs.existsSync(libraryPath)) {
            try {
                const zip = new AdmZip(libraryPath);
                zip.extractAllTo(nativesDir, true);
            } catch (error) {
                logger.warn(`No se pudo extraer native ${lib.path}: ${error.message}`);
            }
        }

        // IMPORTANTE: devolver/agregar la ruta es necesario para que estas
        // librerías formen parte del classpath final. Antes se descargaban
        // correctamente pero `result` quedaba vacío, dejando fuera Log4j y
        // otras librerías vanilla al iniciar Fabric.
        result.push(libraryPath);

        completed++;
        if (completed % 10 === 0 || completed === total) {
            sendProgress('libraries', completed, total, `Librerías: ${completed}/${total}`);
        }
        return libraryPath;
    })));

    sendProgress('libraries', total, total, 'Librerías completas');

    return result;
}

// MineSteam 3.0 - cliente srg de NeoForge
// NeoForge necesita el cliente remapeado SRG en el classpath
// para que las clases de Minecraft cliente estén disponibles.

// Librerías de loader (Fabric / Forge / NeoForge)
//
// Los perfiles de los loaders no siempre usan el mismo formato que
// el manifest vanilla de Mojang. Esta función normaliza:
//
//   downloads.artifact
//   downloads.classifiers
//   name (coordenadas Maven)
//   url/path explícitos
//
// y mantiene las librerías dentro de .minecraft/libraries.

async function downloadLoaderLibraries(profile, instanceMinecraftDir) {
    return libraryManager.resolveProfileLibraries({
        profile,
        instanceMinecraftDir,
        cacheDir: LIBRARIES_CACHE,
        downloadFile,
        sendProgress
    });
}

// Java

async function getRequiredJavaVersion(minecraftVersion) {
    return String(await javaManager.resolveRequiredJavaVersion(minecraftVersion));
}

async function downloadJava(version) {
    const required = Number(version);

    if (![8, 16, 17, 21, 25].includes(required)) {
        throw new Error(`Versión de Java no soportada: ${version}`);
    }

    const systemVersion = javaManager.detectSystemJavaVersion();

    if (systemVersion === required) {
        logger.info(`Java ${systemVersion} detectado y coincide con Java ${required} requerido`);
        return 'java';
    }

    const localJava = javaManager.getLocalJavaPath(required);

    if (localJava) {
        logger.info(`Java ${required} encontrado en runtime local: ${localJava}`);
        return localJava;
    }

    logger.info(`Java ${required} no está disponible. Descargando runtime administrado por MineSteam...`);

    const executable = await javaManager.downloadJava(required);

    if (!executable) {
        throw new Error(`javaManager no devolvió un ejecutable para Java ${required}`);
    }

    return executable;
}

// Loaders
// La implementación de los loaders vive ahora en src/loaders/.
// Se mantienen estas funciones wrapper para conservar el API interno
// del launcher y no romper instalaciones existentes.


async function installFabric(minecraftVersion, instanceMinecraftDir, preferredVersion = null) {
    return loaderManager.install(
        'fabric',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        { downloadFile, downloadLoaderLibraries, getRequiredJavaVersion, downloadJava }
    );
}

async function installForge(minecraftVersion, instanceMinecraftDir, preferredVersion = null) {
    return loaderManager.install(
        'forge',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        { downloadFile, downloadLoaderLibraries, getRequiredJavaVersion, downloadJava }
    );
}

async function installNeoForge(minecraftVersion, instanceMinecraftDir, preferredVersion = null) {
    return loaderManager.install(
        'neoforge',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        { downloadFile, downloadLoaderLibraries, getRequiredJavaVersion, downloadJava }
    );
}

const LOADER_INSTALLERS = () => ({
    fabric: installFabric,
    forge: installForge,
    neoforge: installNeoForge
});

function isInstallableLoader(loader) {
    return Object.prototype.hasOwnProperty.call(LOADER_INSTALLERS(), loader);
}

// Instala el loader indicado; devuelve null si es vanilla o desconocido.
async function installLoader(loader, minecraftVersion, instanceMinecraftDir, loaderVersion = null) {
    const install = LOADER_INSTALLERS()[loader];
    return install ? install(minecraftVersion, instanceMinecraftDir, loaderVersion) : null;
}

// Instala el juego base (cliente, assets, librerías) y, si corresponde, el loader.
// Devuelve la información del loader instalado, o null si es vanilla.
async function installGameAndLoader(minecraftVersion, instanceMinecraftDir, loader, loaderVersion = null) {
    await downloadMinecraftVanilla(minecraftVersion, instanceMinecraftDir);
    await downloadAssets(minecraftVersion, instanceMinecraftDir);
    await downloadLibraries(minecraftVersion, instanceMinecraftDir);

    return installLoader(loader, minecraftVersion, instanceMinecraftDir, loaderVersion);
}

async function getLoaderVersionList(loader, minecraftVersion) {
    const normalized = loaderManager.normalizeLoader(loader);
    if (normalized === 'vanilla' || !minecraftVersion) return [];
    return loaderManager.getAvailableVersions(normalized, minecraftVersion);
}

// Instancia personalizada


module.exports = {
    getMainWindow,
    sendProgress,
    sanitizeName,
    generateOfflineUUID,
    ensureInsideDirectory,
    findWorkingMirror,
    getVersionManifest,
    getLatestMinecraftVersion,
    getVersionList,
    getReleaseVersionList,
    downloadFile,
    libraryAllowedByCurrentOS,
    downloadMinecraftVanilla,
    downloadAssets,
    downloadLibraries,
    downloadLoaderLibraries,
    getRequiredJavaVersion,
    downloadJava,
    installFabric,
    installForge,
    installNeoForge,
    installGameAndLoader,
    installLoader,
    isInstallableLoader,
    getLoaderVersionList,
    INSTANCES_DIR,
    CACHE_DIR,
    ASSETS_CACHE,
    LIBRARIES_CACHE,
    JAVA_CACHE,
    MODRINTH_API
};
