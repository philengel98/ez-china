import React, { useEffect, useState } from 'react';

interface TranslationOverlayProps {
    text: string;
    originalText?: string;
    onClose: () => void;
}

const TranslationOverlay: React.FC<TranslationOverlayProps> = ({ text, originalText, onClose }) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        // Increased duration slightly to 7s but fully dismissible by touch
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(onClose, 500);
        }, 7000);

        return () => clearTimeout(timer);
    }, [onClose]);

    const handleDismiss = () => {
        setIsVisible(false);
        setTimeout(onClose, 300);
    };

    return (
        <div
            onClick={handleDismiss}
            role="button"
            aria-label="Close translation overlay"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDismiss(); }}
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-12 transition-all duration-500 cursor-pointer ${isVisible ? 'opacity-100 scale-100 backdrop-blur-3xl bg-black/90' : 'opacity-0 scale-95 backdrop-blur-none bg-black/0'
                }`}
        >
            <div className="flex flex-col items-center justify-center text-center space-y-8 max-w-4xl">
                {/* Original Text (Subtle) */}
                {originalText && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-4 duration-700">
                        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em]">You said</span>
                        <p className="text-2xl font-bold text-zinc-400 italic leading-tight" lang="de">
                            "{originalText}"
                        </p>
                    </div>
                )}

                {/* Translation (Main) */}
                <div className="space-y-4 animate-in fade-in zoom-in duration-1000 delay-200">
                    {originalText && <div className="w-12 h-[2px] bg-zinc-800 mx-auto rounded-full" />}
                    <p className="text-6xl sm:text-7xl font-black text-white leading-[1.1] tracking-tight drop-shadow-2xl" lang="zh-CN">
                        {text}
                    </p>
                </div>

                {/* Minimal Footer */}
                <div className="absolute bottom-20 flex flex-col items-center space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-1000 delay-500">
                    <div className="flex items-center space-x-3 text-zinc-700">
                        <span className="text-[8px] font-black uppercase tracking-[0.4em]">Tap to dismiss</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TranslationOverlay;
