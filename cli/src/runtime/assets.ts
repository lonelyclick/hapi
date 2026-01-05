import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { arch, platform } from 'node:os';
import * as tar from 'tar';
import packageJson from '../../package.json';
import type { EmbeddedAsset } from '#embedded-assets';
import { isBunCompiled, runtimePath } from '@/projectPath';

const RUNTIME_MARKER = '.runtime-version';

function ensureDirectory(path: string): void {
    mkdirSync(path, { recursive: true });
}

const bunRuntime = (globalThis as typeof globalThis & {
    Bun?: { file: (source: string | URL) => { arrayBuffer: () => Promise<ArrayBuffer> } };
}).Bun;

async function copyAssetFile(asset: EmbeddedAsset, targetPath: string): Promise<void> {
    ensureDirectory(dirname(targetPath));
    if (bunRuntime) {
        const data = await bunRuntime.file(asset.sourcePath).arrayBuffer();
        writeFileSync(targetPath, Buffer.from(data));
        return;
    }

    copyFileSync(asset.sourcePath, targetPath);
    try {
        const stats = statSync(asset.sourcePath);
        chmodSync(targetPath, stats.mode);
    } catch {
        // Best-effort; permission adjustments are not critical.
    }
}

function getPlatformDir(): string {
    const platformName = platform();
    const archName = arch();

    if (platformName === 'darwin') {
        if (archName === 'arm64') return 'arm64-darwin';
        if (archName === 'x64') return 'x64-darwin';
    } else if (platformName === 'linux') {
        if (archName === 'arm64') return 'arm64-linux';
        if (archName === 'x64') return 'x64-linux';
    } else if (platformName === 'win32') {
        if (archName === 'x64') return 'x64-win32';
    }

    throw new Error(`Unsupported platform: ${archName}-${platformName}`);
}

function areToolsUnpacked(unpackedPath: string): boolean {
    if (!existsSync(unpackedPath)) {
        return false;
    }

    const isWin = platform() === 'win32';
    const difftBinary = isWin ? 'difft.exe' : 'difft';
    const rgBinary = isWin ? 'rg.exe' : 'rg';

    const expectedFiles = [
        join(unpackedPath, difftBinary),
        join(unpackedPath, rgBinary)
    ];

    return expectedFiles.every((file) => existsSync(file));
}

function unpackTools(runtimeRoot: string): void {
    const platformDir = getPlatformDir();
    const toolsDir = join(runtimeRoot, 'tools');
    const archivesDir = join(toolsDir, 'archives');
    const unpackedPath = join(toolsDir, 'unpacked');

    if (areToolsUnpacked(unpackedPath)) {
        return;
    }

    rmSync(unpackedPath, { recursive: true, force: true });
    ensureDirectory(unpackedPath);

    const archives = [
        `difftastic-${platformDir}.tar.gz`,
        `ripgrep-${platformDir}.tar.gz`
    ];

    for (const archiveName of archives) {
        const archivePath = join(archivesDir, archiveName);
        if (!existsSync(archivePath)) {
            throw new Error(`Archive not found: ${archivePath}`);
        }
        tar.extract({
            file: archivePath,
            cwd: unpackedPath,
            sync: true,
            preserveOwner: false
        });
    }

    if (platform() !== 'win32') {
        const files = readdirSync(unpackedPath);
        for (const file of files) {
            if (file.endsWith('.node')) {
                continue;
            }
            const filePath = join(unpackedPath, file);
            const stats = statSync(filePath);
            if (stats.isFile()) {
                chmodSync(filePath, 0o755);
            }
        }
    }
}

function runtimeAssetsReady(runtimeRoot: string): boolean {
    return areToolsUnpacked(join(runtimeRoot, 'tools', 'unpacked'));
}

/**
 * 解析版本号中的日期和时间
 * 版本格式: v2026.01.05.1156 -> { date: "2026.01.05", time: "1156", timestamp: Date }
 */
