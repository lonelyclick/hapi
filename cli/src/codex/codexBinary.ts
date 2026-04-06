import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface CodexCandidate {
    command: string
    version: string | null
}

export interface ResolvedCodexBinary {
    command: string
    version: string | null
    env: NodeJS.ProcessEnv
}

export function parseCodexVersion(output: string): string | null {
    const match = output.trim().match(/codex-cli\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    return match ? match[1] : null;
}

function parseVersionParts(version: string): { main: number[]; prerelease: string[] } {
    const [mainPart, prereleasePart] = version.split('-', 2);
    return {
        main: mainPart.split('.').map((part) => parseInt(part, 10)),
        prerelease: prereleasePart ? prereleasePart.split('.') : []
    };
}

export function compareCodexVersions(a: string, b: string): number {
    const left = parseVersionParts(a);
    const right = parseVersionParts(b);

    for (let i = 0; i < Math.max(left.main.length, right.main.length); i++) {
        const leftPart = left.main[i] ?? 0;
        const rightPart = right.main[i] ?? 0;
        if (leftPart !== rightPart) {
            return leftPart - rightPart;
        }
    }

    if (left.prerelease.length === 0 && right.prerelease.length === 0) {
        return 0;
    }
    if (left.prerelease.length === 0) {
        return 1;
    }
    if (right.prerelease.length === 0) {
        return -1;
    }

    for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
        const leftPart = left.prerelease[i];
        const rightPart = right.prerelease[i];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);

        if (leftNumeric && rightNumeric) {
            const leftValue = parseInt(leftPart, 10);
            const rightValue = parseInt(rightPart, 10);
            if (leftValue !== rightValue) {
                return leftValue - rightValue;
            }
            continue;
        }

        if (leftNumeric !== rightNumeric) {
            return leftNumeric ? -1 : 1;
        }

        const result = leftPart.localeCompare(rightPart);
        if (result !== 0) {
            return result;
        }
    }

    return 0;
}

export function pickBestCodexCandidate(candidates: CodexCandidate[]): CodexCandidate | null {
    const withVersion = candidates.filter((candidate) => Boolean(candidate.version)) as Array<CodexCandidate & { version: string }>;
    if (withVersion.length > 0) {
        return withVersion.reduce((best, current) => (
            compareCodexVersions(current.version, best.version) > 0 ? current : best
        ));
    }

    return candidates[0] ?? null;
}

function findExecutableInPath(binaryName: string, envPath?: string): string[] {
    if (!envPath) {
        return [];
    }

    const matches: string[] = [];
    for (const directory of envPath.split(delimiter)) {
        if (!directory) continue;
        const candidate = join(directory, binaryName);
        if (existsSync(candidate)) {
            matches.push(resolve(candidate));
        }
    }
    return matches;
}

function findNvmCodexExecutables(homeDir?: string, nvmDir?: string): string[] {
    const baseDir = nvmDir || (homeDir ? join(homeDir, '.nvm') : '');
    if (!baseDir) {
        return [];
    }

    const versionsDir = join(baseDir, 'versions', 'node');
    if (!existsSync(versionsDir)) {
        return [];
    }

    try {
        return readdirSync(versionsDir)
            .filter((entry) => entry.startsWith('v'))
            .map((entry) => resolve(join(versionsDir, entry, 'bin', 'codex')))
            .filter((candidate) => existsSync(candidate));
    } catch {
        return [];
    }
}

function detectCodexVersion(command: string, env: NodeJS.ProcessEnv): string | null {
    try {
        const output = execFileSync(command, ['--version'], {
            encoding: 'utf8',
            env: env as Record<string, string>
        });
        return parseCodexVersion(output);
    } catch {
        return null;
    }
}

function uniq<T>(items: T[]): T[] {
    return [...new Set(items)];
}

export function buildCodexEnv(baseEnv: NodeJS.ProcessEnv, command: string): NodeJS.ProcessEnv {
    if (!command.includes('/')) {
        return { ...baseEnv };
    }

    const binDir = dirname(command);
    const currentPath = baseEnv.PATH ?? '';
    const parts = currentPath.split(delimiter).filter(Boolean);
    const nextPath = [binDir, ...parts.filter((part) => resolve(part) !== resolve(binDir))].join(delimiter);

    return {
        ...baseEnv,
        PATH: nextPath
    };
}

export function resolveCodexBinary(baseEnv: NodeJS.ProcessEnv = process.env): ResolvedCodexBinary {
    const candidatePaths = uniq([
        ...findExecutableInPath('codex', baseEnv.PATH),
        ...findNvmCodexExecutables(baseEnv.HOME, baseEnv.NVM_DIR)
    ]);

    const candidates = candidatePaths.map((command) => ({
        command,
        version: detectCodexVersion(command, baseEnv)
    }));

    const best = pickBestCodexCandidate(candidates) ?? { command: 'codex', version: null };
    return {
        command: best.command,
        version: best.version,
        env: buildCodexEnv(baseEnv, best.command)
    };
}
