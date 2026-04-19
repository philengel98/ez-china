import { useEffect, useRef, useState } from 'react';
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return JSON.stringify(error);
}

function App() {
  const [translation, setTranslation] = useState<{ original: string, translated: string } | null>(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [activeLang, setActiveLang] = useState<LanguageCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(0);

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
        }, 2500); // 2.5s of no activity to auto-stop
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
      translated: phrase.zh
    });
    window.setTimeout(() => {
      void TextToSpeech.speak(phrase.zh, 'zh-CN');
    }, 300);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-black text-white overflow-hidden relative font-sans select-none safe-bottom">
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
            <button 
              onClick={() => TextToSpeech.speak("Test audio engine. One, two, three.", "en-US")}
              className="mt-8 px-6 py-2 border border-blue-500/30 text-blue-400 rounded-full text-xs font-bold uppercase tracking-widest active:scale-95 transition-transform"
            >
              🔈 Test Sound
            </button>
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
          onStartDE={() => startRecognitionSession('de')}
          onStartZH={() => startRecognitionSession('zh')}
          onStop={() => stopRecognitionSession('user')}
          isListening={isListening}
          activeLang={activeLang}
          isBusy={isTranslating || stopInFlightRef.current}
        />
      </div>
    </div>
  );
}

export default App;
