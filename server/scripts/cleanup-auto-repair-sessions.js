#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

function printUsage() {
    console.log(`
Usage: node server/scripts/cleanup-auto-repair-sessions.js [options]

Delete all sessions with metadata.source starting with "hapi_repair" (Auto Repair sessions).

Options:
  --base-url=URL         API base URL (default: http://localhost:<webappPort>)
  --settings=PATH        Path to settings.json (default: ~/.hapi/settings.json or $HAPI_HOME)
  --token=TOKEN          CLI API token (default: $CLI_API_TOKEN or settings.json)
  --namespace=NAME       Namespace for access token (default: token namespace or "default")
  --limit=N              Max sessions to show/delete
  --delete               Delete sessions (default: dry-run)
  --yes                  Skip confirmation prompt
  --force                Add force=1 to DELETE (removes in-memory sessions even if DB row is missing)
  --help                 Show this help message
`);
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        baseUrl: null,
        settingsPath: null,
        token: null,
        namespace: null,
        limit: null,
        doDelete: false,
        yes: false,
        force: false,
        help: false
    };

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--delete') {
            options.doDelete = true;
        } else if (arg === '--yes' || arg === '-y') {
            options.yes = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg.startsWith('--base-url=')) {
            options.baseUrl = arg.split('=').slice(1).join('=');
        } else if (arg.startsWith('--settings=')) {
            options.settingsPath = arg.split('=').slice(1).join('=');
        } else if (arg.startsWith('--token=')) {
            options.token = arg.split('=').slice(1).join('=');
        } else if (arg.startsWith('--namespace=')) {
            options.namespace = arg.split('=').slice(1).join('=');
        } else if (arg.startsWith('--limit=')) {
            const value = Number.parseInt(arg.split('=')[1], 10);
            if (!Number.isFinite(value) || value < 1) {
                console.error('Error: --limit must be a positive integer');
                process.exit(1);
            }
            options.limit = value;
        } else {
            console.error(`Unknown argument: ${arg}`);
            console.error('Use --help for usage information.');
            process.exit(1);
        }
    }

    return options;
}

function resolveSettingsPath(explicitPath) {
    if (explicitPath) {
        return explicitPath;
    }
    const dataDir = process.env.HAPI_HOME
        ? process.env.HAPI_HOME.replace(/^~/, os.homedir())
        : path.join(os.homedir(), '.hapi');
    return path.join(dataDir, 'settings.json');
}

