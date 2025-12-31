import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { SpeechToTextStreamRequest } from '@/types/api'

type SpeechToTextStatus = 'idle' | 'recording' | 'stopping' | 'error'

type SpeechToTextOptions = {
    api: ApiClient
    onPartial: (text: string) => void
    onFinal: (text: string) => void
    onError?: (message: string) => void
}

type QueueItem = {
    action: SpeechToTextStreamRequest['action']
    sequenceId: number
    speech: string
    streamId: string
}

const TARGET_SAMPLE_RATE = 16000
const CHUNK_DURATION_MS = 150
const CHUNK_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * (CHUNK_DURATION_MS / 1000))
const FINAL_SILENCE_SAMPLES = CHUNK_SAMPLES
const PROCESSOR_BUFFER_SIZE = 4096
const MIN_SEND_INTERVAL_MS = 150
const SILENCE_RMS_THRESHOLD = 0.003
const SILENCE_SKIP_LIMIT = 4
const INPUT_GAIN = 4
const VOLUME_DB_FLOOR = 60
const VOLUME_DB_EPSILON = 0.0001
const VOLUME_SMOOTHING = 0.7

function getAudioContextCtor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null
    const anyWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext }
    return window.AudioContext ?? anyWindow.webkitAudioContext ?? null
}

function resampleToTarget(input: Float32Array, sourceRate: number): Float32Array {
    if (sourceRate === TARGET_SAMPLE_RATE) return input
    const ratio = sourceRate / TARGET_SAMPLE_RATE
    const newLength = Math.max(1, Math.round(input.length / ratio))
    const output = new Float32Array(newLength)
    for (let i = 0; i < newLength; i += 1) {
        const position = i * ratio
        const index = Math.floor(position)
        const nextIndex = Math.min(index + 1, input.length - 1)
        const weight = position - index
        output[i] = input[index] + (input[nextIndex] - input[index]) * weight
    }
    return output
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i += 1) {
        const boosted = (input[i] ?? 0) * INPUT_GAIN
        const sample = Math.max(-1, Math.min(1, boosted))
        output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return output
}

function pcmToBase64(input: Int16Array): string {
    const bytes = new Uint8Array(input.buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const slice = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode(...slice)
    }
    return btoa(binary)
}

function createSilence(samples: number): Int16Array {
    return new Int16Array(Math.max(1, samples))
}

function getStreamId(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_'
    const length = 16
    if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
        const bytes = new Uint8Array(length)
        crypto.getRandomValues(bytes)
        let result = ''
        for (let i = 0; i < length; i += 1) {
            result += alphabet[bytes[i] % alphabet.length]
        }
        return result
    }
    let result = ''
    for (let i = 0; i < length; i += 1) {
        const idx = Math.floor(Math.random() * alphabet.length)
        result += alphabet[idx]
    }
    return result
}

