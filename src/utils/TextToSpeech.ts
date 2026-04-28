import { TextToSpeech as NativeTTS } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';
import { Logger } from './Logger';

// ---------------------------------------------------------------------------
// Voice quality ranking for Web Speech Synthesis.
// ---------------------------------------------------------------------------

/**
 * Score a voice for a given language — higher is better.
 *
 * Priority order:
 *   Premium (iOS neural) > Enhanced (iOS/macOS download) > known-good named
 *   voice > local/offline > generic > compact (lowest quality on iOS)
 *
 * We intentionally weight quality tier above localService so that a
 * non-local "Enhanced" voice beats a local "Compact" one.
 */
function voiceScore(voice: SpeechSynthesisVoice, lang: string): number {
    const vl   = voice.lang.toLowerCase();
    const tl   = lang.toLowerCase();
    const base = tl.split('-')[0];
    const name = voice.name.toLowerCase();

    // Must match language — exact locale beats base-language match
    let score = 0;
    if (vl === tl)                score += 1000;
    else if (vl.startsWith(base)) score += 500;
    else                          return -1; // wrong language

    // Quality tier — most impactful factor
    if      (name.includes('premium'))  score += 400;
    else if (name.includes('enhanced')) score += 300;

    // Named voices known to be high-quality on their respective platform
    const topDE  = ['katja', 'yannick', 'karsten'];           // Microsoft Katja / iOS Yannick
    const goodDE = ['anna', 'markus', 'petra', 'thomas',
                    'hedda', 'stefan', 'marie', 'konrad',
                    'helene', 'luca'];
    const topZH  = ['tian-tian', 'li-mu', 'mei-jia'];
    const goodZH = ['sinji', 'sin-ji', 'tingting', 'minglee'];

    if (base === 'de') {
        if      (topDE.some(n  => name.includes(n)))  score += 200;
        else if (goodDE.some(n => name.includes(n)))  score += 100;
    } else if (base === 'zh') {
        if      (topZH.some(n  => name.includes(n)))  score += 200;
        else if (goodZH.some(n => name.includes(n)))  score += 100;
    }

    // Prefer local/offline voices — they don't need Google/Apple server access
    if (voice.localService) score += 50;

    // Compact voices are the lowest quality tier on iOS
    if (name.includes('compact')) score -= 100;

    return score;
}

/** Return the best available voice for `lang`, or null if none match. */
function pickBestVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = -1;
    for (const v of voices) {
        const s = voiceScore(v, lang);
        if (s > bestScore) { bestScore = s; best = v; }
    }
    return best;
}

/**
 * Wait until the voice list is populated, then return the best voice.
 * On first load some browsers populate the list asynchronously.
 */
function waitForVoice(lang: string): Promise<SpeechSynthesisVoice | null> {
    return new Promise((resolve) => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            resolve(pickBestVoice(lang));
            return;
        }
        const onChanged = () => {
            window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
            resolve(pickBestVoice(lang));
        };
        window.speechSynthesis.addEventListener('voiceschanged', onChanged);
        // Safety: resolve after 1 s even if event never fires
        window.setTimeout(() => {
            window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
            resolve(pickBestVoice(lang));
        }, 1000);
    });
}

/**
 * Speak a single utterance and return a Promise that resolves when done.
 */
function speakUtterance(
    text: string,
    lang: string,
    voice: SpeechSynthesisVoice | null,
    rate: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const u  = new SpeechSynthesisUtterance(text);
        u.lang   = lang;
        u.rate   = rate;
        u.pitch  = 1.0;
        u.volume = 1.0;
        if (voice) u.voice = voice;

        u.onend = () => resolve();
        u.onerror = (e) => {
            if (e.error === 'interrupted' || e.error === 'canceled') {
                resolve(); // not real errors
            } else {
                reject(new Error(`TTS: ${e.error}`));
            }
        };

        window.speechSynthesis.speak(u);
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    });
}

/**
 * Split text into sentences for more natural pacing.
 *
 * Splits at sentence-ending punctuation (. ! ?) only when followed by a
 * space + uppercase letter — this avoids splitting on abbreviations like
 * "Dr. Müller" or "ca. 5 km".
 */
