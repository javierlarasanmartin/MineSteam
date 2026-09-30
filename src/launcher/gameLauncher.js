// src/launcher/gameLauncher.js
// Lanzamiento de Minecraft: perfiles de loader, argumentos JVM/juego, classpath y proceso de Java.

const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const store = require('../utils/secureStore');
const logger = require('../utils/logger');
const javaManager = require('../utils/javaManager');
const { assertInstancePath, resolveInside } = require('../core/security');
const { copyFromCache } = require('../minecraft/libraryManager');
const classpathBuilder = require('../minecraft/classpathBuilder');
const loaderManager = require('../loaders/loaderManager');
const { getMainWindow, sendProgress, generateOfflineUUID, downloadFile, libraryAllowedByCurrentOS, downloadMinecraftVanilla, downloadAssets, downloadLibraries, downloadLoaderLibraries, getRequiredJavaVersion, downloadJava, LIBRARIES_CACHE, installLoader, isInstallableLoader } = require('./installer');

function findLoaderProfile(instanceMinecraftDir, loader, loaderVersion, minecraftVersion) {
    const versionsDir = path.join(instanceMinecraftDir, 'versions');

    if (!fs.existsSync(versionsDir)) {
        return null;
    }

    const candidates = [];

    for (const directory of fs.readdirSync(versionsDir)) {
        const jsonPath = path.join(versionsDir, directory, `${directory}.json`);

        if (!fs.existsSync(jsonPath)) {
            continue;
        }

        const lower = directory.toLowerCase();

        let matches = false;

        if (loader === 'fabric') {
            matches = lower.startsWith('fabric-loader-');
        }

        if (loader === 'forge') {
            matches = lower.includes('forge') && !lower.includes('neoforge');
        }

        if (loader === 'neoforge') {
            matches = lower.includes('neoforge');
        }

        if (!matches) {
            continue;
        }

        let profile = null;

        try {
            profile = fs.readJsonSync(jsonPath);
        } catch (_) {
            continue;
        }

        if (
            loaderVersion && !directory.includes(String(loaderVersion)) &&
            !String(profile.id || '').includes(String(loaderVersion))
        ) {
            continue;
        }

        if (
            minecraftVersion && profile.inheritsFrom && profile.inheritsFrom !== minecraftVersion
        ) {
            continue;
        }

        candidates.push({ path: jsonPath, mtime: fs.statSync(jsonPath).mtimeMs });
    }

    if (!candidates.length) {
        return null;
    }

    candidates.sort((a, b) => b.mtime - a.mtime);

    return candidates[0].path;
}

// Argumentos de Minecraft

function resolveMinecraftArg(value, ctx) {
    if (value === undefined || value === null) {
        return '';
    }

    let result = String(value);

    const replacements = {
        auth_player_name: ctx.username,
        auth_uuid: ctx.uuid,
        auth_access_token: '0',
        auth_session: '0',
        user_type: 'legacy',
        version_name: ctx.version,
        game_directory: ctx.gameDir,
        assets_root: ctx.assetsDir,
        assets_index_name: ctx.assetIndex,
        natives_directory: ctx.nativesDir,
        launcher_name: 'MineSteam',
        launcher_version: '2.4.2',
        classpath: ctx.classpath,
        classpath_separator: path.delimiter,
        library_directory: path.join(ctx.gameDir, 'libraries'),
        auth_xuid: '',
        clientid: ''
    };

    for (const [key, replacement] of Object.entries(replacements)) {
        const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');

        result = result.replace(pattern, String(replacement ?? ''));
    }

    return result;
}

// Reglas de argumentos

function argumentEntryAllowed(entry, ctx) {
    if (!entry || typeof entry !== 'object') {
        return true;
    }

    if (entry.rules && !libraryAllowedByCurrentOS(entry.rules)) {
        return false;
    }

    // Features utilizadas por Mojang.
    const features = entry.features || {};

    if (features.is_demo_user && ctx.isDemoUser !== true) {
        return false;
    }

    if (features.has_custom_resolution && ctx.hasCustomResolution !== true) {
        return false;
    }

    if (features.has_quick_plays_support && ctx.hasQuickPlaySupport !== true) {
        return false;
    }

    return true;
}

// JVM arguments

