import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Mic } from 'lucide-react';
import BottomButtons from './components/BottomButtons';
import TranslationOverlay from './components/TranslationOverlay';
import QuickPhrases from './components/QuickPhrases';
import SoundWave from './components/SoundWave';
import { SpeechRecognizer } from './utils/SpeechRecognizer';
import { TextToSpeech } from './utils/TextToSpeech';
import { translateText } from './utils/TranslationService';
import { Logger } from './utils/Logger';

type LanguageCode = 'de' | 'zh';

interface RecognitionSession {
  from: LanguageCode;
  to: LanguageCode;
  speechLang: string;
  targetLang: string;
}

interface Translation {
  original: string;
  translated: string;
  from: LanguageCode;
  to: LanguageCode;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return JSON.stringify(error);
}

function App() {
  const [translation, setTranslation] = useState<Translation | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [activeLang, setActiveLang] = useState<LanguageCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0);
  const [dialogueMode, setDialogueMode] = useState<boolean>(false);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const sessionRef = useRef<RecognitionSession | null>(null);
  const latestTranscriptRef = useRef<string | null>(null);
  const stopInFlightRef = useRef<boolean>(false);
  const unmountedRef = useRef<boolean>(false);
  const errorTimerRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    TextToSpeech.preWarm();
  }, []);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current);
      }
      const recognizer = recognizerRef.current;
      if (recognizer) {
        void recognizer.cancelListening();
      }
    };
  }, []);

  const clearErrorTimer = () => {
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const showError = (message: string) => {
    clearErrorTimer();
    setError(message);
    errorTimerRef.current = window.setTimeout(() => {
      if (!unmountedRef.current) {
        setError(null);
      }
      errorTimerRef.current = null;
    }, 4000);
  };

  const clearRecognitionSessionState = () => {
    recognizerRef.current = null;
    sessionRef.current = null;
    latestTranscriptRef.current = null;
    stopInFlightRef.current = false;
    clearSilenceTimer();
    setPendingTranscript(null);
    setIsListening(false);
    setActiveLang(null);
    setVolume(0);
  };

  const buildSession = (from: LanguageCode): RecognitionSession => {
    const to = from === 'de' ? 'zh' : 'de';
    return {
      from,
      to,
      speechLang: from === 'de' ? 'de-DE' : 'zh-CN',
      targetLang: to === 'de' ? 'de-DE' : 'zh-CN',
    };
  };

  const startRecognitionSession = async (from: LanguageCode) => {
    if (recognizerRef.current || isTranslating || stopInFlightRef.current) {
      await Logger.log('Ignoring start request because recognition is already active');
      return;
    }

    clearErrorTimer();
    setError(null);

    const session = buildSession(from);
    sessionStartTimeRef.current = Date.now();
    await Logger.log(
      `Starting recognition session: from=${session.from}, to=${session.to}, speechLang=${session.speechLang}`
    );

    const recognizer = new SpeechRecognizer(session.speechLang);
    recognizerRef.current = recognizer;
    sessionRef.current = session;
    latestTranscriptRef.current = null;
    setPendingTranscript(null);
    setActiveLang(session.from);
    setIsListening(true);
    setVolume(0);

    try {
      const resetSilenceTimer = () => {
        clearSilenceTimer();
        silenceTimerRef.current = window.setTimeout(() => {
          void Logger.log('Auto-stopping due to silence (unhold mode)');
          void stopRecognitionSession('natural');
        }, 2500);
      };

      await recognizer.startListening({
        onPartialResult: (text) => {
          if (text !== latestTranscriptRef.current) {
            latestTranscriptRef.current = text;
            setPendingTranscript(text);
            resetSilenceTimer();
          }
        },
        onVolumeChange: (vol) => {
          setVolume(vol);
        },
        onListeningStateChange: (status) => {
          if (status === 'started') {
            resetSilenceTimer();
          }
          if (status === 'stopped' && recognizerRef.current === recognizer && !stopInFlightRef.current) {
            void stopRecognitionSession('natural');
          }
        },
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      await Logger.log(`Failed to start recognition session: ${message}`);
      clearRecognitionSessionState();
      showError(message || 'Speech recognition failed.');
    }
  };

  const stopRecognitionSession = async (reason: 'user' | 'natural') => {
    if (stopInFlightRef.current) return;

    const recognizer = recognizerRef.current;
    const session = sessionRef.current;
    if (!recognizer || !session) return;

    stopInFlightRef.current = true;
    setIsListening(false);
    setActiveLang(null);
    setVolume(0);
    clearSilenceTimer();

    await Logger.log(`Stopping recognition session via ${reason}`);

    let spokenText = latestTranscriptRef.current?.trim() || null;

    try {
      spokenText = await recognizer.stopListening();

      recognizerRef.current = null;
      sessionRef.current = null;
      latestTranscriptRef.current = spokenText;
      setPendingTranscript(spokenText);

      if (!spokenText) {
        await Logger.log('Recognition ended without a transcript');
        const duration = Date.now() - (sessionStartTimeRef.current || 0);
        clearRecognitionSessionState();
        if (duration < 1200) {
          showError('Hold a bit longer to speak.');
        } else {
          showError('Speech not recognized.');
        }
        return;
      }

      await Logger.log(`Final transcript used for translation: "${spokenText}"`);

      setIsTranslating(true);
      const translated = await translateText(spokenText, session.from, session.to);
      await Logger.log(`Translated text: "${translated}"`);

      if (unmountedRef.current) return;

      setTranslation({
        original: spokenText,
        translated,
        from: session.from,
        to: session.to,
      });

      window.setTimeout(() => {
        void TextToSpeech.speak(translated, session.targetLang);
      }, 300);

      clearRecognitionSessionState();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      await Logger.log(`Recognition/translation error: ${message}`);
      clearRecognitionSessionState();
      showError(message || 'Speech not recognized.');
    } finally {
      if (!unmountedRef.current) {
        setIsTranslating(false);
      }
      stopInFlightRef.current = false;
    }
  };

  const handleQuickPhrase = async (phrase: { de: string, zh: string }) => {
    setTranslation({
      original: phrase.de,
      translated: phrase.zh,
      from: 'de',
      to: 'zh',
    });
    window.setTimeout(() => {
      void TextToSpeech.speak(phrase.zh, 'zh-CN');
    }, 300);
  };

  const isBusy = isTranslating || stopInFlightRef.current;

  // ─── Dialogue mode ────────────────────────────────────────────────────────

  if (dialogueMode) {
    const btnBase =
      'relative w-24 h-24 rounded-full flex flex-col items-center justify-center ' +
      'transition-all duration-500 transform active:scale-90 shrink-0';
    const btnActive =
      'bg-red-600 scale-110 shadow-[0_0_60px_rgba(220,38,38,0.5)] text-white';
    const btnIdle =
      'bg-zinc-900 border border-zinc-700 text-white';
    const btnDisabled = 'opacity-30 cursor-not-allowed';

    const zhActive  = isListening && activeLang === 'zh';
    const deActive  = isListening && activeLang === 'de';
    const zhDisabled = isBusy || (isListening && activeLang !== 'zh');
    const deDisabled = isBusy || (isListening && activeLang !== 'de');

    const handleZH = () => {
      if (isBusy) return;
      // Unlock TTS synchronously inside the gesture handler so iOS Safari allows
      // the later async speechSynthesis.speak() call (from the silence timer).
      TextToSpeech.unlock();
      if (isListening) { void stopRecognitionSession('user'); }
      else { void startRecognitionSession('zh'); }
    };
    const handleDE = () => {
      if (isBusy) return;
      TextToSpeech.unlock();
      if (isListening) { void stopRecognitionSession('user'); }
      else { void startRecognitionSession('de'); }
    };

    // Extract each language's text from the last translation, regardless of
    // direction.  Both halves always show something after any translation:
    //   Chinese side → Chinese text big  + German text small (for reference)
    //   German  side → German  text big  + Chinese text small (for reference)
    const chineseText = translation
      ? translation.to === 'zh' ? translation.translated : translation.original
      : null;
    const germanText = translation
      ? translation.to === 'de' ? translation.translated : translation.original
      : null;

    return (
      <div className="flex flex-col h-screen w-screen bg-black text-white overflow-hidden select-none">

        {/* Error — floats over the divider */}
        {error && (
          <div className="absolute inset-x-0 top-1/2 z-50 flex justify-center -translate-y-1/2 px-6 pointer-events-none">
            <div className="bg-red-500/10 border border-red-500/20 px-6 py-3 rounded-2xl text-center shadow-2xl">
              <span className="text-red-400 text-xs font-black uppercase tracking-widest whitespace-pre-line">{error}</span>
            </div>
          </div>
        )}

        {/* ── TOP HALF — Chinese person's side (rotated 180°) ── */}
        {/* After rotation, paddingTop = physical bottom (home indicator) and
            paddingBottom = physical top (status bar / notch). */}
        <div
          className="flex-1 rotate-180 flex flex-col items-center justify-between px-8 overflow-hidden min-h-0"
          style={{
            paddingTop: 'max(2rem, env(safe-area-inset-bottom))',
            paddingBottom: 'max(2rem, env(safe-area-inset-top))',
          }}
        >

          {/* CN button — Chinese person sees this at their TOP */}
          <button
            onClick={handleZH}
            disabled={zhDisabled}
            aria-label="Translate Chinese to German"
            className={`${btnBase} ${zhActive ? btnActive : btnIdle} ${zhDisabled ? btnDisabled : ''}`}
          >
            <div className="text-xs font-black mb-1">CN</div>
            <Mic size={24} className={zhActive ? 'animate-pulse' : ''} />
            <div className="text-[8px] mt-1 font-bold opacity-60">➜ DE</div>
            {zhActive && (
              <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping" />
            )}
          </button>

          {/* Content — Chinese person sees this below their button */}
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 w-full py-4 min-h-0">
            {zhActive && (
              <SoundWave volume={volume} isListening={true} />
            )}
            {zhActive && pendingTranscript && (
              <div className="bg-zinc-900 border border-zinc-800 px-5 py-3 rounded-2xl text-center max-w-xs">
                <span className="text-white text-base font-bold">{pendingTranscript}</span>
              </div>
            )}
            {chineseText && !isListening && (
              <div className="text-center space-y-3 px-4 animate-in fade-in duration-500">
                <p className="text-white text-4xl font-black leading-tight" lang="zh-CN">{chineseText}</p>
                {germanText && (
                  <p className="text-zinc-500 text-sm italic">"{germanText}"</p>
                )}
              </div>
            )}
            {!isListening && !chineseText && (
              <p className="text-zinc-800 text-[10px] tracking-[0.5em] font-black uppercase animate-pulse">
                中文 · Chinese
              </p>
            )}
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div className="shrink-0 border-t border-b border-zinc-800/60 flex items-center justify-center py-2">
          <button
            onClick={() => setDialogueMode(false)}
            className="flex items-center space-x-1.5 px-3 py-1 bg-zinc-950 border border-zinc-800 rounded-full text-zinc-600 text-[10px] font-black uppercase tracking-widest hover:text-zinc-400 hover:border-zinc-700 transition-colors"
          >
            <ArrowUpDown size={10} />
            <span>Exit Dialogue</span>
          </button>
        </div>

        {/* ── BOTTOM HALF — German person's side ── */}
        {/* paddingBottom must clear the home indicator bar. */}
        <div
          className="flex-1 flex flex-col items-center justify-between px-8 overflow-hidden min-h-0"
          style={{
            paddingTop: '2rem',
            paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
          }}
        >

          {/* Content — German person sees this above their button */}
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 w-full py-4 min-h-0">
            {deActive && (
              <SoundWave volume={volume} isListening={true} />
            )}
            {deActive && pendingTranscript && (
              <div className="bg-zinc-900 border border-zinc-800 px-5 py-3 rounded-2xl text-center max-w-xs">
                <span className="text-white text-base font-bold">{pendingTranscript}</span>
              </div>
            )}
            {germanText && !isListening && (
              <div className="text-center space-y-3 px-4 animate-in fade-in duration-500">
                <p className="text-white text-4xl font-black leading-tight" lang="de">{germanText}</p>
                {chineseText && (
                  <p className="text-zinc-500 text-sm italic" lang="zh-CN">"{chineseText}"</p>
                )}
              </div>
            )}
            {!isListening && !germanText && (
              <p className="text-zinc-800 text-[10px] tracking-[0.5em] font-black uppercase animate-pulse">
                Deutsch · German
              </p>
            )}
          </div>

          {/* DE button — German person sees this at their BOTTOM */}
          <button
            onClick={handleDE}
            disabled={deDisabled}
            aria-label="Translate German to Chinese"
            className={`${btnBase} ${deActive ? btnActive : btnIdle} ${deDisabled ? btnDisabled : ''}`}
          >
            <div className="text-xs font-black mb-1">DE</div>
            <Mic size={24} className={deActive ? 'animate-pulse' : ''} />
            <div className="text-[8px] mt-1 font-bold opacity-60">➜ ZH</div>
            {deActive && (
              <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping" />
            )}
          </button>
        </div>

      </div>
    );
  }

  // ─── Normal mode ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen bg-black text-white overflow-hidden relative font-sans select-none safe-bottom">

      {/* Dialogue mode toggle */}
      <button
        onClick={() => setDialogueMode(true)}
        className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors"
        aria-label="Enter dialogue mode"
        title="Dialogue mode — place phone between two people"
      >
        <ArrowUpDown size={16} />
      </button>

      <main className="flex-1 flex flex-col items-center pt-16 px-6 overflow-y-auto">
        {translation && (
          <TranslationOverlay
            text={translation.translated}
            originalText={translation.original}
            onClose={() => {
              setTranslation(null);
            }}
          />
        )}

        {!translation && !isListening && !error && !isTranslating && (
          <div className="flex flex-col items-center w-full animate-in fade-in duration-1000">
            <div className="text-zinc-800 text-[10px] tracking-[0.5em] font-black animate-pulse mb-8 uppercase">
              Ready to Translate
            </div>
            <QuickPhrases onPhraseClick={handleQuickPhrase} />
          </div>
        )}

        {isListening && (
            <div className="mt-8 w-full flex flex-col items-center space-y-8 animate-in fade-in duration-500">
                <SoundWave volume={volume} isListening={isListening} />
                {pendingTranscript && (
                    <div className="bg-zinc-900 border border-zinc-800 px-6 py-4 rounded-3xl text-center max-w-md shadow-2xl">
                        <span className="text-white text-lg font-bold leading-snug">{pendingTranscript}</span>
                    </div>
                )}
            </div>
        )}

        {error && (
          <div className="mt-16 flex flex-col items-center space-y-4 animate-in zoom-in duration-300 px-4">
            <div className="bg-red-500/10 border border-red-500/20 px-8 py-5 rounded-3xl text-center shadow-2xl max-w-sm">
              {error.includes('Safari') ? (
                <>
                  <p className="text-red-400 text-sm font-bold mb-1">Please open in Safari or Chrome</p>
                  <p className="text-red-300 text-sm mb-3">请在 Safari 或 Chrome 中打开</p>
                  <button
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-5 py-2 bg-blue-600 text-white text-xs font-bold rounded-full active:scale-95 transition-transform"
                  >
                    Open in Browser · 在浏览器中打开
                  </button>
                </>
              ) : (
                <span className="text-red-400 text-xs font-black uppercase tracking-[0.2em] whitespace-pre-line">{error}</span>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="px-6 py-12 w-full max-w-lg mx-auto flex justify-center">
        <BottomButtons
          onStartDE={() => { TextToSpeech.unlock(); void startRecognitionSession('de'); }}
          onStartZH={() => { TextToSpeech.unlock(); void startRecognitionSession('zh'); }}
          onStop={() => stopRecognitionSession('user')}
          isListening={isListening}
          activeLang={activeLang}
          isBusy={isBusy}
        />
      </div>
    </div>
  );
}

export default App;
