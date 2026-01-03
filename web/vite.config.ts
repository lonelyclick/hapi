import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const base = process.env.VITE_BASE_URL || '/'

// Get build version (timestamp in Asia/Shanghai timezone)
function getBuildVersion() {
    try {
        const now = new Date()
        // Format: v2026.01.02.1344 (Asia/Shanghai timezone)
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })
        const parts = formatter.formatToParts(now)
        const get = (type: string) => parts.find(p => p.type === type)?.value || ''
        const version = `v${get('year')}.${get('month')}.${get('day')}.${get('hour')}${get('minute')}`

        const commitMessage = execSync('git log -1 --format=%s', { encoding: 'utf-8' }).trim()
        return { version, commitMessage }
    } catch {
        return { version: 'unknown', commitMessage: 'unknown' }
    }
}

const buildInfo = getBuildVersion()

export default defineConfig({
    define: {
        __GIT_COMMIT_HASH__: JSON.stringify(buildInfo.version),
        __GIT_COMMIT_MESSAGE__: JSON.stringify(buildInfo.commitMessage)
    },
    server: {
        host: true,
        allowedHosts: ['hapidev.weishu.me'],
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:3006',
                changeOrigin: true
            },
            '/socket.io': {
                target: 'http://127.0.0.1:3006',
                ws: true
            }
        }
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'mask-icon.svg'],
            manifest: {
                name: 'Yoho Remote',
                short_name: 'Yoho',
                description: 'AI-powered development assistant',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                scope: base,
                start_url: base,
                icons: [
                    {
                        src: 'pwa-64x64.png',
                        sizes: '64x64',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    },
                    {
                        src: 'maskable-icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                skipWaiting: true,
                clientsClaim: true,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                runtimeCaching: [
                    {
                        urlPattern: /^\/api\/sessions$/,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-sessions',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 60 * 5
                            },
                            networkTimeoutSeconds: 10
                        }
                    },
                    {
                        urlPattern: /^\/api\/sessions\/[^/]+$/,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-session-detail',
                            expiration: {
                                maxEntries: 20,
                                maxAgeSeconds: 60 * 5
                            },
                            networkTimeoutSeconds: 10
                        }
                    },
                    {
                        urlPattern: /^\/api\/machines$/,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'api-machines',
                            expiration: {
                                maxEntries: 5,
                                maxAgeSeconds: 60 * 10
                            },
                            networkTimeoutSeconds: 10
                        }
                    },
                    {
                        urlPattern: /^https:\/\/cdn\.socket\.io\/.*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-socketio',
                            expiration: {
                                maxEntries: 5,
                                maxAgeSeconds: 60 * 60 * 24 * 30
                            }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/telegram\.org\/.*/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-telegram',
                            expiration: {
                                maxEntries: 5,
                                maxAgeSeconds: 60 * 60 * 24 * 7
                            }
                        }
                    }
                ]
            },
            devOptions: {
                enabled: true,
                type: 'module'
            }
        })
    ],
    base,
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true
    }
})
