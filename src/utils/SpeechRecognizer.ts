import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Logger } from './Logger';

type ListeningStatus = 'started' | 'stopped';

interface StartListeningOptions {
    onPartialResult?: (text: string) => void;
    onListeningStateChange?: (status: ListeningStatus) => void;
    onVolumeChange?: (volume: number) => void;
}

const STOP_FLUSH_DELAY_MS = 200;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return JSON.stringify(error);
}

export class SpeechRecognizer {
    private readonly lang: string;
    private latestMatch: string | null = null;
    private partialResultsHandle: PluginListenerHandle | null = null;
    private listeningStateHandle: PluginListenerHandle | null = null;
    private volumeHandle: PluginListenerHandle | null = null;
    private onPartialResult?: (text: string) => void;
    private onListeningStateChange?: (status: ListeningStatus) => void;
    private onVolumeChange?: (volume: number) => void;

    private engineStartedResolve: (() => void) | null = null;
    private engineStartedPromise: Promise<void> | null = null;
    private pendingStop: boolean = false;

    // Web-specific properties
    private webRecognizer: any = null;
    private webAudioContext: AudioContext | null = null;
    private webAudioStream: MediaStream | null = null;
    private webVolumeAnimFrame: number | null = null;

    constructor(lang: string) {
        this.lang = lang;
    }

