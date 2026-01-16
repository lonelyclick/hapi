import { useState, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function PlayIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
    )
}

function PauseIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
    )
}

function DownloadIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    )
}

interface VideoSettings {
    brightness: number
    contrast: number
    saturation: number
    hue: number
    blur: number
    grayscale: number
    sepia: number
}

export default function VideoDisguiserPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const goBack = useAppGoBack()
    
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    
    const [videoFile, setVideoFile] = useState<File | null>(null)
    const [videoUrl, setVideoUrl] = useState<string>('')
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [isProcessing, setIsProcessing] = useState(false)
    const [progress, setProgress] = useState(0)
    
    const [settings, setSettings] = useState<VideoSettings>({
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hue: 0,
        blur: 0,
        grayscale: 0,
        sepia: 0,
    })

    const [originalSettings] = useState<VideoSettings>({
        brightness: 100,
        contrast: 100,
        saturation: 100,
        hue: 0,
        blur: 0,
        grayscale: 0,
        sepia: 0,
    })

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (file && file.type.startsWith('video/')) {
            setVideoFile(file)
            const url = URL.createObjectURL(file)
            setVideoUrl(url)
            setIsPlaying(false)
            setProgress(0)
        }
    }, [])

    const applyFilters = useCallback(() => {
        if (!videoRef.current || !canvasRef.current) return
        
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        
        if (!ctx) return
        
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        
        const filters = []
        if (settings.brightness !== 100) filters.push(`brightness(${settings.brightness}%)`)
        if (settings.contrast !== 100) filters.push(`contrast(${settings.contrast}%)`)
        if (settings.saturation !== 100) filters.push(`saturate(${settings.saturation}%)`)
        if (settings.hue !== 0) filters.push(`hue-rotate(${settings.hue}deg)`)
        if (settings.blur > 0) filters.push(`blur(${settings.blur}px)`)
        if (settings.grayscale > 0) filters.push(`grayscale(${settings.grayscale}%)`)
        if (settings.sepia > 0) filters.push(`sepia(${settings.sepia}%)`)
        
        ctx.filter = filters.join(' ')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    }, [settings])

    const handlePlayPause = useCallback(() => {
        if (!videoRef.current) return
        
        if (isPlaying) {
            videoRef.current.pause()
        } else {
            videoRef.current.play()
        }
        setIsPlaying(!isPlaying)
    }, [isPlaying])

    const handleReset = useCallback(() => {
        setSettings(originalSettings)
    }, [originalSettings])

    const handleDownload = useCallback(async () => {
        if (!videoRef.current || !canvasRef.current || !videoFile) return
        
        setIsProcessing(true)
        setProgress(0)
        
        try {
            const video = videoRef.current
            const canvas = canvasRef.current
            const ctx = canvas.getContext('2d')
            
            if (!ctx) return
            
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            
            const filters = []
            if (settings.brightness !== 100) filters.push(`brightness(${settings.brightness}%)`)
            if (settings.contrast !== 100) filters.push(`contrast(${settings.contrast}%)`)
            if (settings.saturation !== 100) filters.push(`saturate(${settings.saturation}%)`)
            if (settings.hue !== 0) filters.push(`hue-rotate(${settings.hue}deg)`)
            if (settings.blur > 0) filters.push(`blur(${settings.blur}px)`)
            if (settings.grayscale > 0) filters.push(`grayscale(${settings.grayscale}%)`)
            if (settings.sepia > 0) filters.push(`sepia(${settings.sepia}%)`)
            
            ctx.filter = filters.join(' ')
            
            // Create processed video using MediaRecorder
            const stream = canvas.captureStream(30) // 30 FPS
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm',
                videoBitsPerSecond: 2500000
            })
            
            const chunks: Blob[] = []
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data)
                }
            }
            
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `disguised_${videoFile.name}`
                a.click()
                URL.revokeObjectURL(url)
                setIsProcessing(false)
                setProgress(100)
            }
            
            // Reset video to start and record
            const originalTime = video.currentTime
            video.currentTime = 0
            
            video.onseeked = () => {
                mediaRecorder.start()
                
                const updateFrame = () => {
                    if (video.currentTime < video.duration) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                        setProgress((video.currentTime / video.duration) * 100)
                        requestAnimationFrame(updateFrame)
                    } else {
                        mediaRecorder.stop()
                        video.currentTime = originalTime
                    }
                }
                
                updateFrame()
            }
        } catch (error) {
            console.error('Error processing video:', error)
            setIsProcessing(false)
        }
    }, [videoFile, settings])

    const handleSettingChange = useCallback((key: keyof VideoSettings, value: number) => {
        setSettings(prev => ({ ...prev, [key]: value }))
    }, [])

    const formatTime = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }, [])

    return (
        <div className="flex h-full flex-col bg-[var(--app-bg)]">
            {/* Header */}
            <div className="bg-[var(--app-bg)] border-b border-[var(--app-divider)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 px-3 py-1.5">
                    {!isTelegramApp() && (
                        <button
                            type="button"
                            onClick={goBack}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        >
                            <BackIcon />
                        </button>
                    )}
                    <div className="flex-1 font-medium text-sm">视频伪饰器</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto w-full max-w-content p-3 space-y-4">
                    {/* File Input */}
                    <div className="bg-[var(--app-secondary-bg)] rounded-lg p-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all"
                        >
                            选择视频文件
                        </button>
                        {videoFile && (
                            <p className="mt-2 text-sm text-[var(--app-hint)] truncate">
                                已选择: {videoFile.name}
                            </p>
                        )}
                    </div>

                    {videoUrl && (
                        <>
                            {/* Video Preview */}
                            <div className="bg-[var(--app-secondary-bg)] rounded-lg p-4">
                                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                                    <video
                                        ref={videoRef}
                                        src={videoUrl}
                                        className="w-full h-full object-contain"
                                        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                                        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                                        onPlay={() => setIsPlaying(true)}
                                        onPause={() => setIsPlaying(false)}
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        className="hidden"
                                    />
                                </div>
                                
                                {/* Video Controls */}
                                <div className="mt-4 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handlePlayPause}
                                            className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--app-bg)] text-[var(--app-fg)] hover:bg-[var(--app-hover-bg)] transition-colors"
                                        >
                                            {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                                        </button>
                                        
                                        <div className="flex-1">
                                            <div className="text-xs text-[var(--app-hint)] mb-1">
                                                {formatTime(currentTime)} / {formatTime(duration)}
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max={duration}
                                                value={currentTime}
                                                onChange={(e) => {
                                                    if (videoRef.current) {
                                                        videoRef.current.currentTime = Number(e.target.value)
                                                    }
                                                }}
                                                className="w-full h-1 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer slider"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Adjustment Controls */}
                            <div className="bg-[var(--app-secondary-bg)] rounded-lg p-4">
                                <h3 className="text-sm font-medium text-[var(--app-fg)] mb-4">视频参数调节</h3>
                                
                                <div className="space-y-4">
                                    {/* Brightness */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>亮度</span>
                                            <span className="text-[var(--app-hint)]">{settings.brightness}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            value={settings.brightness}
                                            onChange={(e) => handleSettingChange('brightness', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Contrast */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>对比度</span>
                                            <span className="text-[var(--app-hint)]">{settings.contrast}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            value={settings.contrast}
                                            onChange={(e) => handleSettingChange('contrast', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Saturation */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>饱和度</span>
                                            <span className="text-[var(--app-hint)]">{settings.saturation}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            value={settings.saturation}
                                            onChange={(e) => handleSettingChange('saturation', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Hue */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>色相</span>
                                            <span className="text-[var(--app-hint)]">{settings.hue}°</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="360"
                                            value={settings.hue}
                                            onChange={(e) => handleSettingChange('hue', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Blur */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>模糊</span>
                                            <span className="text-[var(--app-hint)]">{settings.blur}px</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="10"
                                            value={settings.blur}
                                            onChange={(e) => handleSettingChange('blur', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Grayscale */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>灰度</span>
                                            <span className="text-[var(--app-hint)]">{settings.grayscale}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={settings.grayscale}
                                            onChange={(e) => handleSettingChange('grayscale', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* Sepia */}
                                    <div>
                                        <label className="flex items-center justify-between text-sm text-[var(--app-fg)] mb-2">
                                            <span>怀旧</span>
                                            <span className="text-[var(--app-hint)]">{settings.sepia}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={settings.sepia}
                                            onChange={(e) => handleSettingChange('sepia', Number(e.target.value))}
                                            className="w-full h-2 bg-[var(--app-divider)] rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-3 mt-6">
                                    <button
                                        onClick={handleReset}
                                        className="flex-1 py-2 px-4 bg-[var(--app-bg)] text-[var(--app-fg)] rounded-lg font-medium hover:bg-[var(--app-hover-bg)] transition-colors"
                                    >
                                        重置
                                    </button>
                                    <button
                                        onClick={handleDownload}
                                        disabled={isProcessing}
                                        className="flex-1 py-2 px-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-medium hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {isProcessing ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                <span>处理中... {Math.round(progress)}%</span>
                                            </>
                                        ) : (
                                            <>
                                                <DownloadIcon className="w-4 h-4" />
                                                <span>下载视频</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}