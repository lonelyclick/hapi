import { Toaster as HotToaster } from 'react-hot-toast'

export function Toaster() {
    return (
        <HotToaster
            position="top-center"
            containerStyle={{
                top: 'calc(env(safe-area-inset-top) + 8px)',
            }}
            toastOptions={{
                duration: 4000,
                style: {
                    background: 'var(--app-bg)',
                    color: 'var(--app-fg)',
                    border: '1px solid var(--app-divider)',
                    borderRadius: '12px',
                    padding: '12px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                },
                success: {
                    style: {
                        borderColor: 'rgba(16, 185, 129, 0.3)',
                        background: 'var(--app-bg)',
                    },
                    iconTheme: {
                        primary: '#10b981',
                        secondary: 'white',
                    },
                },
            }}
        />
    )
}
