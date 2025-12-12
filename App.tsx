import React, { useState, useEffect, useRef, useCallback } from 'react';
import { auth, db, loginGoogle, logoutGoogle, fetchTopics, getImageUrl, preloadImage } from './services';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
import { Word, Topic, SRSData, UserConfig, GameMode } from './types';
import confetti from 'canvas-confetti';

// --- Components ---
const GlassButton: React.FC<{ onClick?: () => void; children: React.ReactNode; className?: string; disabled?: boolean }> = ({ onClick, children, className = "", disabled }) => (
  <button 
    onClick={onClick} 
    disabled={disabled}
    className={`glass-panel px-6 py-3 rounded-2xl font-bold active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/20'} ${className}`}
  >
    {children}
  </button>
);

const TabItem: React.FC<{ active: boolean; icon: string; label: string; onClick: () => void }> = ({ active, icon, label, onClick }) => (
  <div onClick={onClick} className={`flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${active ? 'text-sky-400 -translate-y-1' : 'text-slate-400'}`}>
    <i className={`fas ${icon} text-xl mb-1 ${active ? 'drop-shadow-[0_0_10px_rgba(56,189,248,0.8)]' : ''}`}></i>
    <span className="text-xs font-semibold">{label}</span>
  </div>
);

// --- Main App ---
const App: React.FC = () => {
  // State
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'home' | 'leaderboard' | 'library' | 'settings'>('home');
  const [lang, setLang] = useState<'en' | 'id'>('en');
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [topics, setTopics] = useState<Record<string, Topic>>({});
  const [currentTopicKey, setCurrentTopicKey] = useState<string>('');
  const [srsData, setSrsData] = useState<Record<string, SRSData>>({});
  const [mastered, setMastered] = useState<Record<string, boolean>>({});
  
  // Stats
  const [points, setPoints] = useState(0);
  const [studyTime, setStudyTime] = useState(0);
  
  // Config
  const [config, setConfig] = useState<UserConfig>({
    newLimit: 5,
    reviewLimit: 20,
    darkMode: true,
    muted: false,
    repoSource: 'basic'
  });

  // Game State
  const [gameMode, setGameMode] = useState<GameMode | null>(null);
  const [queue, setQueue] = useState<Word[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  
  // Refs for timers/audio
  const timerRef = useRef<any>(null);

  // --- Effects ---
  
  // Auth & Sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await syncUserData(u.uid);
      }
    });
    return () => unsub();
  }, [lang]); // Re-sync when language changes to load correct SRS data

  // Load Topics on Init/Lang/Source Change
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await fetchTopics(lang, config.repoSource);
      setTopics(data);
      
      // Select first topic if none selected or invalid
      if (!currentTopicKey || !data[currentTopicKey]) {
        const first = Object.keys(data)[0];
        if (first) setCurrentTopicKey(first);
      }
      setLoading(false);
    };
    load();
  }, [lang, config.repoSource]);

  // Preload Images for Flashcard
  useEffect(() => {
    if (gameMode === 'flashcard_all' || gameMode === 'smart') {
      // Preload next 3
      for (let i = 1; i <= 3; i++) {
        if (queue[qIndex + i]) {
          preloadImage(getImageUrl(queue[qIndex + i].english));
        }
      }
    }
  }, [qIndex, queue, gameMode]);

  // Study Timer
  useEffect(() => {
    if (gameMode && !timerRef.current) {
        timerRef.current = setInterval(() => {
            setStudyTime(prev => {
                const newVal = prev + 1;
                if (newVal % 60 === 0) saveProgress(newVal, points); // Save every minute
                return newVal;
            });
        }, 1000);
    } else if (!gameMode && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        saveProgress(studyTime, points);
    }
    return () => clearInterval(timerRef.current);
  }, [gameMode]);

  // --- Helpers ---

  const getKey = (w: Word) => `${w.english}_${lang}`.toLowerCase().replace(/\s/g, '');

  const syncUserData = async (uid: string) => {
    const docRef = doc(db, 'leaderboard', uid);
    const snap = await getDoc(docRef);
    
    if (snap.exists()) {
      const data = snap.data();
      setPoints(data.scores?.[lang] || 0); // Load lang specific score if avail, else 0
      setStudyTime(data.studyTime || 0);
      
      const srsKey = `srs_${lang}`;
      const masterKey = `mastered_${lang}`;
      
      if (data[srsKey]) setSrsData(JSON.parse(data[srsKey]));
      if (data[masterKey]) setMastered(JSON.parse(data[masterKey]));
      if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
    }
  };

  const saveProgress = async (timeVal = studyTime, scoreVal = points) => {
    if (!user) return;
    const srsKey = `srs_${lang}`;
    const masterKey = `mastered_${lang}`;
    
    // Update global score and lang specific score
    // We can't atomic increment deep fields easily without dot notation, so we read-modify-write
    // For simplicity in this demo, we assume we have the latest state
    
    await setDoc(doc(db, 'leaderboard', user.uid), {
      displayName: user.displayName,
      photoURL: user.photoURL,
      studyTime: timeVal,
      scores: {
         [lang]: scoreVal // Update specific lang score
      },
      // Keep global score as sum? Let's just store specific for now and sum on read if needed, or update a 'totalScore' field
      score: scoreVal, // Legacy global score support
      [srsKey]: JSON.stringify(srsData),
      [masterKey]: JSON.stringify(mastered),
      config,
      lastUpdated: Date.now()
    }, { merge: true });
  };

  const playSound = (type: 'correct' | 'wrong' | 'win' | 'pop') => {
    if (config.muted) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    
    const now = ctx.currentTime;
    if (type === 'correct') {
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      g.gain.setValueAtTime(0.1, now);
      g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'wrong') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.2);
      g.gain.setValueAtTime(0.1, now);
      g.gain.linearRampToValueAtTime(0.01, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);
    } else {
       osc.frequency.setValueAtTime(800, now);
       g.gain.setValueAtTime(0.05, now);
       g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
       osc.start(now); osc.stop(now + 0.1);
    }
  };

  const speak = (text: string) => {
    if (config.muted) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-US' : 'id-ID';
    window.speechSynthesis.speak(u);
  };

  // --- Game Logic ---

  const startGame = (mode: GameMode) => {
    if (!currentTopicKey || !topics[currentTopicKey]) return;
    const allWords = topics[currentTopicKey].words;
    
    let selected: Word[] = [];

    if (mode === 'flashcard_all') {
      selected = [...allWords];
    } else if (mode === 'smart') {
        // Smart Logic: New + Due Reviews
        const now = Date.now();
        const due = allWords.filter(w => {
            const k = getKey(w);
            return srsData[k] && srsData[k].nextReview <= now && !mastered[k];
        });
        const newWords = allWords.filter(w => {
            const k = getKey(w);
            return !srsData[k] && !mastered[k];
        }).slice(0, config.newLimit);
        
        selected = [...due, ...newWords];
        if (selected.length === 0 && due.length === 0) {
             alert("Bạn đã hoàn thành bài học hôm nay! Hãy thử ôn tập các từ đã học.");
             return;
        }
    } else {
      // For specific games (Quiz, Fill, etc.), ONLY use learned words
      const learned = allWords.filter(w => {
          const k = getKey(w);
          return (srsData[k] || mastered[k]);
      });
      
      if (learned.length < 4) {
          alert("Cần ít nhất 4 từ đã học để chơi chế độ này!");
          return;
      }
      selected = learned.sort(() => Math.random() - 0.5).slice(0, 20);
    }

    if (selected.length === 0) {
         alert("Không có từ nào khả dụng.");
         return;
    }

    // Shuffle
    if (mode !== 'smart') selected.sort(() => Math.random() - 0.5);

    setQueue(selected);
    setQIndex(0);
    setGameMode(mode);
    setIsFlipped(false);
  };

  const handleResult = (success: boolean) => {
    const w = queue[qIndex];
    const k = getKey(w);
    let data = srsData[k] || { level: 0, interval: 0, nextReview: 0, consecutiveWrongs: 0 };

    if (success) {
        playSound('correct');
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
        setPoints(p => p + 10);
        
        data.consecutiveWrongs = 0;
        data.level += 1;
        data.interval = data.level === 1 ? 1 : Math.ceil(data.interval * 2.5);
        data.nextReview = Date.now() + (data.interval * 24 * 60 * 60 * 1000);
    } else {
        playSound('wrong');
        data.consecutiveWrongs += 1;
        data.level = 0;
        data.interval = 0;
        data.nextReview = Date.now();
    }

    setSrsData(prev => ({ ...prev, [k]: data }));

    setTimeout(() => {
        if (qIndex < queue.length - 1) {
            setQIndex(i => i + 1);
            setIsFlipped(false);
        } else {
            playSound('win');
            setGameMode(null);
            saveProgress();
        }
    }, 1000);
  };

  // --- Views ---

  const renderHome = () => {
    if (!user) return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in zoom-in duration-500">
         <i className="fas fa-meteor text-6xl text-sky-400 mb-6 animate-bounce"></i>
         <h1 className="text-4xl font-extrabold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-pink-400">Hihi Vocabulary</h1>
         <p className="mb-8 opacity-80">Học từ vựng siêu tốc với phương pháp lặp lại ngắt quãng & Gamification.</p>
         <GlassButton onClick={loginGoogle} className="bg-sky-500/20 hover:bg-sky-500/40 text-sky-200">
            <i className="fab fa-google"></i> Đăng nhập với Google
         </GlassButton>
      </div>
    );

    const topic = topics[currentTopicKey];
    let stats = { total: 0, learned: 0, percent: 0 };
    if (topic) {
        stats.total = topic.words.length;
        stats.learned = topic.words.filter(w => {
            const k = getKey(w);
            return srsData[k] || mastered[k];
        }).length;
        stats.percent = stats.total > 0 ? Math.round((stats.learned / stats.total) * 100) : 0;
    }

    return (
      <div className="p-4 pb-24 w-full max-w-lg mx-auto animate-in slide-in-from-right duration-300">
         {/* Header */}
         <div className="flex justify-between items-center mb-6">
            <div>
                <h2 className="text-xl font-bold">Xin chào, {user.displayName?.split(' ')[0]}</h2>
                <div className="text-xs opacity-70 flex gap-2 items-center">
                    <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-500/30 font-bold">{points} XP</span>
                    <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full border border-purple-500/30">
                        {Math.floor(studyTime / 60)}m đã học
                    </span>
                </div>
            </div>
            <img src={user.photoURL || ''} alt="Avt" className="w-10 h-10 rounded-full border-2 border-sky-400" />
         </div>

         {/* Current Topic Card */}
         <div className="glass-panel p-6 rounded-3xl mb-6 relative overflow-hidden group transition-all hover:bg-white/15">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl rotate-12 group-hover:rotate-0 transition-transform">
                <i className="fas fa-book"></i>
            </div>
            <div className="text-xs uppercase tracking-widest opacity-70 font-bold mb-1">Chủ đề hiện tại</div>
            <h3 className="text-2xl font-extrabold mb-4 truncate pr-8">{topic ? topic.name : 'Loading...'}</h3>
            
            {/* Repo Stats */}
            <div className="mb-4">
                <div className="flex justify-between text-xs mb-1 font-semibold">
                    <span>Tiến độ kho từ</span>
                    <span>{stats.percent}%</span>
                </div>
                <div className="w-full bg-black/20 rounded-full h-2">
                    <div className="bg-gradient-to-r from-green-400 to-emerald-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${stats.percent}%` }}></div>
                </div>
                <div className="flex gap-4 mt-2 text-xs opacity-80">
                    <div><i className="fas fa-database text-sky-400"></i> {stats.total} từ</div>
                    <div><i className="fas fa-check-circle text-green-400"></i> {stats.learned} đã học</div>
                </div>
            </div>

            <GlassButton onClick={() => startGame('smart')} className="w-full bg-gradient-to-r from-sky-500 to-blue-600 border-none shadow-sky-500/30 hover:shadow-sky-500/50">
               <i className="fas fa-rocket"></i> HỌC NGAY
            </GlassButton>
         </div>

         {/* Modes Grid */}
         <h3 className="font-bold text-lg mb-4 pl-2 border-l-4 border-sky-500">Chế độ luyện tập</h3>
         <div className="grid grid-cols-2 gap-3">
             <div onClick={() => startGame('flashcard_all')} className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/20 active:scale-95 transition-all h-28">
                 <i className="fas fa-clone text-3xl text-pink-400"></i>
                 <span className="font-bold text-sm">Flashcard</span>
             </div>
             <div onClick={() => startGame('quiz')} className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/20 active:scale-95 transition-all h-28">
                 <i className="fas fa-question-circle text-3xl text-yellow-400"></i>
                 <span className="font-bold text-sm">Trắc nghiệm</span>
             </div>
             <div onClick={() => startGame('fill')} className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/20 active:scale-95 transition-all h-28">
                 <i className="fas fa-keyboard text-3xl text-emerald-400"></i>
                 <span className="font-bold text-sm">Điền từ</span>
             </div>
             <div onClick={() => startGame('sentence')} className="glass-panel p-4 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/20 active:scale-95 transition-all h-28">
                 <i className="fas fa-sort-amount-down text-3xl text-purple-400"></i>
                 <span className="font-bold text-sm">Xếp câu</span>
             </div>
         </div>
      </div>
    );
  };

  const renderLeaderboard = () => {
    const [lbData, setLbData] = useState<any[]>([]);
    const [lbTab, setLbTab] = useState<'global' | 'en' | 'id'>('global');

    useEffect(() => {
        // Query global leaderboard
        const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(50));
        const unsub = onSnapshot(q, (snap) => {
            const users = snap.docs.map(d => d.data());
            setLbData(users);
        });
        return () => unsub();
    }, []);

    // Filter/Sort logic client side for language tabs (since we might lack complex indexes)
    const sortedData = [...lbData].sort((a, b) => {
        if (lbTab === 'global') return b.score - a.score;
        const scoreA = a.scores?.[lbTab] || 0;
        const scoreB = b.scores?.[lbTab] || 0;
        return scoreB - scoreA;
    });

    return (
        <div className="p-4 w-full max-w-lg mx-auto pb-24 h-full flex flex-col animate-in fade-in">
            <h2 className="text-center font-extrabold text-2xl mb-1 text-yellow-400 drop-shadow-md"><i className="fas fa-trophy"></i> Bảng Xếp Hạng</h2>
            <div className="text-center text-xs opacity-70 mb-4">Cập nhật thời gian thực</div>

            {/* Filter Tabs */}
            <div className="flex bg-black/20 p-1 rounded-xl mb-4">
                <button onClick={() => setLbTab('global')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${lbTab === 'global' ? 'bg-white text-slate-900 shadow-lg' : 'opacity-60'}`}>Chung</button>
                <button onClick={() => setLbTab('en')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${lbTab === 'en' ? 'bg-white text-slate-900 shadow-lg' : 'opacity-60'}`}>Tiếng Anh</button>
                <button onClick={() => setLbTab('id')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${lbTab === 'id' ? 'bg-white text-slate-900 shadow-lg' : 'opacity-60'}`}>Indo</button>
            </div>

            <div className="flex-1 overflow-y-auto hide-scrollbar space-y-2">
                {sortedData.map((u, idx) => {
                    const rank = idx + 1;
                    const isMe = user?.uid && u.photoURL === user.photoURL; // simple check
                    const displayScore = lbTab === 'global' ? u.score : (u.scores?.[lbTab] || 0);
                    
                    return (
                        <div key={idx} className={`flex items-center p-3 rounded-xl border border-white/5 ${isMe ? 'bg-sky-500/20 border-sky-400' : 'bg-white/5'}`}>
                            <div className={`w-8 font-bold text-center ${rank <= 3 ? 'text-yellow-400 text-xl' : 'opacity-50'}`}>
                                {rank <= 3 ? <i className="fas fa-crown"></i> : rank}
                            </div>
                            <img src={u.photoURL} className="w-10 h-10 rounded-full border border-white/20 mx-3" />
                            <div className="flex-1 min-w-0">
                                <div className="font-bold truncate text-sm">{u.displayName}</div>
                                <div className="text-xs opacity-60 uppercase font-semibold">Học giả</div>
                            </div>
                            <div className="font-bold text-emerald-400">{displayScore} XP</div>
                        </div>
                    )
                })}
            </div>
        </div>
    );
  };

  const renderLibrary = () => (
      <div className="p-4 pb-24 w-full max-w-lg mx-auto animate-in fade-in">
          <h2 className="text-2xl font-bold mb-6">Thư viện</h2>
          
          {/* Language / Source Config */}
          <div className="glass-panel p-4 rounded-xl mb-6">
              <div className="text-xs uppercase font-bold opacity-70 mb-3">Ngôn ngữ & Nguồn</div>
              <div className="flex gap-2 mb-3">
                  <button onClick={() => setLang('en')} className={`flex-1 p-2 rounded-lg border font-bold text-sm ${lang === 'en' ? 'bg-sky-500 border-sky-400' : 'border-white/20 opacity-50'}`}>
                      🇺🇸 Tiếng Anh
                  </button>
                  <button onClick={() => setLang('id')} className={`flex-1 p-2 rounded-lg border font-bold text-sm ${lang === 'id' ? 'bg-red-500 border-red-400' : 'border-white/20 opacity-50'}`}>
                      🇮🇩 Indo
                  </button>
              </div>

              {lang === 'en' && (
                  <div className="flex gap-2 bg-black/20 p-1 rounded-lg">
                      <button 
                        onClick={() => setConfig(p => ({...p, repoSource: 'basic'}))}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${config.repoSource === 'basic' ? 'bg-white text-black' : 'opacity-60'}`}
                      >
                          Cơ bản (Tuvung)
                      </button>
                      <button 
                        onClick={() => setConfig(p => ({...p, repoSource: 'advanced'}))}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${config.repoSource === 'advanced' ? 'bg-white text-black' : 'opacity-60'}`}
                      >
                          Nâng cao (3000tv)
                      </button>
                  </div>
              )}
          </div>

          <div className="space-y-3">
              {loading ? <div className="text-center p-4"><i className="fas fa-spinner fa-spin"></i> Đang tải...</div> : 
               Object.keys(topics).map(key => {
                   const t = topics[key];
                   const active = currentTopicKey === key;
                   return (
                       <div key={key} onClick={() => { setCurrentTopicKey(key); setView('home'); }} 
                            className={`glass-panel p-4 rounded-xl cursor-pointer border-l-4 transition-all ${active ? 'border-sky-400 bg-white/10' : 'border-transparent hover:bg-white/5'}`}>
                           <div className="font-bold">{t.name}</div>
                           <div className="text-xs opacity-60 mt-1">{t.words.length} thẻ từ</div>
                       </div>
                   )
               })
              }
          </div>
      </div>
  );

  const renderGame = () => {
    if (!gameMode || !queue[qIndex]) return null;
    const w = queue[qIndex];
    const illustration = getImageUrl(w.english);

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in zoom-in duration-300">
            {/* Header */}
            <div className="w-full max-w-lg flex justify-between items-center mb-4 text-white">
                <button onClick={() => setGameMode(null)} className="text-2xl opacity-70 hover:opacity-100"><i className="fas fa-times"></i></button>
                <div className="flex-1 mx-4 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: `${(qIndex / queue.length) * 100}%` }}></div>
                </div>
                <div className="font-bold">{qIndex + 1}/{queue.length}</div>
            </div>

            {/* Content Area */}
            <div className="flex-1 w-full max-w-lg flex items-center justify-center perspective-[1000px]">
                
                {/* FLASHCARD UI */}
                {(gameMode === 'flashcard_all' || gameMode === 'smart') && (
                    <div 
                      onClick={() => { setIsFlipped(!isFlipped); playSound('pop'); }}
                      className={`relative w-full aspect-[3/4] max-h-[500px] cursor-pointer card-flip ${isFlipped ? 'card-flipped' : ''}`}
                    >
                        {/* Front */}
                        <div className="absolute inset-0 bg-white text-slate-800 rounded-3xl shadow-2xl p-6 flex flex-col items-center justify-between backface-hidden border-4 border-white">
                             <div className="w-full rounded-2xl overflow-hidden shadow-inner bg-slate-100 aspect-video mb-4 relative">
                                 <img src={illustration} alt="Illustration" className="w-full h-full object-cover" loading="eager" />
                                 <div className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur">AI Generated</div>
                             </div>
                             <div className="text-center mt-2">
                                 <h2 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-blue-600 to-indigo-600 mb-2">{w.english}</h2>
                                 <p className="font-serif italic text-slate-500 text-lg">{w.ipa}</p>
                             </div>
                             <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-4">Chạm để lật</div>
                        </div>

                        {/* Back */}
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-3xl shadow-2xl p-8 flex flex-col items-center justify-center text-center backface-hidden rotate-y-180 border border-white/20">
                             <h3 className="text-3xl font-bold mb-6 text-emerald-400">{w.vietnamese}</h3>
                             <div className="w-full h-px bg-white/20 mb-6"></div>
                             <p className="italic opacity-80 text-lg">"{w.example}"</p>
                             <button onClick={(e) => { e.stopPropagation(); speak(w.english); }} className="mt-8 w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-2xl">
                                 <i className="fas fa-volume-up"></i>
                             </button>
                        </div>
                    </div>
                )}

                {/* QUIZ UI */}
                {gameMode === 'quiz' && (
                    <div className="w-full space-y-4">
                        <div className="text-center mb-8">
                            <h2 className="text-4xl font-extrabold mb-4">{w.english}</h2>
                            <button onClick={() => speak(w.english)} className="text-sky-400 text-2xl animate-pulse"><i className="fas fa-volume-up"></i></button>
                        </div>
                        <div className="grid gap-3">
                            {/* Generate random options (mock logic for brevity - in real app, mix with other words) */}
                            {[w, ...queue.filter(x => x !== w).slice(0, 3)].sort(() => Math.random() - 0.5).map((opt, i) => (
                                <button key={i} onClick={() => handleResult(opt === w)} 
                                  className="glass-panel p-4 rounded-xl font-bold text-lg hover:bg-white/20 active:bg-sky-500 transition-colors">
                                    {opt.vietnamese}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                 {/* FILL UI */}
                 {gameMode === 'fill' && (
                    <div className="w-full text-center">
                        <div className="text-xl mb-8 font-serif italic">"{w.example?.replace(new RegExp(w.english, 'gi'), '_____') || `The word is _____`}"</div>
                        <div className="text-emerald-400 font-bold mb-6">Nghĩa: {w.vietnamese}</div>
                        <input 
                           autoFocus
                           className="w-full bg-transparent border-b-2 border-white/30 text-center text-2xl py-2 focus:border-sky-400 outline-none mb-8"
                           placeholder="Nhập từ còn thiếu..."
                           onKeyDown={(e) => {
                               if (e.key === 'Enter') {
                                   handleResult((e.currentTarget.value.toLowerCase().trim()) === w.english.toLowerCase());
                                   e.currentTarget.value = '';
                               }
                           }}
                        />
                        <button onClick={() => speak(w.english)} className="w-12 h-12 rounded-full bg-white/10"><i className="fas fa-volume-up"></i></button>
                    </div>
                )}

            </div>

            {/* Controls (Flashcard Only) */}
            {(gameMode === 'flashcard_all' || gameMode === 'smart') && (
                <div className="w-full max-w-lg flex gap-4 mt-6">
                    <button onClick={() => handleResult(false)} className="flex-1 py-4 rounded-2xl bg-red-500/20 border border-red-500/50 text-red-400 font-bold text-lg active:scale-95 transition-transform">
                        <i className="fas fa-times mr-2"></i> Chưa thuộc
                    </button>
                    <button onClick={() => handleResult(true)} className="flex-1 py-4 rounded-2xl bg-green-500/20 border border-green-500/50 text-green-400 font-bold text-lg active:scale-95 transition-transform">
                        Đã thuộc <i className="fas fa-check ml-2"></i>
                    </button>
                </div>
            )}
        </div>
    );
  };

  return (
    <div className={`min-h-screen ${config.darkMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-900'} font-sans relative overflow-hidden transition-colors duration-500`}>
      {/* Backgrounds */}
      <div className="fixed inset-0 aurora-bg opacity-30 pointer-events-none"></div>
      <div id="particles" className="fixed inset-0 pointer-events-none"></div>

      {/* Main Content Area */}
      <div className="relative z-10 h-screen flex flex-col">
          <div className="flex-1 overflow-y-auto hide-scrollbar">
              {view === 'home' && renderHome()}
              {view === 'leaderboard' && renderLeaderboard()}
              {view === 'library' && renderLibrary()}
              {view === 'settings' && (
                  <div className="p-8 text-center pt-20">
                      <h2 className="text-2xl font-bold mb-8">Cài đặt</h2>
                      <div className="space-y-4">
                          <div className="glass-panel p-4 rounded-xl flex justify-between items-center">
                              <span>Chế độ tối</span>
                              <button onClick={() => setConfig(c => ({...c, darkMode: !c.darkMode}))} className="text-2xl">
                                  {config.darkMode ? <i className="fas fa-toggle-on text-sky-400"></i> : <i className="fas fa-toggle-off opacity-50"></i>}
                              </button>
                          </div>
                          <div className="glass-panel p-4 rounded-xl flex justify-between items-center">
                              <span>Âm thanh</span>
                              <button onClick={() => setConfig(c => ({...c, muted: !c.muted}))} className="text-2xl">
                                  {!config.muted ? <i className="fas fa-volume-up text-green-400"></i> : <i className="fas fa-volume-mute text-red-400"></i>}
                              </button>
                          </div>
                          <GlassButton onClick={logoutGoogle} className="w-full bg-red-500/20 text-red-300 mt-8">Đăng xuất</GlassButton>
                      </div>
                  </div>
              )}
          </div>

          {/* Bottom Nav */}
          {user && !gameMode && (
              <div className="h-20 w-full glass-panel border-t border-white/10 flex justify-around items-center px-2 pb-2 z-20 shrink-0 rounded-t-3xl">
                  <TabItem active={view === 'home'} icon="fa-home" label="Home" onClick={() => setView('home')} />
                  <TabItem active={view === 'leaderboard'} icon="fa-trophy" label="Xếp hạng" onClick={() => setView('leaderboard')} />
                  <TabItem active={view === 'library'} icon="fa-book-open" label="Thư viện" onClick={() => setView('library')} />
                  <TabItem active={view === 'settings'} icon="fa-cog" label="Cài đặt" onClick={() => setView('settings')} />
              </div>
          )}
      </div>

      {/* Overlays */}
      {renderGame()}
    </div>
  );
};

export default App;
