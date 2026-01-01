interface UpdateBannerProps {
    onRefresh: () => void
    onDismiss: () => void
}

export function UpdateBanner({ onRefresh, onDismiss }: UpdateBannerProps) {
    return (
        <div className="fixed top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-3 border-b border-blue-600">
            <span>New version available</span>
            <button
                onClick={onRefresh}
                className="px-3 py-1 bg-white text-blue-600 rounded-full text-xs font-semibold hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
                Refresh
            </button>
            <button
                onClick={onDismiss}
                className="text-white/80 hover:text-white text-xs underline"
            >
                Later
            </button>
        </div>
    )
}