function readSettings(settingsPath) {
    if (!settingsPath || !fs.existsSync(settingsPath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, '');
}

function parseAccessToken(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const separatorIndex = trimmed.lastIndexOf(':');
    if (separatorIndex === -1) {
        return { baseToken: trimmed, namespace: 'default' };
    }
    const baseToken = trimmed.slice(0, separatorIndex);
    const namespace = trimmed.slice(separatorIndex + 1);
    if (!baseToken || !namespace) return null;
    return { baseToken, namespace };
}

function buildAccessToken(token, namespace) {
    const parsed = parseAccessToken(token);
    if (parsed && namespace && parsed.namespace !== namespace && parsed.baseToken) {
        return `${parsed.baseToken}:${namespace}`;
    }
    if (namespace && !token.includes(':')) {
        return `${token}:${namespace}`;
    }
    return token;
}

function requestJson(url, options) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const isHttps = target.protocol === 'https:';
        const client = isHttps ? https : http;
        const method = options.method || 'GET';
        const headers = { ...(options.headers || {}) };
        const body = options.body ?? null;

        if (body && !headers['content-type']) {
            headers['content-type'] = 'application/json';
        }
        if (body && !headers['content-length']) {
            headers['content-length'] = Buffer.byteLength(body);
        }

        const req = client.request({
            method,
            hostname: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data = null;
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch {
                        data = null;
                    }
                }
                const status = res.statusCode || 0;
                const result = { status, ok: status >= 200 && status < 300, data, text };
                if (result.ok) {
                    resolve(result);
                } else {
                    reject(result);
                }
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function renderSessionsTable(sessions) {
    if (sessions.length === 0) {
        console.log('No Auto Repair sessions found.');
        return;
    }

    const rows = sessions.map((session) => ({
        id: session.id,
        active: session.active ? 'Yes' : 'No',
        source: session.source ?? '',
        name: session.name ?? '',
        path: session.path ?? ''
    }));

    const idWidth = Math.max(8, ...rows.map(r => r.id.length));
    const activeWidth = Math.max(6, ...rows.map(r => r.active.length));
    const sourceWidth = Math.max(6, ...rows.map(r => r.source.length));
    const nameWidth = Math.max(4, ...rows.map(r => r.name.length));
    const pathWidth = Math.max(4, ...rows.map(r => r.path.length));

    const header = [
        'ID'.padEnd(idWidth),
        'Active'.padEnd(activeWidth),
        'Source'.padEnd(sourceWidth),
        'Name'.padEnd(nameWidth),
        'Path'.padEnd(pathWidth)
    ].join(' | ');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const row of rows) {
        console.log([
            row.id.padEnd(idWidth),
            row.active.padEnd(activeWidth),
            row.source.padEnd(sourceWidth),
            row.name.padEnd(nameWidth),
            row.path.padEnd(pathWidth)
        ].join(' | '));
    }
}

async function confirm(message) {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${message} [y/N]: `, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}

async function main() {
    const options = parseArgs();
    if (options.help) {
        printUsage();
        return;
    }

    const settingsPath = resolveSettingsPath(options.settingsPath);
    const settings = readSettings(settingsPath);

    const token = options.token || process.env.CLI_API_TOKEN || settings.cliApiToken;
    if (!token) {
        console.error('Missing CLI API token. Provide --token or set CLI_API_TOKEN.');
        process.exit(1);
    }

    const accessToken = buildAccessToken(token, options.namespace);
    const parsedToken = parseAccessToken(accessToken);
    const namespace = parsedToken ? parsedToken.namespace : 'default';

    const baseUrl = normalizeBaseUrl(
        options.baseUrl || `http://localhost:${settings.webappPort || 3006}`
    );

    console.log(`Base URL: ${baseUrl}`);
    console.log(`Namespace: ${namespace}`);

    const authBody = JSON.stringify({
        accessToken,
        clientId: 'cleanup-script',
        deviceType: 'script'
    });

    let jwtToken;
    try {
        const authResponse = await requestJson(`${baseUrl}/api/auth`, {
            method: 'POST',
            body: authBody
        });
        jwtToken = authResponse.data?.token;
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
            console.error(`Auth failed: HTTP ${error.status} ${error.text || ''}`.trim());
        } else {
            console.error(`Auth failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
    }

    if (!jwtToken) {
        console.error('Auth failed: missing token in response.');
        process.exit(1);
    }

    let sessions;
    try {
        const response = await requestJson(`${baseUrl}/api/sessions`, {
            headers: { authorization: `Bearer ${jwtToken}` }
        });
        sessions = response.data?.sessions;
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) {
            console.error(`Fetch sessions failed: HTTP ${error.status} ${error.text || ''}`.trim());
        } else {
            console.error(`Fetch sessions failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
    }

    if (!Array.isArray(sessions)) {
        console.error('Unexpected sessions response.');
        process.exit(1);
    }

    // Filter Auto Repair sessions (metadata.source starts with "hapi_repair")
    let autoRepairSessions = sessions
        .filter(session => {
            const source = session.metadata?.source?.trim() || '';
            return source.startsWith('hapi_repair');
        })
        .map(session => ({
            id: session.id,
            active: session.active,
            source: session.metadata?.source || '',
            name: session.metadata?.name || '',
            path: session.metadata?.path || ''
        }));

    if (options.limit !== null) {
        autoRepairSessions = autoRepairSessions.slice(0, options.limit);
    }

    console.log(`Total sessions: ${sessions.length}`);
    console.log(`Auto Repair sessions: ${autoRepairSessions.length}`);
    console.log('');

    renderSessionsTable(autoRepairSessions);

    if (!options.doDelete || autoRepairSessions.length === 0) {
        return;
    }

    if (!options.yes) {
        const confirmed = await confirm(`Delete ${autoRepairSessions.length} Auto Repair session(s)?`);
        if (!confirmed) {
            console.log('Aborted.');
            return;
        }
    }

    let deletedCount = 0;
    for (const session of autoRepairSessions) {
        const forceQuery = options.force ? '?force=1' : '';
        const deleteUrl = `${baseUrl}/api/sessions/${encodeURIComponent(session.id)}${forceQuery}`;
        try {
            await requestJson(deleteUrl, {
                method: 'DELETE',
                headers: { authorization: `Bearer ${jwtToken}` }
            });
            deletedCount += 1;
            console.log(`Deleted ${session.id}`);
        } catch (error) {
            if (error && typeof error === 'object' && 'status' in error) {
                console.error(`Failed to delete ${session.id}: HTTP ${error.status} ${error.text || ''}`.trim());
            } else {
                console.error(`Failed to delete ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    console.log(`Deleted ${deletedCount} session(s).`);
}

main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