function flattenJvmArguments(profile, ctx) {
    const result = [];

    const jvmArgs = profile?.arguments?.jvm;

    if (!Array.isArray(jvmArgs)) {
        return result;
    }

    for (const entry of jvmArgs) {
        if (typeof entry === 'string') {
            const value = resolveMinecraftArg(entry, ctx);

            if (
                value && value !== '-cp' && value !== '${classpath}' && value !== '@${classpath}'
            ) {
                result.push(value);
            }

            continue;
        }

        if (!argumentEntryAllowed(entry, ctx)) {
            continue;
        }

        const values = Array.isArray(entry.value) ? entry.value : [entry.value];

        for (const value of values) {
            const resolved = resolveMinecraftArg(value, ctx);

            if (
                resolved && resolved !== '-cp' && resolved !== '${classpath}' &&
                resolved !== '@${classpath}'
            ) {
                result.push(resolved);
            }
        }
    }

    return result;
}

// Game arguments

function flattenGameArguments(profile, ctx) {
    const args = [];

    const gameArgs = profile?.arguments?.game;

    if (Array.isArray(gameArgs)) {
        for (const entry of gameArgs) {
            if (typeof entry === 'string') {
                args.push(resolveMinecraftArg(entry, ctx));

                continue;
            }

            if (!argumentEntryAllowed(entry, ctx)) {
                continue;
            }

            const values = Array.isArray(entry.value) ? entry.value : [entry.value];

            for (const value of values) {
                args.push(resolveMinecraftArg(value, ctx));
            }
        }
    } else {
        // Formato antiguo.
        args.push(
            '--username',
            ctx.username,

            '--version',
            ctx.version,

            '--gameDir',
            ctx.gameDir,

            '--assetsDir',
            ctx.assetsDir,

            '--assetIndex',
            ctx.assetIndex,

            '--uuid',
            ctx.uuid,

            '--accessToken',
            '0',

            '--userType',
            'legacy',

            '--versionType',
            'release'
        );
    }

    return args.filter(value => value !== undefined && value !== null && String(value) !== '');
}

// Argument file de Java

