import { useState, useEffect } from 'react';
import { Plus, Trash2, X, Settings2, Loader2 } from 'lucide-react';
import { translateText } from '../utils/TranslationService';

interface Phrase {
    id: string;
    de: string;
    zh: string;
}

interface QuickPhrasesProps {
    onPhraseClick: (phrase: Phrase) => void;
}

const QuickPhrases: React.FC<QuickPhrasesProps> = ({ onPhraseClick }) => {
    const [phrases, setPhrases] = useState<Phrase[]>([]);
    const [isManaging, setIsManaging] = useState(false);
    const [newDe, setNewDe] = useState('');
    const [isTranslating, setIsTranslating] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('translation_phrases');
        if (saved) {
            setPhrases(JSON.parse(saved));
        } else {
            const initial: Phrase[] = [
                { id: '1', de: 'Danke', zh: '谢谢' },
                { id: '2', de: 'Das hier', zh: '这个' },
                { id: '3', de: 'Kein Problem', zh: '没问题' },
                { id: '4', de: 'Nicht scharf', zh: '不辣' },
            ];
            setPhrases(initial);
            localStorage.setItem('translation_phrases', JSON.stringify(initial));
        }
    }, []);

    const savePhrases = (updated: Phrase[]) => {
        setPhrases(updated);
        localStorage.setItem('translation_phrases', JSON.stringify(updated));
    };

    const addPhrase = async () => {
        if (!newDe || isTranslating) return;

        setIsTranslating(true);
        try {
            // Using 'zh-CN' explicitly to avoid English fallback in some APIs
            const translatedZh = await translateText(newDe, 'de', 'zh-CN');
            const newItem: Phrase = {
                id: Date.now().toString(),
                de: newDe,
                zh: translatedZh
            };
            savePhrases([...phrases, newItem]);
            setNewDe('');
        } catch (error) {
            console.error('Auto-translation failed:', error);
        } finally {
            setIsTranslating(false);
        }
    };

    const deletePhrase = (id: string) => {
        savePhrases(phrases.filter(p => p.id !== id));
    };

    return (
        <div className="w-full max-w-2xl mx-auto px-4 mt-2 flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-8 px-2">
                <h2 className="text-zinc-700 text-[10px] font-black tracking-[0.4em] uppercase">Quick Phrases</h2>
                <button
                    onClick={() => setIsManaging(!isManaging)}
                    aria-label={isManaging ? "Close settings" : "Manage quick phrases"}
                    title={isManaging ? "Close" : "Settings"}
                    className={`p-2 rounded-full transition-all duration-300 ${isManaging ? 'bg-white text-black' : 'text-zinc-700 hover:text-zinc-500'}`}
                >
                    <Settings2 size={16} aria-hidden="true" />
                </button>
            </div>

            {/* Grid with better wrapping - No truncation ellipses, we allow vertical growth */}
            <div className="grid grid-cols-2 gap-4 w-full">
                {phrases.map((phrase) => {
                    return (
                        <div key={phrase.id} className="relative group">
                            <button
                                onClick={() => !isManaging && onPhraseClick(phrase)}
                                aria-label={`Speak phrase: ${phrase.de}`}
                                className={`w-full min-h-[100px] px-6 py-5 rounded-[2.5rem] flex flex-col items-center justify-center transition-all duration-300 transform active:scale-95 text-center ${isManaging ? 'bg-zinc-900 border border-zinc-800 opacity-60' : 'bg-zinc-900/30 hover:bg-zinc-800/60 border border-zinc-800/50 hover:border-zinc-700/80 backdrop-blur-md shadow-2xl'
                                    }`}
                            >
                                <div className="flex flex-col items-center justify-center">
                                    <span className="text-sm font-black text-white leading-tight mb-2 tracking-wide" lang="de">
                                        {phrase.de}
                                    </span>
                                    <span className="text-xs font-medium text-zinc-500 leading-tight tracking-wide" lang="zh-CN">
                                        {phrase.zh}
                                    </span>
                                </div>
                            </button>
                            {isManaging && (
                                <button
                                    onClick={() => deletePhrase(phrase.id)}
                                    aria-label={`Delete phrase: ${phrase.de}`}
                                    className="absolute -top-2 -right-2 bg-red-600 text-white p-2 rounded-full shadow-2xl border-2 border-black z-20"
                                >
                                    <Trash2 size={12} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {isManaging && (
                <div className="mt-8 w-full p-8 bg-zinc-900/95 border border-zinc-800 rounded-[3rem] backdrop-blur-3xl space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 shadow-2xl z-30">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Add Custom Phrase</span>
                        <button onClick={() => setIsManaging(false)} aria-label="Close" className="text-zinc-600 hover:text-white transition-colors">
                            <X size={20} aria-hidden="true" />
                        </button>
                    </div>
                    <div className="flex flex-col space-y-4">
                        <input
                            type="text"
                            placeholder="Enter German text..."
                            value={newDe}
                            onChange={(e) => setNewDe(e.target.value)}
                            className="w-full bg-black/60 border border-zinc-800 rounded-3xl px-8 py-5 text-sm focus:outline-none focus:border-zinc-500 transition-all font-medium text-white shadow-inner"
                        />
                        <button
                            onClick={addPhrase}
                            disabled={isTranslating || !newDe}
                            aria-label="Add new phrase"
                            className="bg-white text-black font-black py-5 rounded-full flex items-center justify-center space-x-3 hover:bg-zinc-200 active:scale-95 transition-all shadow-xl disabled:opacity-50"
                        >
                            {isTranslating ? <Loader2 size={24} className="animate-spin" aria-hidden="true" /> : <Plus size={24} aria-hidden="true" />}
                            <span className="text-sm uppercase tracking-[0.2em]">{isTranslating ? 'Translating...' : 'Add Phrase'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuickPhrases;
