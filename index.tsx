import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, User } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, onSnapshot, where } from "firebase/firestore";

// --- TYPES ---

export interface Word {
    english: string;
    vietnamese: string;
    ipa?: string;
    example?: string;
}

export interface Topic {
    name: string;
    words: Word[];
    file: string;
}

export interface SRSData {
    interval: number;
    level: number;
    nextReview: number;
    consecutiveWrongs: number;
    isHard: boolean;
}

export interface UserConfig {
    newLimit: number;
    reviewLimit: number;
    darkMode: boolean;
    muted: boolean;
}

export interface LeaderboardUser {
    id: string;
    displayName: string;
    photoURL: string;
    score: number;
    studyTime: number;
    lang: string;
}

export type GameMode = 'flashcard' | 'fill' | 'sentence' | 'matching' | 'quiz' | 'spelling' | 'smart';
export type LanguageCode = 'en' | 'id';
export type RepoType = 'basic' | 'advanced';

export const REPOS = {
    en: {
        basic: { user: 'ngxuanhai123', repo: 'tuvung' },
        advanced: { user: 'ngxuanhai123', repo: '3000tv' }
    },
    id: {
        basic: { user: 'ngxuanhai123', repo: 'indo' }
    }
};

export interface LangConfig {
    code: LanguageCode;
    label: string;
    flag: string;
    tts: string;
}

export const LANGS: Record<LanguageCode, LangConfig> = {
    en: { code: 'en', label: 'Tiếng Anh', flag: '🇺🇸', tts: 'en-US' },
    id: { code: 'id', label: 'Indonesia', flag: '🇮🇩', tts: 'id-ID' }
};

// --- SERVICES ---

const firebaseConfig = {
  apiKey: "AIzaSyDtaVYb_72YvoGzvcERJZypUGS-u3skz2M",
  authDomain: "tuvung-88e8d.firebaseapp.com",
  databaseURL: "https://tuvung-88e8d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tuvung-88e8d",
  storageBucket: "tuvung-88e8d.firebasestorage.app",
  messagingSenderId: "722559465686",
  appId: "1:722559465686:web:bae1a77791205d372db177",
  measurementId: "G-T785TQ3V32"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const loginGoogle = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Login failed", error);
        throw error;
    }
};

const logoutGoogle = async () => {
    await signOut(auth);
};

const fetchTopics = async (lang: LanguageCode, repoType: RepoType): Promise<Record<string, Topic>> => {
    const config = lang === 'en' ? REPOS.en[repoType] : REPOS.id.basic;
    const api = `https://api.github.com/repos/${config.user}/${config.repo}/contents/`;
    
    try {
        const res = await fetch(api);
        if(!res.ok) throw new Error("Failed to fetch repo contents");
        const files = await res.json();
        const jsonFiles = files.filter((f: any) => f.name.endsWith('.json'));
        
        const topics: Record<string, Topic> = {};
        
        await Promise.all(jsonFiles.map(async (f: any) => {
            try {
                const raw = await fetch(f.download_url);
                const data = await raw.json();
                const words = Array.isArray(data) ? data : (data.words || []);
                if (words.length > 0) {
                    topics[f.name] = {
                        name: (data.name || f.name.replace('.json','')).replace(/_/g,' '),
                        words: words,
                        file: f.name
                    };
                }
            } catch (err) {
                console.warn(`Failed to load topic ${f.name}`, err);
            }
        }));
        
        return topics;
    } catch (error) {
        console.error("GitHub fetch error", error);
        throw error;
    }
};

const getWordKey = (w: Word) => {
    return (w.english + '_' + (w.vietnamese || '').substring(0,3)).toLowerCase().replace(/\s/g,'');
};

const formatTime = (seconds: number) => {
    if(seconds < 60) return seconds + 's';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if(h > 0) return `${h}h${m}`;
    return `${m}m`;
};