    static async requestPermissions(): Promise<boolean> {
        if (Capacitor.getPlatform() === 'web') {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
                return true;
            } catch (e) {
                return false;
            }
        }
        try {
            const status = await SpeechRecognition.requestPermissions();
            return status.speechRecognition === 'granted';
        } catch (e) {
            console.error('Permission request failed:', e);
            return false;
        }
    }

    async startListening(options: StartListeningOptions = {}): Promise<void> {
        await Logger.log(`Starting speech recognition session for language: ${this.lang}`);

        this.latestMatch = null;
        this.pendingStop = false;
        this.onPartialResult = options.onPartialResult;
        this.onListeningStateChange = options.onListeningStateChange;
        this.onVolumeChange = options.onVolumeChange;

        if (Capacitor.getPlatform() === 'web') {
            return this.startWebListening();
        } else {
            return this.startNativeListening();
        }
    }

    private async startNativeListening(): Promise<void> {
        const availability = await SpeechRecognition.available();
        if (!availability.available) {
            throw new Error('Speech recognition not available on this device');
        }

        const permission = await SpeechRecognition.checkPermissions();
        if (permission.speechRecognition !== 'granted') {
            const requested = await SpeechRecognition.requestPermissions();
            if (requested.speechRecognition !== 'granted') {
                throw new Error('Microphone permission denied');
            }
        }

        await this.dispose();

        this.engineStartedPromise = new Promise<void>((resolve) => {
            this.engineStartedResolve = resolve;
        });

        this.partialResultsHandle = await SpeechRecognition.addListener('partialResults', (data) => {
            const nextMatch = data.matches?.[0]?.trim();
            if (nextMatch && nextMatch !== this.latestMatch) {
                this.latestMatch = nextMatch;
                void Logger.log(`Speech partial result: "${nextMatch}"`);
                this.onPartialResult?.(nextMatch);
            }
        });

        this.volumeHandle = await (SpeechRecognition as any).addListener('volume', (data: { value: number }) => {
            this.onVolumeChange?.(data.value);
        });

        this.listeningStateHandle = await SpeechRecognition.addListener('listeningState', (data) => {
            void Logger.log(`Speech listening state changed: ${data.status}`);

            if (data.status === 'started') {
                // Resolve the engine-started promise (fires on onReadyForSpeech AND
                // onBeginningOfSpeech — whichever comes first unblocks startNativeListening).
                if (this.engineStartedResolve) {
                    this.engineStartedResolve();
                    this.engineStartedResolve = null;
                }
                if (this.pendingStop) {
                    this.pendingStop = false;
                    void SpeechRecognition.stop();
                }
            } else if (data.status === 'stopped') {
                // If stopped fires before started (e.g. recogniser error before mic opens),
                // resolve the promise to unblock startNativeListening and prevent a hang.
                if (this.engineStartedResolve) {
                    this.engineStartedResolve();
                    this.engineStartedResolve = null;
                }
            }

            this.onListeningStateChange?.(data.status);
        });

        try {
            await SpeechRecognition.start({
                language: this.lang,
                maxResults: 1,
                partialResults: true,
                popup: false,
            });
            // Wait until the recogniser signals it is ready (onReadyForSpeech) or
            // signals an early stop (onError before ready).
            await this.engineStartedPromise;
        } catch (err: unknown) {
            if (this.engineStartedResolve) {
                this.engineStartedResolve();
                this.engineStartedResolve = null;
            }
            await this.dispose();
            throw err;
        }
    }

    private async startWebListening(): Promise<void> {
        const SpeechRecognitionCtor =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
            // WeChat's embedded browser and many Chinese OEM browsers do not expose
            // the Web Speech API.  Give the user a clear, bilingual instruction.
            throw new Error(
                'Please open this page in Safari or Chrome.\n请在 Safari 或 Chrome 中打开此页面。'
            );
        }

        this.webRecognizer = new SpeechRecognitionCtor();
        this.webRecognizer.lang = this.lang;
        this.webRecognizer.interimResults = true;
        this.webRecognizer.continuous = true;
        this.webRecognizer.maxAlternatives = 1;

        this.webRecognizer.onstart = () => {
            void Logger.log('Web Speech started');
            this.onListeningStateChange?.('started');
            if (this.pendingStop) {
                this.webRecognizer?.stop();
            }
        };

        this.webRecognizer.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript.trim();
                if (!transcript) continue;
                if (event.results[i].isFinal) {
                    this.latestMatch = transcript;
                } else {
                    this.latestMatch = transcript;
                    this.onPartialResult?.(transcript);
                }
            }
        };

        this.webRecognizer.onend = () => {
            void Logger.log('Web Speech ended');
            this.onListeningStateChange?.('stopped');
            this.stopWebVolumeMetering();
        };

        this.webRecognizer.onerror = (event: any) => {
            void Logger.log(`Web Speech error: ${event.error}`);
            // 'network' in Chrome means Google's speech servers are unreachable
            // (typical behind the Great Firewall).  Tell the user to switch to Safari.
            if (event.error === 'network') {
                this.onListeningStateChange?.('stopped');
                this.webRecognizer?.abort();
            }
        };

        await this.startWebVolumeMetering();

        return new Promise<void>((resolve, reject) => {
            const origStart = this.webRecognizer.onstart;
            this.webRecognizer.onstart = () => {
                origStart?.();
                resolve();
            };
            const origError = this.webRecognizer.onerror;
            this.webRecognizer.onerror = (event: any) => {
                origError?.(event);
                // Reject only for fatal errors before start
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    reject(new Error(`Microphone access denied: ${event.error}`));
                }
            };
            try {
                this.webRecognizer.start();
            } catch (e) {
                reject(e);
            }
        });
    }

    private async startWebVolumeMetering(): Promise<void> {
        try {
            this.webAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextCtor();
            const source = audioContext.createMediaStreamSource(this.webAudioStream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const tick = () => {
                if (!this.webAudioStream) return;
                analyser.getByteTimeDomainData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const val = (dataArray[i] - 128) / 128;
                    sum += val * val;
                }
                const rms = Math.sqrt(sum / bufferLength);
                this.onVolumeChange?.(rms);
                this.webVolumeAnimFrame = requestAnimationFrame(tick);
            };

            tick();
            this.webAudioContext = audioContext;
        } catch (e) {
            console.warn('Web volume metering unavailable:', e);
        }
    }

    private stopWebVolumeMetering(): void {
        if (this.webVolumeAnimFrame !== null) {
            cancelAnimationFrame(this.webVolumeAnimFrame);
            this.webVolumeAnimFrame = null;
        }
    }

    async stopListening(): Promise<string | null> {
        await Logger.log('Stopping speech recognition session...');

        if (Capacitor.getPlatform() === 'web') {
            if (this.webRecognizer) {
                this.webRecognizer.stop();
            }
            await this.delay(STOP_FLUSH_DELAY_MS);
        } else {
            if (this.engineStartedPromise) {
                this.pendingStop = true;
                await this.engineStartedPromise;
                await this.delay(50);
            }
            try {
                await SpeechRecognition.stop();
            } catch (e: unknown) {
                await Logger.log(`Failed to stop: ${getErrorMessage(e)}`);
            }
            await this.delay(STOP_FLUSH_DELAY_MS);
        }

        const result = this.latestMatch;
        await this.dispose();
        return result;
    }

    async cancelListening(): Promise<void> {
        this.pendingStop = false;
        if (this.engineStartedResolve) {
            this.engineStartedResolve();
            this.engineStartedResolve = null;
        }
        if (Capacitor.getPlatform() === 'web') {
            this.webRecognizer?.abort();
        } else {
            try {
                await SpeechRecognition.stop();
            } catch (_) { /* ignore */ }
        }
        await this.dispose();
    }

    async isListening(): Promise<boolean> {
        if (Capacitor.getPlatform() === 'web') {
            return !!this.webRecognizer;
        }
        try {
            const { listening } = await SpeechRecognition.isListening();
            return listening;
        } catch {
            return false;
        }
    }

    async dispose(): Promise<void> {
        this.engineStartedResolve = null;
        this.engineStartedPromise = null;
        this.pendingStop = false;

        // Clean up native listeners
        if (this.partialResultsHandle) {
            await this.partialResultsHandle.remove();
            this.partialResultsHandle = null;
        }
        if (this.listeningStateHandle) {
            await this.listeningStateHandle.remove();
            this.listeningStateHandle = null;
        }
        if (this.volumeHandle) {
            await this.volumeHandle.remove();
            this.volumeHandle = null;
        }

        // Clean up web
        this.stopWebVolumeMetering();
        if (this.webRecognizer) {
            this.webRecognizer.onstart = null;
            this.webRecognizer.onresult = null;
            this.webRecognizer.onend = null;
            this.webRecognizer.onerror = null;
            this.webRecognizer = null;
        }
        if (this.webAudioContext) {
            void this.webAudioContext.close();
            this.webAudioContext = null;
        }
        if (this.webAudioStream) {
            this.webAudioStream.getTracks().forEach(t => t.stop());
            this.webAudioStream = null;
        }

        this.onPartialResult = undefined;
        this.onListeningStateChange = undefined;
        this.onVolumeChange = undefined;
    }

    getLatestMatch(): string | null {
        return this.latestMatch;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
}
