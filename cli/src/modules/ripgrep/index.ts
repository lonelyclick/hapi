/**
 * Low-level ripgrep wrapper - just arguments in, string out
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
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
    const candidates: string[] = [
        '/usr/bin/rg',
        '/usr/local/bin/rg',
        '/opt/homebrew/bin/rg',
    ];

    // Also try claude-code vendor directory if available
    if (platformDir) {
        const nvmDir = process.env.NVM_DIR || join(process.env.HOME || '', '.nvm');
        const nvmVersionsDir = join(nvmDir, 'versions/node');

        // Search all nvm node versions for claude-code
        try {
            const versions = readdirSync(nvmVersionsDir).filter((v: string) => v.startsWith('v'));
            for (const version of versions) {
                candidates.unshift(
                    join(nvmVersionsDir, version, 'lib/node_modules/@anthropic-ai/claude-code/vendor/ripgrep', platformDir, 'rg')
                );
            }
        } catch {
            // nvm not installed or no versions
        }

        // Also check local node_modules
        candidates.unshift(
            join(process.cwd(), 'node_modules/@anthropic-ai/claude-code/vendor/ripgrep', platformDir, 'rg')
        );
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
