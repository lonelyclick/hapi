import { describe, expect, it } from 'vitest'

import {
    buildCodexEnv,
    compareCodexVersions,
    parseCodexVersion,
    pickBestCodexCandidate
} from './codexBinary'

describe('codexBinary', () => {
    it('parses codex version output', () => {
        expect(parseCodexVersion('codex-cli 0.118.0')).toBe('0.118.0')
        expect(parseCodexVersion('codex-cli 0.43.0-alpha.5')).toBe('0.43.0-alpha.5')
        expect(parseCodexVersion('unknown')).toBeNull()
    })

    it('compares codex versions correctly', () => {
        expect(compareCodexVersions('0.118.0', '0.77.0')).toBeGreaterThan(0)
        expect(compareCodexVersions('0.43.0', '0.43.0-alpha.5')).toBeGreaterThan(0)
        expect(compareCodexVersions('0.43.0-alpha.5', '0.43.0-alpha.4')).toBeGreaterThan(0)
    })

    it('picks the highest installed version', () => {
        const best = pickBestCodexCandidate([
            { command: '/tmp/codex-077', version: '0.77.0' },
            { command: '/tmp/codex-118', version: '0.118.0' },
            { command: '/tmp/codex-alpha', version: '0.118.0-alpha.1' }
        ])

        expect(best).toEqual({
            command: '/tmp/codex-118',
            version: '0.118.0'
        })
    })

    it('prepends resolved codex bin dir to PATH', () => {
        const env = buildCodexEnv(
            { PATH: '/usr/local/bin:/usr/bin', HOME: '/home/guang' },
            '/home/guang/.nvm/versions/node/v24.12.0/bin/codex'
        )

        expect(env.PATH).toBe('/home/guang/.nvm/versions/node/v24.12.0/bin:/usr/local/bin:/usr/bin')
    })
})
