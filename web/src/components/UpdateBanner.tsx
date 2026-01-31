import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { refreshApp } from '@/hooks/useVersionCheck'

interface UpdateBannerProps {
    onDismiss: () => void
}

export function UpdateBanner({ onDismiss }: UpdateBannerProps) {
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onDismiss() }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-center">Update Available</DialogTitle>
                    <DialogDescription className="text-center">
                        A new version is available. Refresh now to get the latest features?
                    </DialogDescription>
                </DialogHeader>
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onDismiss}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors"
                    >
                        Later
                    </button>
                    <button
                        onClick={refreshApp}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
