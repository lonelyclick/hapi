/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { runtimePath } from '@/projectPath';
import { withBunRuntimeEnv } from '@/utils/bunRuntime';

export interface RipgrepResult {
    exitCode: number
    stdout: string
    stderr: string
}

export interface RipgrepOptions {
    cwd?: string
}

let cachedBinaryPath: string | null = null;

function findSystemRg(): string | null {
    const platformName = platform();
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const platformDir = platformName === 'darwin' ? `${arch}-darwin`
        : platformName === 'linux' ? `${arch}-linux`
        : platformName === 'win32' ? `${arch}-win32`
        : null;

    // Try common locations
    const candidates = [
        '/usr/bin/rg',
        '/usr/local/bin/rg',
        '/opt/homebrew/bin/rg',
    ];

    // Also try claude-code vendor directory if available
    if (platformDir) {
        const nodeModulesPaths = [
            // Global npm/nvm installations
            process.env.NVM_DIR && join(process.env.NVM_DIR, 'versions/node', process.version, 'lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep', platformDir, 'rg'),
            // Local node_modules
            join(process.cwd(), 'node_modules/@anthropic-ai/claude-code/vendor/ripgrep', platformDir, 'rg'),
            // Home directory global
            join(process.env.HOME || '', '.nvm/versions/node', process.version, 'lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep', platformDir, 'rg'),
        ].filter(Boolean) as string[];

        candidates.unshift(...nodeModulesPaths);
    }

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function getBinaryPath(): string {
    if (cachedBinaryPath) {
        return cachedBinaryPath;
    }

    const platformName = platform();
    const binaryName = platformName === 'win32' ? 'rg.exe' : 'rg';
    const bundledPath = resolve(join(runtimePath(), 'tools', 'unpacked', binaryName));

    // Use bundled rg if available
    if (existsSync(bundledPath)) {
        cachedBinaryPath = bundledPath;
        return bundledPath;
    }

    // Fallback to system rg
    const systemRg = findSystemRg();
    if (systemRg) {
        cachedBinaryPath = systemRg;
        return systemRg;
    }

    // Return bundled path anyway - will fail with clear error message
    cachedBinaryPath = bundledPath;
    return bundledPath;
}

export function run(args: string[], options?: RipgrepOptions): Promise<RipgrepResult> {
    const binaryPath = getBinaryPath();
    return new Promise((resolve, reject) => {
        const child = spawn(binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options?.cwd,
            env: withBunRuntimeEnv()
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({
                exitCode: code || 0,
                stdout,
                stderr
            });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}
