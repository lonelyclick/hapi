import { Toaster as Sonner } from 'sonner'

export function Toaster() {
    return (
        <Sonner
            position="top-center"
            toastOptions={{
                unstyled: true,
                classNames: {
                    toast: 'w-full flex items-center gap-3 p-3 rounded-xl shadow-lg border border-[var(--app-divider)] bg-[var(--app-bg)] backdrop-blur-sm',
                    title: 'text-sm font-medium text-[var(--app-fg)]',
                    description: 'text-xs text-[var(--app-hint)]',
                    actionButton: 'px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] hover:opacity-90 transition-opacity',
                    cancelButton: 'px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-secondary-bg)] transition-colors',
                    success: 'border-emerald-500/30 bg-emerald-500/5',
                    error: 'border-red-500/30 bg-red-500/5',
                    warning: 'border-amber-500/30 bg-amber-500/5',
                    info: 'border-blue-500/30 bg-blue-500/5',
                },
            }}
            offset="calc(env(safe-area-inset-top) + 8px)"
            gap={8}
            expand={false}
            richColors={false}
            closeButton={false}
            duration={4000}
        />
    )
}