function parseVersionDate(version: string): { date: string; time: string; timestamp: Date } | null {
    const match = version.match(/^v(\d{4})\.(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;

    const [, year, month, day, time] = match;
    const hours = time.slice(0, 2);
    const minutes = time.slice(2, 4);
    const date = `${year}.${month}.${day}`;
    const timestamp = new Date(`${year}-${month}-${day}T${hours}:${minutes}:00+08:00`); // 东八区

    return { date, time, timestamp };
}

/**
 * 清理旧的 runtime 版本
 * 规则：
 * - 当前版本始终保留
 * - 今天的版本：保留最新 5 个
 * - 7 天内的版本：每天保留最晚一个
 * - 7 天外的版本：全部删除
 */
function cleanupOldRuntimes(runtimeRoot: string, currentVersion: string): void {
    const runtimeParent = dirname(runtimeRoot);
    if (!existsSync(runtimeParent)) return;

    const versions = readdirSync(runtimeParent)
        .filter(name => name.startsWith('v') && existsSync(join(runtimeParent, name, RUNTIME_MARKER)));

    if (versions.length <= 1) return;

    const now = new Date();
    const todayStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 按日期分组
    const byDate = new Map<string, { version: string; parsed: ReturnType<typeof parseVersionDate> }[]>();
    const todayVersions: { version: string; parsed: ReturnType<typeof parseVersionDate> }[] = [];

    for (const version of versions) {
        if (version === currentVersion) continue; // 跳过当前版本

        const parsed = parseVersionDate(version);
        if (!parsed) continue;

        if (parsed.date === todayStr) {
            todayVersions.push({ version, parsed });
        } else {
            const existing = byDate.get(parsed.date) || [];
            existing.push({ version, parsed });
            byDate.set(parsed.date, existing);
        }
    }

    const toDelete: string[] = [];

    // 处理今天的版本：保留最新 5 个
    todayVersions.sort((a, b) => b.parsed!.time.localeCompare(a.parsed!.time));
    for (let i = 5; i < todayVersions.length; i++) {
        toDelete.push(todayVersions[i].version);
    }

    // 处理其他日期的版本
    for (const [date, dayVersions] of byDate) {
        // 解析日期判断是否在 7 天内
        const [year, month, day] = date.split('.').map(Number);
        const versionDate = new Date(year, month - 1, day);

        if (versionDate < sevenDaysAgo) {
            // 7 天外：全部删除
            for (const v of dayVersions) {
                toDelete.push(v.version);
            }
        } else {
            // 7 天内：只保留最晚一个
            dayVersions.sort((a, b) => b.parsed!.time.localeCompare(a.parsed!.time));
            for (let i = 1; i < dayVersions.length; i++) {
                toDelete.push(dayVersions[i].version);
            }
        }
    }

    // 执行删除
    for (const version of toDelete) {
        const versionPath = join(runtimeParent, version);
        try {
            rmSync(versionPath, { recursive: true, force: true });
        } catch {
            // 忽略删除失败
        }
    }
}

export async function ensureRuntimeAssets(): Promise<void> {
    if (!isBunCompiled()) {
        return;
    }

    const { loadEmbeddedAssets } = await import('#embedded-assets');
    const runtimeRoot = runtimePath();
    const markerPath = join(runtimeRoot, RUNTIME_MARKER);
    if (existsSync(markerPath)) {
        const markerVersion = readFileSync(markerPath, 'utf-8').trim();
        if (markerVersion === packageJson.version && runtimeAssetsReady(runtimeRoot)) {
            return;
        }
    }

    ensureDirectory(runtimeRoot);

    const embeddedAssets = await loadEmbeddedAssets();

    for (const asset of embeddedAssets) {
        const targetPath = join(runtimeRoot, asset.relativePath);
        await copyAssetFile(asset, targetPath);
    }

    unpackTools(runtimeRoot);
    writeFileSync(markerPath, packageJson.version, 'utf-8');

    // 清理旧版本
    cleanupOldRuntimes(runtimeRoot, packageJson.version);
}