export function useSpeechToText(options: SpeechToTextOptions) {
    const [status, setStatus] = useState<SpeechToTextStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const [volume, setVolume] = useState(0)

    const apiRef = useRef(options.api)
    const onPartialRef = useRef(options.onPartial)
    const onFinalRef = useRef(options.onFinal)
    const onErrorRef = useRef(options.onError)

const audioContextRef = useRef<AudioContext | null>(null)
const mediaStreamRef = useRef<MediaStream | null>(null)
const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
const processorRef = useRef<ScriptProcessorNode | null>(null)
const gainRef = useRef<GainNode | null>(null)
const preparedRef = useRef(false)
const capturingRef = useRef(false)
const volumeRef = useRef(0)

const sampleBufferRef = useRef<number[]>([])
    const queueRef = useRef<QueueItem[]>([])
    const sendingRef = useRef(false)
    const stoppingRef = useRef(false)
    const startAttemptRef = useRef(0)
    const lastSendAtRef = useRef(0)
    const qpsBackoffRef = useRef(0)
    const silentChunksRef = useRef(0)
    const streamIdRef = useRef('')
    const sequenceIdRef = useRef(0)

    useEffect(() => {
        apiRef.current = options.api
    }, [options.api])

    useEffect(() => {
        onPartialRef.current = options.onPartial
    }, [options.onPartial])

    useEffect(() => {
        onFinalRef.current = options.onFinal
    }, [options.onFinal])

    useEffect(() => {
        onErrorRef.current = options.onError
    }, [options.onError])

    const cleanupAudio = useCallback(() => {
        processorRef.current?.disconnect()
        sourceRef.current?.disconnect()
        gainRef.current?.disconnect()

        processorRef.current = null
        sourceRef.current = null
        gainRef.current = null

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop())
        }
        mediaStreamRef.current = null

        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => {})
        }
        audioContextRef.current = null
    }, [])

    const resetStreamState = useCallback(() => {
        sampleBufferRef.current = []
        queueRef.current = []
        sendingRef.current = false
        stoppingRef.current = false
        capturingRef.current = false
        streamIdRef.current = ''
        sequenceIdRef.current = 0
        volumeRef.current = 0
        setVolume(0)
    }, [])

    const handleError = useCallback((message: string) => {
        setError(message)
        setStatus('error')
        cleanupAudio()
        preparedRef.current = false
        resetStreamState()
        onErrorRef.current?.(message)
    }, [cleanupAudio, resetStreamState])

    const processQueue = useCallback(async () => {
        console.log('[stt] processQueue start', {
            queueSize: queueRef.current.length,
            sending: sendingRef.current,
            streamId: streamIdRef.current,
            seq: sequenceIdRef.current,
            status,
            stopping: stoppingRef.current,
            capturing: capturingRef.current
        })
        if (sendingRef.current) return
        sendingRef.current = true
        while (queueRef.current.length > 0) {
            const item = queueRef.current.shift()
            if (!item) break
            try {
                const now = Date.now()
                const waitMs = Math.max(0, lastSendAtRef.current + MIN_SEND_INTERVAL_MS - now)
                if (waitMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, waitMs))
                }

                console.log('[stt] send', {
                    action: item.action,
                    sequenceId: item.sequenceId,
                    streamId: item.streamId,
                    speechSize: item.speech.length
                })
                const response = await apiRef.current.streamSpeechToText({
                    streamId: item.streamId,
                    sequenceId: item.sequenceId,
                    action: item.action,
                    speech: item.speech,
                    format: 'pcm',
                    engineType: '16k_auto'
                })
                console.log('[stt] response', response)
                console.log('[stt] response.data', response.data)
                if (response.error === 'rate_limited' || response.retryAfter) {
                    const waitSeconds = response.retryAfter ?? 1
                    const waitMs = Math.max(200, waitSeconds * 1000)
                    console.log('[stt] rate limited, wait', { waitSeconds })
                    queueRef.current.unshift(item)
                    await new Promise(resolve => setTimeout(resolve, waitMs))
                    continue
                }

                if (response.error) {
                    throw new Error(response.error)
                }
                if (response.code && response.code !== 0) {
                    throw new Error(response.msg || `Feishu error ${response.code}`)
                }

                lastSendAtRef.current = Date.now()
                qpsBackoffRef.current = 0

                const text = response.data?.recognition_text
                if (text && text.trim().length > 0) {
                    if (item.action === 'stop' || item.action === 'cancel') {
                        onFinalRef.current(text)
                    } else {
                        onPartialRef.current(text)
                    }
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Speech-to-text failed'
                if (message.includes('qps exceeded') || message.includes('"code":10024') || message.includes('10024')) {
                    const backoff = qpsBackoffRef.current > 0 ? Math.min(qpsBackoffRef.current * 2, 2000) : 800
                    qpsBackoffRef.current = backoff
                    console.log('[stt] qps backoff', { backoff })
                    queueRef.current.unshift(item)
                    await new Promise(resolve => setTimeout(resolve, backoff))
                    continue
                }
                handleError(message)
                break
            }
        }

        sendingRef.current = false
        console.log('[stt] processQueue done', {
            queueSize: queueRef.current.length,
            status,
            stopping: stoppingRef.current,
            capturing: capturingRef.current
        })
        if (stoppingRef.current && queueRef.current.length === 0) {
            stoppingRef.current = false
            setStatus('idle')
        }
    }, [handleError])

    const enqueueChunk = useCallback((audio: Int16Array, action: QueueItem['action']) => {
        if (!streamIdRef.current) {
            streamIdRef.current = getStreamId()
        }
        const speech = pcmToBase64(audio)
        queueRef.current.push({
            action,
            sequenceId: sequenceIdRef.current,
            speech,
            streamId: streamIdRef.current
        })
        console.log('[stt] enqueue', {
            action,
            sequenceId: sequenceIdRef.current,
            streamId: streamIdRef.current,
            pcmSamples: audio.length
        })
        sequenceIdRef.current += 1
        processQueue().catch(() => {})
    }, [processQueue])

    const flushFinalChunks = useCallback(() => {
        const remaining = sampleBufferRef.current.splice(0)
        const remainingSamples = remaining.length > 0 ? new Int16Array(remaining) : null

        if (sequenceIdRef.current === 0) {
            enqueueChunk(remainingSamples ?? createSilence(CHUNK_SAMPLES), 'start')
            enqueueChunk(createSilence(FINAL_SILENCE_SAMPLES), 'stop')
            return
        }

        enqueueChunk(remainingSamples ?? createSilence(FINAL_SILENCE_SAMPLES), 'stop')
    }, [enqueueChunk])

    const prepare = useCallback(async (): Promise<boolean> => {
        console.log('[stt] prepare start', {
            prepared: preparedRef.current,
            hasStream: Boolean(mediaStreamRef.current),
            status
        })
        if (preparedRef.current && mediaStreamRef.current && audioContextRef.current) {
            return true
        }

        if (!navigator?.mediaDevices?.getUserMedia) {
            handleError('Microphone access is not supported')
            return false
        }

        const audioContextCtor = getAudioContextCtor()
        if (!audioContextCtor) {
            handleError('AudioContext not supported')
            return false
        }

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const audioContext = new audioContextCtor()
            const source = audioContext.createMediaStreamSource(mediaStream)
            const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
            const gain = audioContext.createGain()
            gain.gain.value = 0

            processor.onaudioprocess = (event: AudioProcessingEvent) => {
                if (!capturingRef.current || stoppingRef.current) return
                const input = event.inputBuffer.getChannelData(0)
                const resampled = resampleToTarget(input, audioContext.sampleRate)
                const int16 = floatTo16BitPCM(resampled)
                const buffer = sampleBufferRef.current
                for (let i = 0; i < int16.length; i += 1) {
                    buffer.push(int16[i] ?? 0)
                }
                while (buffer.length >= CHUNK_SAMPLES) {
                    const chunkSamples = buffer.splice(0, CHUNK_SAMPLES)
                    const chunk = new Int16Array(chunkSamples)
                    let sum = 0
                    for (let i = 0; i < chunk.length; i += 1) {
                        const sample = chunk[i] / 32768
                        sum += sample * sample
                    }
                    const rms = Math.sqrt(sum / chunk.length)
                    const db = 20 * Math.log10(Math.max(VOLUME_DB_EPSILON, rms))
                    const normalized = Math.min(1, Math.max(0, (db + VOLUME_DB_FLOOR) / VOLUME_DB_FLOOR))
                    const smoothed = volumeRef.current * VOLUME_SMOOTHING + normalized * (1 - VOLUME_SMOOTHING)
                    volumeRef.current = smoothed
                    setVolume(smoothed)
                    const isSilent = rms < SILENCE_RMS_THRESHOLD
                    console.log('[stt] chunk rms', { rms, isSilent, seq: sequenceIdRef.current })
                    if (isSilent && sequenceIdRef.current !== 0) {
                        silentChunksRef.current += 1
                        if (silentChunksRef.current <= SILENCE_SKIP_LIMIT) {
                            continue
                        }
                        silentChunksRef.current = 0
                    } else {
                        silentChunksRef.current = 0
                    }
                    const action = sequenceIdRef.current === 0 ? 'start' : 'continue'
                    enqueueChunk(chunk, action)
                }
            }

            source.connect(processor)
            processor.connect(gain)
            gain.connect(audioContext.destination)

            if (audioContext.state === 'suspended') {
                await audioContext.resume()
            }

            mediaStreamRef.current = mediaStream
            audioContextRef.current = audioContext
            sourceRef.current = source
            processorRef.current = processor
            gainRef.current = gain
            preparedRef.current = true
            console.log('[stt] prepare done', {
                sampleRate: audioContext.sampleRate,
                prepared: preparedRef.current
            })
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Microphone access denied'
            handleError(message)
            return false
        }
    }, [enqueueChunk, handleError])

    const start = useCallback(async () => {
        if (status === 'recording' || status === 'stopping') return
        setError(null)
        const attempt = startAttemptRef.current + 1
        startAttemptRef.current = attempt
        const ok = await prepare()
        if (!ok || attempt !== startAttemptRef.current) return
        resetStreamState()
        streamIdRef.current = getStreamId()
        capturingRef.current = true
        volumeRef.current = 0
        setVolume(0)
        setStatus('recording')
        console.log('[stt] start', {
            streamId: streamIdRef.current
        })
    }, [prepare, resetStreamState, status])

    const stop = useCallback(() => {
        if (status !== 'recording') return
        setStatus('stopping')
        stoppingRef.current = true
        capturingRef.current = false
        startAttemptRef.current += 1
        silentChunksRef.current = 0
        volumeRef.current = 0
        setVolume(0)
        flushFinalChunks()
        console.log('[stt] stop', {
            streamId: streamIdRef.current
        })

        // Timeout to recover from stuck stopping state (e.g., network failure)
        setTimeout(() => {
            if (stoppingRef.current) {
                console.log('[stt] stopping timeout, forcing idle')
                stoppingRef.current = false
                setStatus('idle')
            }
        }, 5000)
    }, [flushFinalChunks, status])

    const toggle = useCallback(async () => {
        if (status === 'recording') {
            stop()
        } else {
            await start()
        }
    }, [start, status, stop])

    const teardown = useCallback(() => {
        if (status === 'recording') {
            stop()
        }
        cleanupAudio()
        preparedRef.current = false
        resetStreamState()
        setStatus('idle')
        console.log('[stt] teardown')
    }, [cleanupAudio, resetStreamState, status, stop])

    useEffect(() => {
        return () => {
            capturingRef.current = false
            stoppingRef.current = false
            cleanupAudio()
            preparedRef.current = false
            resetStreamState()
            setStatus('idle')
            console.log('[stt] unmount cleanup')
        }
    }, [cleanupAudio, resetStreamState])

    const isSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

    return {
        status,
        error,
        isSupported,
        volume,
        prepare,
        teardown,
        start,
        stop,
        toggle
    }
}