const getImageForWord = (word: string) => {
    const prompt = `minimalist flat vector illustration of ${word}, clean white background, high quality`;
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true`;
};

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

const initAudio = () => {
    if(!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
};

const playSound = (type: 'correct' | 'wrong' | 'flip' | 'win' | 'pop', muted: boolean) => {
    if(muted) return;
    initAudio();
    if(!audioCtx || !masterGain) return;
    
    const now = audioCtx.currentTime;
    
    const playTone = (freq: number, type: OscillatorType, startTime: number, duration: number, vol: number) => {
        const o = audioCtx!.createOscillator();
        const g = audioCtx!.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        o.connect(g);
        g.connect(masterGain!);
        o.start(startTime);
        o.stop(startTime + duration);
    };

    switch(type) {
        case 'correct':
            playTone(523.25, 'sine', now, 0.4, 0.2);
            playTone(659.25, 'sine', now + 0.1, 0.4, 0.2);
            break;
        case 'wrong':
            playTone(150, 'sawtooth', now, 0.4, 0.15);
            playTone(140, 'sawtooth', now + 0.1, 0.4, 0.15);
            break;
        case 'flip':
            playTone(800, 'triangle', now, 0.1, 0.05);
            break;
        case 'pop':
            playTone(600, 'sine', now, 0.1, 0.1);
            break;
        case 'win':
             [523, 659, 783, 1046].forEach((f, i) => playTone(f, 'square', now + i*0.1, 0.6, 0.1));
             break;
    }
};

const speakText = (text: string, langCode: string, muted: boolean) => {
    if(muted) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode === 'en' ? 'en-US' : 'id-ID';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
};

// --- COMPONENTS ---

interface GameEngineProps {
    mode: GameMode;
    queue: Word[];
    config: UserConfig;
    lang: string;
    onComplete: (results: { correctIds: string[], wrongIds: string[] }) => void;
    onClose: () => void;
    onUpdateSRS: (word: Word, correct: boolean) => void;
    markMastered: (word: Word) => void;
}

const GameEngine: React.FC<GameEngineProps> = ({ mode, queue, config, lang, onComplete, onClose, onUpdateSRS, markMastered }) => {
    const [index, setIndex] = useState(0);
    const [currentMode, setCurrentMode] = useState<GameMode>(mode);
    const [isFlipped, setIsFlipped] = useState(false);
    const [feedback, setFeedback] = useState<'none' | 'correct' | 'wrong'>('none');
    
    // Spelling state
    const [spellingInput, setSpellingInput] = useState('');
    
    // Sentence state
    const [sentenceChips, setSentenceChips] = useState<{id: number, text: string, used: boolean}[]>([]);
    const [sentenceAns, setSentenceAns] = useState<{id: number, text: string}[]>([]);
    const [sentenceTarget, setSentenceTarget] = useState('');

    // Preload images
    useEffect(() => {
        const preloadLimit = Math.min(queue.length, index + 4);
        for(let i = index; i < preloadLimit; i++) {
            const img = new Image();
            img.src = getImageForWord(queue[i].english);
        }
    }, [index, queue]);

    // Handle Mode Switching for Smart Mode
    useEffect(() => {
        if(mode === 'smart') {
            const availableModes: GameMode[] = ['flashcard', 'quiz', 'fill', 'sentence', 'spelling'];
            const random = availableModes[Math.floor(Math.random() * availableModes.length)];
            setCurrentMode(random);
        } else {
            setCurrentMode(mode);
        }
        
        setIsFlipped(false);
        setFeedback('none');
        setSpellingInput('');
        setSentenceAns([]);
        
        if(mode === 'sentence' || (mode === 'smart' && currentMode === 'sentence')) {
           const w = queue[index];
           const target = w.example || w.english; 
           setSentenceTarget(target);
           const parts = target.split(/\s+/).map((t, i) => ({ id: i, text: t, used: false }));
           setSentenceChips(parts.sort(() => Math.random() - 0.5));
        }

    }, [index, mode, queue]);

    // Audio on new card
    useEffect(() => {
        const w = queue[index];
        if(!w) return;
        const textToRead = currentMode === 'sentence' && w.example ? w.example : w.english;
        const t = setTimeout(() => {
             speakText(textToRead, lang, config.muted);
        }, 500);
        return () => clearTimeout(t);
    }, [index, currentMode, lang, config.muted]);

    const handleResult = (correct: boolean) => {
        if (feedback !== 'none') return;

        setFeedback(correct ? 'correct' : 'wrong');
        playSound(correct ? 'correct' : 'wrong', config.muted);
        
        onUpdateSRS(queue[index], correct);

        setTimeout(() => {
            if (index < queue.length - 1) {
                setIndex(prev => prev + 1);
            } else {
                onComplete({ correctIds: [], wrongIds: [] });
            }
        }, correct ? 800 : 2000);
    };

    const currentWord = queue[index];
    if (!currentWord) return null;

    // --- RENDERERS ---

    const renderFlashcard = () => (
        <div className="flex flex-col items-center w-full max-w-md perspective-1000">
            <div 
                className={`relative w-full aspect-[3/4] md:aspect-[4/5] transition-transform duration-700 transform-style-3d cursor-pointer ${isFlipped ? 'rotate-y-180' : ''}`}
                onClick={() => { setIsFlipped(!isFlipped); playSound('flip', config.muted); }}
            >
                {/* Front */}
                <div className="absolute inset-0 backface-hidden glass-panel rounded-3xl p-6 flex flex-col items-center justify-between z-10 bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-white">
                    <div className="w-full text-center">
                        <span className="text-xs uppercase font-bold tracking-widest opacity-60 mb-2 block">Flashcard</span>
                        <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600 mb-2 filter drop-shadow-sm">
                            {currentWord.english}
                        </h2>
                        <p className="font-serif italic text-slate-500 text-lg mb-4">{currentWord.ipa}</p>
                    </div>
                    
                    <div className="w-full h-48 rounded-xl overflow-hidden shadow-inner bg-slate-100 dark:bg-slate-800 relative">
                        <img 
                            src={getImageForWord(currentWord.english)} 
                            alt={currentWord.english}
                            className="w-full h-full object-cover opacity-90 hover:opacity-100 transition-opacity"
                            onError={(e) => {(e.target as HTMLImageElement).style.display = 'none'}} 
                        />
                        <div className="absolute bottom-0 left-0 w-full p-2 bg-gradient-to-t from-black/60 to-transparent text-white text-xs text-center">
                            Illustration
                        </div>
                    </div>

                    <div className="text-sm opacity-50 mt-4 animate-pulse">Tap to flip</div>
                </div>

                {/* Back */}
                <div className="absolute inset-0 backface-hidden glass-panel rounded-3xl p-6 flex flex-col items-center justify-center rotate-y-180 bg-white/95 dark:bg-slate-800/95 text-slate-800 dark:text-white">
                    <h3 className="text-sm uppercase font-bold text-slate-400 mb-2">Meaning</h3>
                    <p className="text-3xl font-bold mb-6 text-center">{currentWord.vietnamese}</p>
                    
                    {currentWord.example && (
                        <div className="bg-slate-100 dark:bg-slate-700/50 p-4 rounded-xl w-full">
                            <p className="italic text-lg text-center">"{currentWord.example}"</p>
                        </div>
                    )}
                    
                    <button 
                        onClick={(e) => { e.stopPropagation(); markMastered(currentWord); }}
                        className="mt-8 text-xs flex items-center gap-2 text-yellow-500 hover:text-yellow-400 transition-colors"
                    >
                        <i className="fas fa-crown"></i> Mark as Mastered
                    </button>
                </div>
            </div>

            {/* Controls */}
            <div className="flex gap-4 w-full mt-8">
                <button 
                    onClick={() => handleResult(false)} 
                    className="flex-1 py-4 rounded-2xl bg-red-500/20 border border-red-500/50 text-red-500 font-bold hover:bg-red-500/30 transition-all active:scale-95"
                >
                    <i className="fas fa-times mr-2"></i> Hard
                </button>
                <button 
                    onClick={() => speakText(currentWord.english, lang, config.muted)}
                    className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xl hover:bg-white/20 active:scale-95 transition-all"
                >
                    <i className="fas fa-volume-up"></i>
                </button>
                <button 
                    onClick={() => handleResult(true)}
                    className="flex-1 py-4 rounded-2xl bg-green-500/20 border border-green-500/50 text-green-500 font-bold hover:bg-green-500/30 transition-all active:scale-95"
                >
                    Easy <i className="fas fa-check ml-2"></i>
                </button>
            </div>
        </div>
    );

    const renderQuiz = () => {
        const others = queue.filter(w => w !== currentWord);
        const distractors = others.sort(() => 0.5 - Math.random()).slice(0, 3);
        const options = [...distractors, currentWord].sort(() => 0.5 - Math.random());

        return (
            <div className="flex flex-col items-center w-full max-w-md animate-fadeIn">
                <div className="text-center mb-8">
                    <h2 className="text-4xl font-extrabold text-white drop-shadow-lg mb-4">{currentWord.english}</h2>
                    <button onClick={() => speakText(currentWord.english, lang, config.muted)} className="text-white/70 hover:text-white"><i className="fas fa-volume-up text-2xl"></i></button>
                </div>

                <div className="grid grid-cols-1 gap-4 w-full">
                    {options.map((opt, idx) => {
                        const isCorrect = opt === currentWord;
                        let btnClass = "py-4 rounded-xl font-bold text-slate-800 bg-white/90 hover:bg-white transition-all transform active:scale-95 shadow-lg";
                        if (feedback === 'correct' && isCorrect) btnClass = "py-4 rounded-xl font-bold text-white bg-green-500 shadow-lg scale-105";
                        if (feedback === 'wrong' && !isCorrect) btnClass += " opacity-50";
                        if (feedback === 'wrong' && isCorrect) btnClass = "py-4 rounded-xl font-bold text-white bg-green-500 shadow-lg"; 

                        return (
                            <button 
                                key={idx} 
                                onClick={() => handleResult(isCorrect)}
                                className={btnClass}
                                disabled={feedback !== 'none'}
                            >
                                {opt.vietnamese}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderFill = () => {
        const check = () => {
             const correct = spellingInput.toLowerCase().trim() === currentWord.english.toLowerCase().trim();
             if(!correct) {
                 setSpellingInput(currentWord.english); 
             }
             handleResult(correct);
        };
        return (
            <div className="flex flex-col items-center w-full max-w-md animate-fadeIn p-4">
                 <div className="glass-panel p-6 rounded-2xl w-full text-center mb-6">
                     <p className="text-xl text-slate-200 mb-2">Meaning:</p>
                     <h3 className="text-2xl font-bold text-white mb-4">{currentWord.vietnamese}</h3>
                     <p className="text-slate-400 text-sm">Type the word in English</p>
                 </div>
                 
                 <input 
                    type="text" 
                    value={spellingInput}
                    onChange={(e) => setSpellingInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && check()}
                    className={`w-full bg-white/20 border border-white/30 rounded-xl p-4 text-center text-2xl font-bold text-white focus:bg-white/30 outline-none transition-all ${feedback === 'wrong' ? 'border-red-500 text-red-200' : ''} ${feedback === 'correct' ? 'border-green-500 text-green-200' : ''}`}
                    placeholder="Type here..."
                    disabled={feedback !== 'none'}
                 />
                 
                 <div className="flex gap-4 mt-6 w-full">
                     <button onClick={() => speakText(currentWord.english, lang, config.muted)} className="p-4 rounded-full bg-white/10 hover:bg-white/20"><i className="fas fa-volume-up"></i></button>
                     <button onClick={check} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl py-3 shadow-lg transition-transform active:scale-95">Check</button>
                 </div>
            </div>
        );
    };

    const renderSentence = () => {
        const moveWord = (chip: typeof sentenceChips[0]) => {
            if(feedback !== 'none') return;
            setSentenceChips(prev => prev.map(c => c.id === chip.id ? { ...c, used: true } : c));
            setSentenceAns(prev => [...prev, { id: chip.id, text: chip.text }]);
            playSound('pop', config.muted);
        };

        const removeWord = (ans: typeof sentenceAns[0]) => {
            if(feedback !== 'none') return;
            setSentenceAns(prev => prev.filter(a => a.id !== ans.id));
            setSentenceChips(prev => prev.map(c => c.id === ans.id ? { ...c, used: false } : c));
            playSound('flip', config.muted);
        };

        const checkSentence = () => {
            const userStr = sentenceAns.map(a => a.text).join(' ');
            const targetStr = sentenceTarget; 
            const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '');
            const correct = normalize(userStr) === normalize(targetStr);
            handleResult(correct);
        };

        return (
             <div className="flex flex-col items-center w-full max-w-xl animate-fadeIn p-2">
                 <div className="mb-6 text-center">
                     <p className="text-slate-300 mb-2 uppercase text-xs tracking-widest">Arrange the sentence</p>
                     <h3 className="text-xl font-bold text-white">"{currentWord.vietnamese}"</h3>
                 </div>

                 <div className="w-full min-h-[80px] bg-white/10 rounded-xl p-4 flex flex-wrap gap-2 justify-center border-2 border-dashed border-white/20 mb-6">
                     {sentenceAns.map(a => (
                         <button key={a.id} onClick={() => removeWord(a)} className="bg-blue-500 text-white px-4 py-2 rounded-lg font-bold shadow-md hover:bg-red-500 transition-colors animate-popIn">
                             {a.text}
                         </button>
                     ))}
                     {sentenceAns.length === 0 && <span className="text-white/30 italic self-center">Tap words below...</span>}
                 </div>

                 <div className="flex flex-wrap gap-2 justify-center mb-8">
                     {sentenceChips.map(c => (
                         <button 
                            key={c.id} 
                            onClick={() => !c.used && moveWord(c)} 
                            className={`px-4 py-2 rounded-lg font-bold shadow-sm transition-all ${c.used ? 'opacity-0 pointer-events-none' : 'bg-white text-slate-800 hover:bg-slate-200 active:scale-95'}`}
                         >
                             {c.text}
                         </button>
                     ))}
                 </div>
                 
                 <div className="flex gap-4 w-full max-w-sm">
                      <button onClick={() => { setSentenceAns([]); setSentenceChips(prev => prev.map(x => ({...x, used:false}))); }} className="px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20"><i className="fas fa-undo"></i></button>
                      <button onClick={checkSentence} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl py-3 shadow-lg">Submit</button>
                 </div>
             </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/95 backdrop-blur-md">
            <div className="flex justify-between items-center p-4">
                <button onClick={onClose} className="text-white/60 hover:text-white"><i className="fas fa-times text-2xl"></i></button>
                <div className="flex-1 mx-4 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-gradient-to-r from-blue-400 to-purple-500 transition-all duration-500"
                        style={{ width: `${((index) / queue.length) * 100}%` }}
                    />
                </div>
                <div className="text-white/80 font-mono text-sm">{index + 1}/{queue.length}</div>
            </div>

            <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
                {currentMode === 'flashcard' && renderFlashcard()}
                {currentMode === 'quiz' && renderQuiz()}
                {(currentMode === 'fill' || currentMode === 'spelling') && renderFill()}
                {currentMode === 'sentence' && renderSentence()}
                {currentMode === 'matching' && renderQuiz()} 
            </div>
        </div>
    );
};

// --- APP COMPONENT ---

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'home' | 'leaderboard' | 'library' | 'settings'>('home');
    
    const [topics, setTopics] = useState<Record<string, Topic>>({});
    const [currentTopicKey, setCurrentTopicKey] = useState<string>('');
    const [lang, setLang] = useState<LanguageCode>('en');
    const [repoType, setRepoType] = useState<RepoType>('basic');
    
    const [srsData, setSrsData] = useState<Record<string, SRSData>>({});
    const [mastered, setMastered] = useState<Record<string, boolean>>({});
    const [score, setScore] = useState(0);
    const [studyTime, setStudyTime] = useState(0);

    const [gameSession, setGameSession] = useState<{ active: boolean, mode: GameMode, queue: Word[] }>({ active: false, mode: 'flashcard', queue: [] });

    const [config, setConfig] = useState<UserConfig>({
        newLimit: 5, reviewLimit: 20, darkMode: true, muted: false
    });

    const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);

    useEffect(() => {
        const unsub = auth.onAuthStateChanged(async (u) => {
            setUser(u);
            if (u) {
                const docId = `${u.uid}_${lang}`;
                const ref = doc(db, 'userData', docId);
                const snap = await getDoc(ref);
                
                if (snap.exists()) {
                    const d = snap.data();
                    setSrsData(d.srsData || {});
                    setMastered(d.mastered || {});
                    setScore(d.score || 0);
                    setStudyTime(d.studyTime || 0);
                    if(d.config) setConfig(prev => ({...prev, ...d.config}));
                    if(d.currentTopicKey) setCurrentTopicKey(d.currentTopicKey);
                    if(d.repoType) setRepoType(d.repoType as RepoType);
                } else {
                    setSrsData({});
                    setMastered({});
                    setScore(0);
                    setStudyTime(0);
                }
            } else {
                setSrsData({}); setMastered({}); setScore(0);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [lang]);

    useEffect(() => {
        setLoading(true);
        fetchTopics(lang, repoType).then(data => {
            setTopics(data);
            if (!currentTopicKey || !data[currentTopicKey]) {
                setCurrentTopicKey(Object.keys(data)[0] || '');
            }
            setLoading(false);
        }).catch(e => {
            console.error(e);
            setLoading(false);
        });
    }, [lang, repoType]);

    useEffect(() => {
        if (!user) return;
        const docId = `${user.uid}_${lang}`;
        const saveData = async () => {
            await setDoc(doc(db, 'userData', docId), {
                srsData, mastered, score, studyTime, config, currentTopicKey, repoType,
                lastUpdated: Date.now()
            }, { merge: true });

            await setDoc(doc(db, 'leaderboard', docId), {
                id: user.uid,
                displayName: user.displayName,
                photoURL: user.photoURL,
                score,
                studyTime,
                lang
            }, { merge: true });
        };
        const t = setTimeout(saveData, 2000);
        return () => clearTimeout(t);
    }, [srsData, mastered, score, studyTime, config, currentTopicKey, repoType, user, lang]);

    useEffect(() => {
        let interval: any;
        if (gameSession.active) {
            interval = setInterval(() => setStudyTime(prev => prev + 1), 1000);
        }
        return () => clearInterval(interval);
    }, [gameSession.active]);

    useEffect(() => {
        if (view !== 'leaderboard') return;
        const q = query(
            collection(db, 'leaderboard'), 
            where('lang', '==', lang),
            orderBy('score', 'desc'), 
            limit(20)
        );
        const unsub = onSnapshot(q, (snap) => {
            const list: LeaderboardUser[] = [];
            snap.forEach(d => list.push(d.data() as LeaderboardUser));
            setLeaderboard(list);
        });
        return () => unsub();
    }, [view, lang]);

    const startGame = (mode: GameMode) => {
        if(!currentTopicKey || !topics[currentTopicKey]) return;
        const allWords = topics[currentTopicKey].words;

        let queue: Word[] = [];

        if (mode === 'flashcard') {
            queue = allWords; 
        } else if (mode === 'smart') {
            const now = Date.now();
            const newWords = allWords.filter(w => !srsData[getWordKey(w)] && !mastered[getWordKey(w)]).slice(0, config.newLimit);
            const reviewWords = allWords.filter(w => {
                const k = getWordKey(w);
                return srsData[k] && srsData[k].nextReview <= now && !mastered[k];
            }).sort((a,b) => srsData[getWordKey(a)].nextReview - srsData[getWordKey(b)].nextReview).slice(0, config.reviewLimit);
            
            queue = [...newWords, ...reviewWords];
        } else {
            queue = allWords.filter(w => {
                const k = getWordKey(w);
                return (srsData[k] || mastered[k]);
            });
            if (queue.length < 4) {
                alert("You need to learn at least 4 words in Flashcard/Smart mode before playing games!");
                return;
            }
        }

        if (mode !== 'smart') {
            queue = queue.sort(() => 0.5 - Math.random()).slice(0, 30);
        }

        if (queue.length === 0) {
            alert("No words available for this session!");
            return;
        }

        setGameSession({ active: true, mode, queue });
    };

    const handleSRSUpdate = (w: Word, correct: boolean) => {
        const k = getWordKey(w);
        const prev = srsData[k] || { interval: 0, level: 0, nextReview: 0, consecutiveWrongs: 0, isHard: false };
        let next = { ...prev };

        if (correct) {
            setScore(s => s + 10);
            next.consecutiveWrongs = 0;
            const mult = next.isHard ? 1.5 : 2.5;
            next.interval = next.level === 0 ? 1 : (next.level === 1 ? 3 : Math.ceil(next.interval * mult));
            next.isHard = false;
            next.level++;
            next.nextReview = Date.now() + (next.interval * 24 * 60 * 60 * 1000);
        } else {
            next.level = 0;
            next.interval = 0;
            next.nextReview = Date.now();
            next.consecutiveWrongs++;
            if (next.consecutiveWrongs > 2) next.isHard = true;
        }

        setSrsData(prevData => ({ ...prevData, [k]: next }));
    };

    const markMastered = (w: Word) => {
        const k = getWordKey(w);
        setMastered(prev => ({...prev, [k]: true}));
        const newSrs = { ...srsData };
        delete newSrs[k];
        setSrsData(newSrs);
        setScore(s => s + 100);
    };

    const getStats = () => {
        if(!topics[currentTopicKey]) return { total:0, learned:0, pct:0 };
        const words = topics[currentTopicKey].words;
        const total = words.length;
        let learned = 0;
        words.forEach(w => {
            const k = getWordKey(w);
            if(srsData[k] || mastered[k]) learned++;
        });
        return { total, learned, pct: total === 0 ? 0 : Math.round((learned/total)*100) };
    };

    if (loading) return <div className="h-screen w-full flex items-center justify-center text-white bg-slate-900"><i className="fas fa-circle-notch fa-spin text-4xl text-blue-500"></i></div>;
    
    if (!user) {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white relative overflow-hidden">
                <div className="aurora-bg"></div>
                <div className="glass-panel p-8 rounded-3xl text-center z-10 max-w-sm w-full mx-4">
                    <h1 className="text-4xl font-extrabold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-teal-400">Hihi Vocabulary</h1>
                    <p className="mb-8 text-slate-300">Master languages with AI & SRS</p>
                    <button onClick={loginGoogle} className="w-full py-4 bg-white text-slate-900 font-bold rounded-xl shadow-lg hover:scale-105 transition-transform flex items-center justify-center gap-2">
                        <i className="fab fa-google text-red-500"></i> Continue with Google
                    </button>
                    
                    <div className="flex justify-center gap-4 mt-8">
                        {Object.values(LANGS).map(l => (
                            <button key={l.code} onClick={() => setLang(l.code)} className={`p-2 rounded-lg transition-all ${lang === l.code ? 'bg-white/20 border border-white' : 'opacity-50'}`}>
                                <span className="text-2xl">{l.flag}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    const stats = getStats();

    return (
        <div className={`min-h-screen pb-24 ${config.darkMode ? 'dark' : ''} text-slate-100 relative`}>
             <div className="aurora-bg"></div>
             
             <header className="p-6 flex justify-between items-start z-10 relative">
                 <div>
                     <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Hihi Vocab</h1>
                     <div className="text-xs font-bold opacity-70 flex items-center gap-2">
                         <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-md border border-yellow-500/30">{score.toLocaleString()} XP</span>
                         <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-md border border-blue-500/30">{formatTime(studyTime)}</span>
                     </div>
                 </div>
                 <button onClick={() => setConfig({...config, darkMode: !config.darkMode})} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                     <i className={`fas ${config.darkMode ? 'fa-sun text-yellow-400' : 'fa-moon'}`}></i>
                 </button>
             </header>

             <main className="px-4 max-w-lg mx-auto z-10 relative animate-fadeIn">
                 
                 {view === 'home' && (
                     <>
                        <div className="glass-panel p-6 rounded-3xl mb-6 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl -mr-10 -mt-10"></div>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-1">Current Topic</p>
                                    <h2 className="text-2xl font-bold truncate pr-2 leading-tight">
                                        {topics[currentTopicKey]?.name || 'Loading...'}
                                    </h2>
                                </div>
                                <button onClick={() => setView('library')} className="p-2 bg-white/10 rounded-lg hover:bg-white/20"><i className="fas fa-exchange-alt"></i></button>
                            </div>
                            
                            <div className="flex justify-between items-end">
                                <div>
                                    <div className="text-4xl font-bold">{stats.pct}%</div>
                                    <div className="text-xs text-slate-400">Mastery</div>
                                </div>
                                <div className="text-right text-sm text-slate-300">
                                    <div>{stats.learned} / {stats.total} words</div>
                                    <div className="w-24 h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-green-400" style={{ width: `${stats.pct}%` }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button 
                            onClick={() => startGame('smart')}
                            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 mb-8"
                        >
                            <i className="fas fa-brain"></i> Start Smart Session
                        </button>

                        <h3 className="font-bold text-lg mb-4 pl-2 border-l-4 border-blue-500">Practice Modes</h3>
                        <div className="grid grid-cols-2 gap-4">
                            {[
                                { id: 'flashcard', icon: 'fa-clone', label: 'Flashcard', color: 'from-pink-500 to-rose-500' },
                                { id: 'fill', icon: 'fa-keyboard', label: 'Fill Word', color: 'from-orange-500 to-amber-500' },
                                { id: 'sentence', icon: 'fa-sort-amount-down', label: 'Sentence', color: 'from-emerald-500 to-teal-500' },
                                { id: 'quiz', icon: 'fa-question-circle', label: 'Quiz', color: 'from-violet-500 to-purple-500' },
                                { id: 'matching', icon: 'fa-puzzle-piece', label: 'Matching', color: 'from-cyan-500 to-blue-500' },
                                { id: 'spelling', icon: 'fa-font', label: 'Spelling', color: 'from-indigo-500 to-blue-600' }
                            ].map((m) => (
                                <button 
                                    key={m.id} 
                                    onClick={() => startGame(m.id as GameMode)}
                                    className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-3 hover:bg-white/10 active:scale-95 transition-all aspect-[4/3]"
                                >
                                    <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${m.color} flex items-center justify-center text-xl shadow-lg`}>
                                        <i className={`fas ${m.icon}`}></i>
                                    </div>
                                    <span className="font-semibold text-sm">{m.label}</span>
                                </button>
                            ))}
                        </div>
                     </>
                 )}

                 {view === 'library' && (
                     <div className="space-y-6">
                         <h2 className="text-2xl font-bold">Library</h2>
                         
                         <div className="glass-panel p-4 rounded-2xl flex flex-col gap-4">
                             <div className="flex gap-2 p-1 bg-slate-800/50 rounded-xl">
                                 {Object.values(LANGS).map(l => (
                                     <button 
                                        key={l.code} 
                                        onClick={() => setLang(l.code)}
                                        className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${lang === l.code ? 'bg-blue-600 shadow-md' : 'hover:bg-white/5'}`}
                                     >
                                         <span>{l.flag}</span> {l.label}
                                     </button>
                                 ))}
                             </div>

                             {lang === 'en' && (
                                 <div className="flex gap-2">
                                     <button onClick={() => setRepoType('basic')} className={`flex-1 py-2 text-xs font-bold rounded-lg border ${repoType === 'basic' ? 'bg-white/20 border-white/40' : 'border-transparent opacity-50'}`}>Basic</button>
                                     <button onClick={() => setRepoType('advanced')} className={`flex-1 py-2 text-xs font-bold rounded-lg border ${repoType === 'advanced' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'border-transparent opacity-50'}`}>Advanced (3000)</button>
                                 </div>
                             )}
                         </div>

                         <div className="space-y-3">
                             {Object.entries(topics).map(([key, topic]) => {
                                 let learned = 0;
                                 topic.words.forEach(w => {
                                     const k = getWordKey(w);
                                     if(srsData[k] || mastered[k]) learned++;
                                 });
                                 const pct = topic.words.length ? Math.round((learned / topic.words.length) * 100) : 0;
                                 
                                 return (
                                     <div 
                                        key={key} 
                                        onClick={() => { setCurrentTopicKey(key); setView('home'); playSound('pop', config.muted); }}
                                        className={`glass-panel p-4 rounded-xl cursor-pointer transition-all active:scale-95 hover:bg-white/10 ${currentTopicKey === key ? 'border-blue-400 bg-blue-500/10' : ''}`}
                                     >
                                         <div className="flex justify-between items-center mb-2">
                                             <h4 className="font-bold">{topic.name}</h4>
                                             {currentTopicKey === key && <i className="fas fa-check-circle text-blue-400"></i>}
                                         </div>
                                         <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                             <div className="h-full bg-green-400 transition-all duration-500" style={{ width: `${pct}%` }}></div>
                                         </div>
                                         <div className="flex justify-between text-xs mt-1 opacity-60">
                                             <span>{topic.words.length} words</span>
                                             <span>{pct}%</span>
                                         </div>
                                     </div>
                                 );
                             })}
                         </div>
                     </div>
                 )}

                 {view === 'leaderboard' && (
                     <div className="space-y-6">
                         <div className="text-center">
                             <h2 className="text-2xl font-bold text-yellow-400 drop-shadow-md"><i className="fas fa-crown"></i> Leaderboard</h2>
                             <p className="text-sm opacity-60">{LANGS[lang].label} Division</p>
                         </div>
                         
                         <div className="flex justify-center items-end gap-2 pb-4 h-48">
                             {leaderboard[1] && (
                                 <div className="flex flex-col items-center animate-slideUp" style={{animationDelay:'0.1s'}}>
                                     <img src={leaderboard[1].photoURL} className="w-12 h-12 rounded-full border-2 border-slate-300 shadow-lg mb-[-10px] z-10" />
                                     <div className="w-20 h-24 bg-slate-400/20 backdrop-blur-md border-t-2 border-slate-400 rounded-t-lg flex flex-col items-center pt-4">
                                         <span className="font-bold text-2xl opacity-50">2</span>
                                         <span className="text-xs font-bold truncate w-16 text-center">{leaderboard[1].displayName.split(' ')[0]}</span>
                                         <span className="text-xs bg-black/30 px-2 rounded mt-1">{leaderboard[1].score}</span>
                                     </div>
                                 </div>
                             )}
                             {leaderboard[0] && (
                                 <div className="flex flex-col items-center z-20 animate-slideUp">
                                     <i className="fas fa-crown text-yellow-400 mb-[-10px] text-xl animate-float"></i>
                                     <img src={leaderboard[0].photoURL} className="w-16 h-16 rounded-full border-4 border-yellow-400 shadow-xl shadow-yellow-400/20 mb-[-15px] z-10" />
                                     <div className="w-24 h-32 bg-yellow-500/20 backdrop-blur-md border-t-2 border-yellow-400 rounded-t-lg flex flex-col items-center pt-6">
                                         <span className="font-bold text-3xl opacity-50 text-yellow-200">1</span>
                                         <span className="text-sm font-bold truncate w-20 text-center">{leaderboard[0].displayName.split(' ')[0]}</span>
                                         <span className="text-xs bg-yellow-600 px-2 rounded mt-1 font-bold">{leaderboard[0].score}</span>
                                     </div>
                                 </div>
                             )}
                             {leaderboard[2] && (
                                 <div className="flex flex-col items-center animate-slideUp" style={{animationDelay:'0.2s'}}>
                                     <img src={leaderboard[2].photoURL} className="w-12 h-12 rounded-full border-2 border-orange-400 shadow-lg mb-[-10px] z-10" />
                                     <div className="w-20 h-20 bg-orange-600/20 backdrop-blur-md border-t-2 border-orange-500 rounded-t-lg flex flex-col items-center pt-4">
                                         <span className="font-bold text-2xl opacity-50">3</span>
                                         <span className="text-xs font-bold truncate w-16 text-center">{leaderboard[2].displayName.split(' ')[0]}</span>
                                         <span className="text-xs bg-black/30 px-2 rounded mt-1">{leaderboard[2].score}</span>
                                     </div>
                                 </div>
                             )}
                         </div>

                         <div className="glass-panel rounded-2xl overflow-hidden">
                             {leaderboard.slice(3).map((u, idx) => (
                                 <div key={u.id} className="flex items-center p-3 border-b border-white/5 last:border-0 hover:bg-white/5">
                                     <span className="w-8 text-center font-bold text-slate-500">{idx + 4}</span>
                                     <img src={u.photoURL} className="w-8 h-8 rounded-full border border-white/20 mx-3" />
                                     <div className="flex-1">
                                         <div className="font-bold text-sm">{u.displayName}</div>
                                         <div className="text-xs opacity-50">{formatTime(u.studyTime)}</div>
                                     </div>
                                     <div className="font-bold text-green-400">{u.score}</div>
                                 </div>
                             ))}
                             {leaderboard.length === 0 && <div className="p-8 text-center opacity-50">Be the first to join the arena!</div>}
                         </div>
                     </div>
                 )}

                 {view === 'settings' && (
                     <div className="space-y-6">
                         <h2 className="text-2xl font-bold">Settings</h2>
                         
                         <div className="glass-panel p-6 rounded-2xl">
                             <div className="flex items-center gap-4 mb-6">
                                 <img src={user.photoURL || ''} className="w-16 h-16 rounded-full border-2 border-white" />
                                 <div>
                                     <div className="font-bold text-lg">{user.displayName}</div>
                                     <button onClick={logoutGoogle} className="text-xs text-red-400 hover:text-red-300 font-bold">LOGOUT</button>
                                 </div>
                             </div>

                             <div className="space-y-4">
                                 <div>
                                     <div className="flex justify-between mb-1">
                                         <span className="text-sm font-bold">New Words / Day</span>
                                         <span className="text-sm font-bold text-blue-400">{config.newLimit}</span>
                                     </div>
                                     <input 
                                        type="range" min="3" max="20" 
                                        value={config.newLimit} 
                                        onChange={(e) => setConfig({...config, newLimit: parseInt(e.target.value)})}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                     />
                                 </div>
                                 <div>
                                     <div className="flex justify-between mb-1">
                                         <span className="text-sm font-bold">Review Limit</span>
                                         <span className="text-sm font-bold text-purple-400">{config.reviewLimit}</span>
                                     </div>
                                     <input 
                                        type="range" min="5" max="50" 
                                        value={config.reviewLimit} 
                                        onChange={(e) => setConfig({...config, reviewLimit: parseInt(e.target.value)})}
                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                     />
                                 </div>
                             </div>
                             
                             <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center">
                                 <span>Sound Effects</span>
                                 <button onClick={() => setConfig({...config, muted: !config.muted})} className={`w-12 h-6 rounded-full relative transition-colors ${!config.muted ? 'bg-green-500' : 'bg-slate-600'}`}>
                                     <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${!config.muted ? 'left-7' : 'left-1'}`}></div>
                                 </button>
                             </div>
                         </div>
                     </div>
                 )}

             </main>

             <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[95%] max-w-md glass-panel rounded-full h-16 flex items-center justify-around z-50 shadow-2xl bg-slate-900/80">
                 {['home', 'leaderboard', 'library', 'settings'].map((tab) => (
                     <button 
                        key={tab} 
                        onClick={() => setView(tab as any)}
                        className={`flex flex-col items-center justify-center w-12 h-12 rounded-full transition-all ${view === tab ? 'text-blue-400 -translate-y-2 scale-110' : 'text-slate-500 hover:text-slate-300'}`}
                     >
                         <i className={`fas fa-${tab === 'home' ? 'home' : tab === 'leaderboard' ? 'trophy' : tab === 'library' ? 'book' : 'sliders-h'} text-xl`}></i>
                     </button>
                 ))}
             </div>

             {gameSession.active && (
                 <GameEngine 
                    mode={gameSession.mode}
                    queue={gameSession.queue}
                    config={config}
                    lang={lang}
                    onComplete={(res) => {
                        setGameSession(prev => ({ ...prev, active: false }));
                        alert("Session Completed! Great job!");
                    }}
                    onClose={() => setGameSession(prev => ({ ...prev, active: false }))}
                    onUpdateSRS={handleSRSUpdate}
                    markMastered={markMastered}
                 />
             )}
        </div>
    );
};

// --- RENDER ---
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
