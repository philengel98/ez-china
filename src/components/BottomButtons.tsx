import React from 'react';
import { Mic } from 'lucide-react';

interface BottomButtonsProps {
    onStartDE: () => void;
    onStartZH: () => void;
    onStop: () => void;
    isListening: boolean;
    activeLang: 'de' | 'zh' | null;
    isBusy?: boolean;
}

const BottomButtons: React.FC<BottomButtonsProps> = ({
    onStartDE,
    onStartZH,
    onStop,
    isListening,
    activeLang,
    isBusy = false,
}) => {
    
    const handleToggle = (targetLang: 'de' | 'zh') => {
        if (isBusy) return;
        
        if (isListening) {
            onStop();
        } else {
            if (targetLang === 'de') {
                onStartDE();
            } else {
                onStartZH();
            }
        }
    };

    return (
        <div className="flex flex-col items-center space-y-12 w-full max-w-sm mx-auto">
            <div className="flex items-center justify-center space-x-12">
                {/* DE to ZH Button */}
                <div className="flex flex-col items-center space-y-4">
                    <button
                        onClick={() => handleToggle('de')}
                        disabled={isBusy || (isListening && activeLang !== 'de')}
                        aria-label="Translate German to Chinese"
                        className={`group relative w-24 h-24 rounded-full flex flex-col items-center justify-center transition-all duration-500 transform active:scale-90 ${
                            isListening && activeLang === 'de'
                                ? 'bg-red-600 scale-110 shadow-[0_0_60px_rgba(220,38,38,0.5)]'
                                : 'bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-white'
                        } ${isBusy || (isListening && activeLang !== 'de') ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                    >
                        <div className="text-xs font-black mb-1">DE</div>
                        <Mic size={24} className={isListening && activeLang === 'de' ? 'animate-pulse' : ''} />
                        <div className="text-[8px] mt-1 font-bold opacity-60">➜ ZH</div>
                        
                        {isListening && activeLang === 'de' && (
                            <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping duration-1000" />
                        )}
                    </button>
                    <span className="text-[9px] font-black tracking-widest uppercase text-zinc-600">German</span>
                </div>

                {/* ZH to DE Button */}
                <div className="flex flex-col items-center space-y-4">
                    <button
                        onClick={() => handleToggle('zh')}
                        disabled={isBusy || (isListening && activeLang !== 'zh')}
                        aria-label="Translate Chinese to German"
                        className={`group relative w-24 h-24 rounded-full flex flex-col items-center justify-center transition-all duration-500 transform active:scale-90 ${
                            isListening && activeLang === 'zh'
                                ? 'bg-red-600 scale-110 shadow-[0_0_60px_rgba(220,38,38,0.5)]'
                                : 'bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-white'
                        } ${isBusy || (isListening && activeLang !== 'zh') ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                    >
                        <div className="text-xs font-black mb-1">CN</div>
                        <Mic size={24} className={isListening && activeLang === 'zh' ? 'animate-pulse' : ''} />
                        <div className="text-[8px] mt-1 font-bold opacity-60">➜ DE</div>

                        {isListening && activeLang === 'zh' && (
                            <div className="absolute inset-0 rounded-full border-2 border-white/20 animate-ping duration-1000" />
                        )}
                    </button>
                    <span className="text-[9px] font-black tracking-widest uppercase text-zinc-600">Chinese</span>
                </div>
            </div>

            <div className="h-4 flex items-center justify-center">
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                    {isListening ? 'Tap Active Button to Stop' : 'Tap to Start Speaking'}
                </span>
            </div>
        </div>
    );
};

export default BottomButtons;
