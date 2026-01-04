#!/usr/bin/env bun
/**
 * Generate VAPID key pair for Web Push notifications
 *
 * Usage:
 *   bun run scripts/generate-vapid-keys.ts
 *
 * Output:
 *   Prints the VAPID keys in different formats (env vars, JSON)
 */

import webPush from 'web-push'

const vapidKeys = webPush.generateVAPIDKeys()

console.log('='.repeat(60))
console.log('VAPID Keys Generated for Web Push Notifications')
console.log('='.repeat(60))
console.log('')
console.log('Add these to your environment variables or settings.json:')
console.log('')
console.log('Environment variables:')
console.log('----------------------')
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`)
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`)
console.log(`WEB_PUSH_VAPID_SUBJECT=mailto:your-email@example.com`)
console.log('')
console.log('settings.json format:')
console.log('---------------------')
console.log(JSON.stringify({
    webPushVapidPublicKey: vapidKeys.publicKey,
    webPushVapidPrivateKey: vapidKeys.privateKey,
    webPushVapidSubject: 'mailto:your-email@example.com'
}, null, 2))
console.log('')
console.log('='.repeat(60))
console.log('')
console.log('IMPORTANT:')
console.log('- Replace "your-email@example.com" with your actual email or website URL')
console.log('- The subject should be a mailto: or https: URL')
console.log('- Keep the private key secret!')
console.log('')
