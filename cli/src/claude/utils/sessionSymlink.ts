import os from 'node:os';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    symlinkSync,
    unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

function safeReadDirDirs(dir: string): string[] {
    if (!existsSync(dir)) {
        return [];
    }
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(dir, entry.name));
    } catch (error) {
        logger.debug('[sessionSymlink] Failed to read directory', { dir, error });
        return [];
    }
}

function findSessionFileInConfigDir(opts: {
    configDir: string;
    sessionId: string;
    projectId: string;
}): string | null {
    const expected = join(opts.configDir, 'projects', opts.projectId, `${opts.sessionId}.jsonl`);
    if (existsSync(expected)) {
        return expected;
    }

    const projectsDir = join(opts.configDir, 'projects');
    if (!existsSync(projectsDir)) {
        return null;
    }
    try {
        for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const candidate = join(projectsDir, entry.name, `${opts.sessionId}.jsonl`);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    } catch (error) {
        logger.debug('[sessionSymlink] Failed to scan projects dir', { projectsDir, error });
    }
    return null;
}

export function ensureClaudeSessionSymlink(opts: {
    sessionId: string;
    workingDirectory: string;
    newAccountConfigDir: string;
}): { targetFile: string; sourceFile?: string } {
    const projectId = resolve(opts.workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
    const targetProjectDir = join(opts.newAccountConfigDir, 'projects', projectId);
    const targetFile = join(targetProjectDir, `${opts.sessionId}.jsonl`);

    // Check if target exists as a valid file (existsSync follows symlinks)
    // Also handle broken symlinks: lstatSync succeeds but existsSync returns false
    let needsSymlink = !existsSync(targetFile);
    if (needsSymlink) {
        try {
            lstatSync(targetFile);
            unlinkSync(targetFile);
        } catch {
            // ignore
        }
    }
    if (!needsSymlink) {
        return { targetFile };
    }

    const homeDir = os.homedir();
    const defaultClaudeDir = join(homeDir, '.claude');

    const candidateAccountBases = new Set<string>([
        // Default hapi home on most systems
        join(homeDir, '.hapi', 'claude-accounts'),
        // Respect HAPI_HOME if CLI is configured
        join(configuration.happyHomeDir, 'claude-accounts'),
    ]);

    // Support custom account bases by scanning siblings (but avoid scanning the whole home dir).
    const newAccountParent = dirname(opts.newAccountConfigDir);
    if (newAccountParent && newAccountParent !== homeDir && newAccountParent !== '/') {
        candidateAccountBases.add(newAccountParent);
    }

    const candidateConfigDirs = new Set<string>();
    candidateConfigDirs.add(defaultClaudeDir);
    for (const baseDir of candidateAccountBases) {
        for (const configDir of safeReadDirDirs(baseDir)) {
            candidateConfigDirs.add(configDir);
        }
    }

    for (const configDir of candidateConfigDirs) {
        if (configDir === opts.newAccountConfigDir) continue;

        const sourceFile = findSessionFileInConfigDir({
            configDir,
            sessionId: opts.sessionId,
            projectId,
        });
        if (!sourceFile) continue;

        try {
            mkdirSync(targetProjectDir, { recursive: true });
            symlinkSync(sourceFile, targetFile);
            logger.debug(`[sessionSymlink] Symlinked session file: ${sourceFile} -> ${targetFile}`);
            return { targetFile, sourceFile };
        } catch (error) {
            logger.debug('[sessionSymlink] Failed to symlink session file', { sourceFile, targetFile, error });
            return { targetFile };
        }
    }

    logger.debug('[sessionSymlink] Session file not found in other account dirs', {
        sessionId: opts.sessionId,
        projectId,
        targetFile,
        candidates: Array.from(candidateConfigDirs),
    });
    return { targetFile };
}