function quoteJavaArg(value) {
    const stringValue = String(value);

    // Java argument files utilizan espacios
    // como separadores.
    if (!/[\s"'#;]/.test(stringValue)) {
        return stringValue;
    }

    const normalized = stringValue.replace(/\\/g, '/');

    return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function createJavaArgFile(instancePath, args) {
    const javaArgFile = path.join(instancePath, 'java-launch.args');

    const content = args.map(quoteJavaArg).join('\n') + '\n';

    fs.writeFileSync(javaArgFile, content, 'utf8');

    return javaArgFile;
}

// Classpath


async function ensureLoaderMainClassLibrary(loader, loaderVersion, instanceMinecraftDir, libraries) {
    if (!loader || loader === 'vanilla' || !loaderVersion) return libraries;
    const normalized = String(loader).toLowerCase();
    if (normalized !== 'fabric') return libraries;
    const artifactPath = `net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`;
    const destination = path.join(instanceMinecraftDir, 'libraries', artifactPath);
    const cachePath = path.join(LIBRARIES_CACHE, artifactPath);
    const url = `https://maven.fabricmc.net/${artifactPath}`;
    fs.ensureDirSync(path.dirname(destination)); fs.ensureDirSync(path.dirname(cachePath));
    if (!fs.existsSync(destination) || fs.statSync(destination).size <= 0) {
        if (!copyFromCache(cachePath, destination)) {
            if (!await downloadFile(url, destination, 5)) throw new Error(`No se pudo descargar Fabric Loader ${loaderVersion}`);
            fs.copyFileSync(destination, cachePath);
        }
    }
    if (!libraries.map(x => path.resolve(x)).includes(path.resolve(destination))) libraries.push(destination);
    logger.info(`✓ Fabric Loader ${loaderVersion} agregado al classpath`);
    return libraries;
}

// Lanzamiento

function sendTerminalLog(level, message) {
    try {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            mainWindow.webContents.send('terminal-log', {
                level,
                source: 'minecraft',
                message,
                timestamp: new Date().toISOString()
            });
        }
    } catch (_) {}
}

function readInstanceInfo(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const versionJsonPath = path.join(safeInstancePath, 'version.json');

    if (!fs.existsSync(versionJsonPath)) {
        throw new Error('Instancia inválida: falta version.json');
    }

    const versionData = fs.readJsonSync(versionJsonPath);
    const minecraftVersion = versionData.minecraftVersion || versionData.gameVersions?.[0];

    if (!minecraftVersion) {
        throw new Error('No se pudo determinar la versión de Minecraft');
    }

    return {
        safeInstancePath,
        instanceMinecraftDir: path.join(safeInstancePath, '.minecraft'),
        minecraftVersion,
        loader: loaderManager.normalizeLoader(versionData.loader || 'vanilla'),
        loaderVersion: versionData.loaderVersion || null
    };
}

async function prepareVanilla(minecraftVersion, instanceMinecraftDir) {
    await downloadMinecraftVanilla(minecraftVersion, instanceMinecraftDir);
    await downloadAssets(minecraftVersion, instanceMinecraftDir);

    const vanillaLibraries = await downloadLibraries(minecraftVersion, instanceMinecraftDir);

    const versionDir = path.join(instanceMinecraftDir, 'versions', minecraftVersion);
    const vanillaJsonPath = path.join(versionDir, `${minecraftVersion}.json`);

    if (!fs.existsSync(vanillaJsonPath)) {
        throw new Error(`No existe el perfil Vanilla ${minecraftVersion}`);
    }

    return { vanillaLibraries, versionDir, vanillaProfile: fs.readJsonSync(vanillaJsonPath) };
}

async function resolveJava(minecraftVersion, javaVersion) {
    const requiredJavaVersion = Number(await getRequiredJavaVersion(minecraftVersion));
    const selectedJavaVersion = Number(javaVersion || 0);

    if (selectedJavaVersion && selectedJavaVersion < requiredJavaVersion) {
        throw new Error(
            `La instancia tiene Java ${selectedJavaVersion}, pero Minecraft ${minecraftVersion} ` +
            `requiere Java ${requiredJavaVersion} o superior.`
        );
    }

    const targetJavaVersion = selectedJavaVersion || requiredJavaVersion;
    const javaExecutable = await downloadJava(targetJavaVersion);

    if (javaExecutable === 'java') {
        const systemJava = javaManager.detectSystemJavaVersion();

        if (systemJava < requiredJavaVersion) {
            throw new Error(
                `Se requiere Java ${requiredJavaVersion}, ` +
                `pero el sistema tiene Java ${systemJava || 'desconocido'}`
            );
        }
    }

    return { javaExecutable, requiredJavaVersion, targetJavaVersion };
}

function resolvePlayer(auth) {
    const storedUser = store.get('user') || {};

    const username = String(auth?.username || storedUser.name || 'Steve').trim() || 'Steve';
    const uuid = String(auth?.uuid || storedUser.uuid || generateOfflineUUID(username));

    return { username, uuid };
}

// Devuelve el perfil del loader (instalándolo si falta) y sus librerías.
async function loadLoaderProfile({ loader, loaderVersion, minecraftVersion, instanceMinecraftDir, vanillaProfile }) {
    if (!isInstallableLoader(loader)) {
        return { profile: vanillaProfile, loaderLibraries: [] };
    }

    const profilePath = findLoaderProfile(
        instanceMinecraftDir,
        loader,
        loaderVersion,
        minecraftVersion
    );

    if (!profilePath) {
        const installed = await installLoader(loader, minecraftVersion, instanceMinecraftDir, loaderVersion);
        return { profile: installed.profile, loaderLibraries: installed.libraries };
    }

    const profile = fs.readJsonSync(profilePath);

    return {
        profile,
        loaderLibraries: await downloadLoaderLibraries(profile, instanceMinecraftDir)
    };
}

function buildLaunchClasspath({ instanceMinecraftDir, minecraftVersion, libraries, loader, profile }) {
    const classpathEntries = classpathBuilder.buildClasspath(
        instanceMinecraftDir,
        minecraftVersion,
        libraries,
        {
            // NeoForge 21.1+ carga el cliente como módulo. Incluir
            // versions/1.21.1/1.21.1.jar en el mismo classpath/module-path
            // provoca ResolutionException por paquetes exportados dos veces.
            includeMinecraftJar: loader !== 'neoforge'
        }
    );

    // Los perfiles de Forge/NeoForge tienen un JAR propio en versions/<profileId>.
    // El classpath vanilla no lo agrega automáticamente porque Minecraft vanilla
    // solo necesita versions/<minecraft>/<minecraft>.jar. Sin este JAR, Forge puede
    // terminar con código 1 aunque la instalación haya sido correcta.
    const loaderProfileId = profile?.id || null;

    if (loaderProfileId && loader !== 'vanilla') {
        const loaderJar = path.join(
            instanceMinecraftDir,
            'versions',
            loaderProfileId,
            `${loaderProfileId}.jar`
        );
        const safeLoaderJar = resolveInside(instanceMinecraftDir, loaderJar);

        if (fs.existsSync(safeLoaderJar) && fs.statSync(safeLoaderJar).isFile()) {
            const normalizedLoaderJar = path.resolve(safeLoaderJar);

            if (!classpathEntries.some(entry => path.resolve(entry) === normalizedLoaderJar)) {
                classpathEntries.unshift(normalizedLoaderJar);
                logger.info(`✓ JAR del loader agregado al classpath: ${loaderProfileId}.jar`);
            }
        } else if (loader === 'forge' || loader === 'neoforge') {
            logger.warn(
                `No se encontró el JAR del perfil ${loaderProfileId}; ` +
                'se intentará iniciar con las librerías disponibles.'
            );
        }
    }

    return classpathEntries;
}

function resolveNativesDir(instanceMinecraftDir, profile, minecraftVersion, vanillaNativesDir) {
    const loaderNativesDir = path.join(
        instanceMinecraftDir,
        'versions',
        profile.id || minecraftVersion,
        'natives'
    );

    const nativesDir = fs.existsSync(loaderNativesDir) ? loaderNativesDir : vanillaNativesDir;
    fs.ensureDirSync(nativesDir);

    return nativesDir;
}

// Verificación temprana: evita arrancar Java con un classpath que no
// contiene la clase principal del loader.
function assertFabricOnClasspath(loader, loaderVersion, mainClass, classpathEntries) {
    if (loader !== 'fabric' || mainClass !== 'net.fabricmc.loader.impl.launch.knot.KnotClient') {
        return;
    }

    const expectedJar = `fabric-loader-${String(loaderVersion).toLowerCase()}.jar`;

    if (!classpathEntries.some(entry => entry.toLowerCase().endsWith(expectedJar))) {
        throw new Error(
            `Fabric Loader ${loaderVersion} no quedó en el classpath. ` +
            `No se puede cargar ${mainClass}.`
        );
    }
}

function buildGameArguments({ effectiveProfile, ctx, minecraftVersion, username, uuid, resolution }) {
    let gameArgs = flattenGameArguments(effectiveProfile, ctx);

    // Formato antiguo (minecraftArguments)
    if (!Array.isArray(effectiveProfile.arguments?.game) && effectiveProfile.minecraftArguments) {
        gameArgs = String(effectiveProfile.minecraftArguments).split(/\s+/).filter(Boolean)
            .map(value => resolveMinecraftArg(value, ctx));
    }

    // Algunos perfiles modernos de Forge/NeoForge no conservan todos los
    // argumentos vanilla en profile.arguments.game. Minecraft 1.21.x exige al
    // menos --version y --accessToken; se proporcionan explícitamente para
    // cuentas offline y así evitar MissingRequiredOptionsException.
    const ensureGameArg = (name, value) => {
        const index = gameArgs.indexOf(name);

        if (index === -1) {
            gameArgs.push(name, String(value ?? ''));
            return;
        }

        if (index === gameArgs.length - 1 || String(gameArgs[index + 1] ?? '').startsWith('--')) {
            gameArgs.splice(index + 1, 0, String(value ?? ''));
        }
    };

    ensureGameArg('--version', minecraftVersion);
    ensureGameArg('--accessToken', '0');
    ensureGameArg('--username', username);
    ensureGameArg('--uuid', uuid);
    ensureGameArg('--userType', 'legacy');
    ensureGameArg('--versionType', 'release');

    if (resolution?.width && resolution?.height) {
        if (!gameArgs.includes('--width')) {
            gameArgs.push('--width', String(resolution.width));
        }

        if (!gameArgs.includes('--height')) {
            gameArgs.push('--height', String(resolution.height));
        }
    }

    return gameArgs;
}

function parseCustomJvmArgs(jvmArgs) {
    const raw = Array.isArray(jvmArgs) ? jvmArgs.join(' ') : String(jvmArgs || '');
    const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

    return tokens.map(value => value.replace(/^['"]|['"]$/g, '')).filter(Boolean).slice(0, 80);
}

// Windows limita CreateProcess a ~32767 caracteres: con un classpath muy largo
// se pasa todo mediante un Java argument file.
function prepareSpawnArgs(instancePath, args) {
    const commandLength = args.reduce((total, value) => total + String(value).length + 1, 0);
    const useJavaArgFile = process.platform === 'win32' && commandLength > 24000;

    if (!useJavaArgFile) {
        return { spawnArgs: args, javaArgFile: null, useJavaArgFile };
    }

    const javaArgFile = createJavaArgFile(instancePath, args);

    logger.info(
        `Classpath demasiado largo (${commandLength} caracteres). ` +
        'Usando Java argument file.'
    );

    return { spawnArgs: [`@${javaArgFile.replace(/\\/g, '/')}`], javaArgFile, useJavaArgFile };
}

function updateLaunchDebug(debugPath, changes) {
    try {
        const debug = fs.readJsonSync(debugPath);
        fs.writeJsonSync(debugPath, { ...debug, ...changes }, { spaces: 2 });
    } catch (_) {}
}

function runGameProcess({ javaExecutable, spawnArgs, cwd, instancePath, debugPath }) {
    return new Promise((resolve, reject) => {
        const proc = spawn(javaExecutable, spawnArgs, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            env: { ...process.env }
        });

        const runtimeLogPath = path.join(instancePath, 'minecraft-runtime.log');

        // Limpiar log anterior.
        try {
            fs.writeFileSync(runtimeLogPath, '', 'utf8');
        } catch (_) {}

        const appendRuntimeLog = chunk => {
            const text = chunk.toString();

            try {
                fs.appendFileSync(runtimeLogPath, text);
            } catch (_) {}

            const clean = text.trimEnd();
            if (!clean) return;

            logger.info(clean);

            for (const line of clean.split(/\r?\n/).filter(Boolean)) {
                const lower = line.toLowerCase();
                const level =
                    lower.includes('error') || lower.includes('exception') || lower.includes('crash')
                        ? 'error'
                        : lower.includes('warn') ? 'warn' : 'info';

                sendTerminalLog(level, line);
            }
        };

        proc.stdout.on('data', appendRuntimeLog);
        proc.stderr.on('data', appendRuntimeLog);

        proc.on('error', error => {
            logger.error(`Error ejecutando Minecraft: ${error.message}`);
            reject(error);
        });

        proc.on('close', code => {
            logger.info(`Minecraft finalizado con código ${code}`);
            sendTerminalLog(code === 0 ? 'info' : 'error', `Minecraft finalizado con código ${code}`);

            updateLaunchDebug(debugPath, {
                exitCode: code,
                finishedAt: new Date().toISOString(),
                runtimeLog: runtimeLogPath
            });

            if (code === 0) {
                resolve({ code, message: 'Juego cerrado' });
            } else {
                reject(new Error(
                    `Minecraft terminó con código ${code}. Revisa minecraft-runtime.log`
                ));
            }
        });
    });
}

async function launchMinecraft({
    instancePath,
    ram = 4096,
    resolution = { width: 854, height: 480 },
    javaVersion = null,
    jvmArgs = '',
    auth
}) {
    sendProgress('launch', 0, 1, 'Preparando lanzamiento...');

    const {
        safeInstancePath,
        instanceMinecraftDir,
        minecraftVersion,
        loader,
        loaderVersion
    } = readInstanceInfo(instancePath);

    logger.info(
        `Lanzando Minecraft ${minecraftVersion} ` +
        `(${loader}${loaderVersion ? ` ${loaderVersion}` : ''})`
    );

    const { vanillaLibraries, versionDir, vanillaProfile } =
        await prepareVanilla(minecraftVersion, instanceMinecraftDir);

    const { javaExecutable, requiredJavaVersion, targetJavaVersion } =
        await resolveJava(minecraftVersion, javaVersion);

    const { username, uuid } = resolvePlayer(auth);

    const vanillaNativesDir = path.join(versionDir, 'natives');
    fs.ensureDirSync(vanillaNativesDir);

    const { profile, loaderLibraries } = await loadLoaderProfile({
        loader,
        loaderVersion,
        minecraftVersion,
        instanceMinecraftDir,
        vanillaProfile
    });

    await ensureLoaderMainClassLibrary(
        loader,
        loaderVersion,
        instanceMinecraftDir,
        loaderLibraries
    );

    const classpathEntries = buildLaunchClasspath({
        instanceMinecraftDir,
        minecraftVersion,
        libraries: [...vanillaLibraries, ...loaderLibraries],
        loader,
        profile
    });
    const classpath = classpathEntries.join(path.delimiter);

    const assetIndex = vanillaProfile.assetIndex?.id || vanillaProfile.assets || minecraftVersion;

    const nativesDir = resolveNativesDir(
        instanceMinecraftDir,
        profile,
        minecraftVersion,
        vanillaNativesDir
    );

    const ctx = {
        username,
        uuid,
        version: profile.id || minecraftVersion,
        gameDir: instanceMinecraftDir,
        assetsDir: path.join(instanceMinecraftDir, 'assets'),
        assetIndex,
        nativesDir,
        classpath,
        isDemoUser: false,
        hasCustomResolution: Boolean(resolution?.width && resolution?.height),
        hasQuickPlaySupport: false
    };

    const mainClass = profile.mainClass || vanillaProfile.mainClass;

    if (!mainClass) {
        throw new Error(`El perfil ${loader} no contiene mainClass`);
    }

    assertFabricOnClasspath(loader, loaderVersion, mainClass, classpathEntries);

    logger.info(`Main class: ${mainClass}`);

    const effectiveProfile = {
        ...vanillaProfile,
        ...profile,
        arguments: { ...(vanillaProfile.arguments || {}), ...(profile.arguments || {}) }
    };

    const gameArgs = buildGameArguments({
        effectiveProfile,
        ctx,
        minecraftVersion,
        username,
        uuid,
        resolution
    });

    const profileJvmArgs = flattenJvmArguments(effectiveProfile, ctx);
    const customJvmArgs = parseCustomJvmArgs(jvmArgs);

    const safeRam = Math.max(512, Number(ram) || 4096);
    const initialRam = Math.max(512, Math.floor(safeRam / 4));

    const args = [
        `-Xmx${safeRam}M`,
        `-Xms${initialRam}M`,
        `-Djava.library.path=${nativesDir}`,
        ...profileJvmArgs,
        ...customJvmArgs,
        '-cp',
        classpath,
        mainClass,
        ...gameArgs
    ];

    logger.info(`Classpath: ${classpathEntries.length} elementos`);
    logger.info(`Argumentos JVM: ${profileJvmArgs.length}`);
    logger.info(`Argumentos Minecraft: ${gameArgs.length}`);

    const { spawnArgs, javaArgFile, useJavaArgFile } = prepareSpawnArgs(safeInstancePath, args);

    const debugPath = path.join(safeInstancePath, 'launch_debug.json');

    fs.writeJsonSync(
        debugPath,
        {
            generatedAt: new Date().toISOString(),
            minecraftVersion,
            loader,
            loaderVersion,
            mainClass,
            java: javaExecutable,
            javaRequired: requiredJavaVersion,
            javaSelected: targetJavaVersion,
            workingDirectory: instanceMinecraftDir,
            nativesDirectory: nativesDir,
            assetIndex,
            username,
            uuid,
            classpathEntries,
            classpathLength: classpath.length,
            args,
            usedJavaArgFile: useJavaArgFile,
            javaArgFile,
            spawnArgs
        },
        { spaces: 2 }
    );

    sendProgress('launch', 1, 1, `Lanzando Minecraft ${minecraftVersion}...`);
    sendTerminalLog('info', `Iniciando ${minecraftVersion} (${loader || 'Vanilla'})`);

    return runGameProcess({
        javaExecutable,
        spawnArgs,
        cwd: instanceMinecraftDir,
        instancePath: safeInstancePath,
        debugPath
    });
}

module.exports = { launchMinecraft };
