import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface UpdateBannerProps {
    onRefresh: () => void
    onDismiss: () => void
}

export function UpdateBanner({ onRefresh, onDismiss }: UpdateBannerProps) {
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onDismiss() }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-center">新版本可用</DialogTitle>
                    <DialogDescription className="text-center">
                        发现新版本，是否立即刷新以获取最新功能？
                    </DialogDescription>
                </DialogHeader>
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onDismiss}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--app-subtle-bg)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors"
                    >
                        稍后
                    </button>
                    <button
                        onClick={onRefresh}
                        className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700 transition-colors"
                    >
                        立即刷新
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
