import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Spinner } from '@/components/Spinner'

export function SyncingBanner({ isSyncing }: { isSyncing: boolean }) {
    const isOnline = useOnlineStatus()

    // Don't show syncing banner when offline (OfflineBanner takes precedence)
    if (!isSyncing || !isOnline) {
        return null
    }

    return (
        <div className="fixed inset-0 bg-[var(--app-bg)] z-50 flex flex-col items-center justify-center gap-3">
            <Spinner size="md" label={null} className="text-[var(--app-hint)]" />
            <span className="text-sm text-[var(--app-hint)]">Syncing…</span>
        </div>
    )
}