function splitSentences(text: string): string[] {
    const results: string[] = [];
    // Regex: punctuation cluster, then whitespace, then uppercase start
    const re = /([.!?]+)\s+(?=[A-ZÄÖÜ\u4e00-\u9fff])/g;
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
        const sentence = text.slice(last, m.index + m[1].length).trim();
        if (sentence) results.push(sentence);
        last = m.index + m[0].length;
    }
    const tail = text.slice(last).trim();
    if (tail) results.push(tail);

    return results.length > 0 ? results : [text];
}

// ---------------------------------------------------------------------------

export class TextToSpeech {
    /**
     * Unlock the Web Speech Synthesis API for programmatic use on iOS Safari.
     *
     * iOS requires speechSynthesis.speak() to be called synchronously inside a
     * user-gesture handler at least once before it will allow async / timer-driven
     * calls to produce audio.  Call this at the top of every mic-button onClick,
     * before any awaits, to prime the audio context for the session.
     *
     * On non-iOS browsers and on native this is a no-op.
     */
    static unlock(): void {
        if (Capacitor.getPlatform() !== 'web') return;
        if (!('speechSynthesis' in window)) return;
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }

    static async preWarm(): Promise<void> {
        if (Capacitor.getPlatform() === 'web') {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.getVoices();
                window.setTimeout(() => window.speechSynthesis.getVoices(), 500);
            }
            return;
        }
        try {
            await NativeTTS.getSupportedLanguages();
            await Logger.log('TTS Engine pre-warmed');
        } catch (e) {
            console.warn('TTS pre-warm failed:', e);
        }
    }

    static async speak(text: string, lang: string): Promise<void> {
        if (Capacitor.getPlatform() === 'web') {
            return TextToSpeech.speakWeb(text, lang);
        }
        await Logger.log(`Attempting to speak: "${text}" in ${lang}`);
        try { await NativeTTS.stop(); } catch (_) { /* ignore */ }

        const params = { text, lang, rate: 0.9, pitch: 1.0, volume: 1.0, category: 'playback' };
        try {
            await NativeTTS.speak(params);
            await Logger.log('TTS speak succeeded');
        } catch (e: any) {
            const base = lang.split('-')[0];
            if (base !== lang) {
                await Logger.log(`TTS rejected "${lang}", retrying with base locale "${base}"`);
                try {
                    await NativeTTS.speak({ ...params, lang: base });
                    await Logger.log('TTS speak succeeded with base locale');
                    return;
                } catch (e2) {
                    await Logger.log(`TTS base-locale retry also failed: ${JSON.stringify(e2)}`);
                }
            }
            await Logger.log(`Native TTS speak failed: ${JSON.stringify(e)}`);
            // Not fatal — translation is still visible on screen
        }
    }

    static stop(): void {
        if (Capacitor.getPlatform() === 'web') {
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            return;
        }
        NativeTTS.stop().catch(() => { /* ignore */ });
    }

    // -------------------------------------------------------------------------
    // Web / PWA — uses the standard Web Speech Synthesis API.
    // All voices used here are on-device; no network required → works in China.
    // -------------------------------------------------------------------------
    private static async speakWeb(text: string, lang: string): Promise<void> {
        if (!('speechSynthesis' in window)) {
            void Logger.log('Web Speech Synthesis not supported');
            return; // fail silently — translation still shows on screen
        }

        window.speechSynthesis.cancel();

        // Resolve the best voice once (async on first call)
        const voice = await waitForVoice(lang);
        void Logger.log(`Web TTS voice: ${voice?.name ?? 'browser default'} (${voice?.lang ?? lang})`);

        const base = lang.split('-')[0];
        // German: 0.88 — slightly below default for clarity without sounding robotic.
        // Chinese: 0.9  — natural pace for Mandarin.
        const rate = base === 'zh' ? 0.9 : 0.88;

        // Split into sentences and insert brief pauses between them.
        // This produces dramatically more natural-sounding output for multi-sentence
        // translations compared to feeding the whole text as one utterance.
        const sentences = splitSentences(text);
        void Logger.log(`Web TTS: ${sentences.length} sentence(s) for "${text.slice(0, 40)}…"`);

        for (let i = 0; i < sentences.length; i++) {
            try {
                await speakUtterance(sentences[i], lang, voice, rate);
            } catch (err) {
                void Logger.log(`Web TTS utterance error: ${err}`);
                break; // stop on hard error
            }
            // 320 ms pause between sentences — long enough to feel like a breath,
            // short enough not to feel like a glitch
            if (i < sentences.length - 1) {
                await new Promise<void>(r => window.setTimeout(r, 320));
            }
        }
    }
}
