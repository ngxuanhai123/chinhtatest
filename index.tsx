

// --- FIREBASE SETUP ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// FIX: Add declarations for window properties and global variables to satisfy TypeScript.
declare global {
    interface Window {
        loginGoogle: () => void;
        logoutGoogle: () => void;
        initLeaderboardListener: () => void;
        initApp: () => void;
        fetchTopics: (manual?: boolean) => Promise<void>;
        navTo: (viewId: string) => void;
        switchLanguageFamily: (family: string) => void;
        switchLanguage: (lang: string) => void;
        startSmartSession: () => void;
        processResult: (isCorrect: boolean) => void;
        flipCard: () => void;
        closeGame: () => void;
        nextStep: () => void;
        speakWord: (e?: Event) => void;
        markMastered: () => void;
        spellingTarget: string;
        spellingIdx: number;
        revealSpellingHint: () => void;
        sentenceState: {
            targetStr: string;
            originalMode: string;
        };
        moveWord: (idx: number, word: string) => void;
        checkSentence: (correctSentence: string) => void;
        resetSentence: () => void;
        speakText: (text: string) => void;
        showHint: (ans: string) => void;
        checkFill: (ans: string) => void;
        matchClick: (idx: number, id: number) => void;
        matchState: {
            selected: { idx: number; id: number; el: HTMLElement } | null;
            solved: number;
            total: number;
        };
        handleQuiz: (el: HTMLElement, isCorrect: boolean) => void;
        startGame: (mode: string) => void;
        openWordList: (type: string) => void;
        closeWordList: () => void;
        toastTimeout?: number;
        resetProgress: () => void;
        toggleTheme: () => void;
        toggleMute: () => void;
        saveConfig: () => void;
        webkitAudioContext: typeof AudioContext;
    }
}
declare const confetti: (options?: any) => void;

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

// Initialize Firebase
let app, auth, db, provider;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
} catch (e) {
    console.error("Firebase init error", e);
    // Continue running app in offline/limited mode if possible
}

/**
 * Safely parses JSON from localStorage, preventing errors from empty or invalid data.
 * @param {string} key The localStorage key to read.
 * @param {any} defaultValue The default value to return if parsing fails.
 * @returns {any} The parsed object or the default value.
 */
function safeJsonParse(key, defaultValue) {
    const item = localStorage.getItem(key);
    // Return default value if item is null, undefined, or an empty string
    if (!item) {
        return defaultValue;
    }
    try {
        return JSON.parse(item);
    } catch (e) {
        console.warn(`Could not parse JSON from localStorage for key "${key}". Using default.`, e);
        return defaultValue;
    }
}


let currentUser = null;
let studyTimer = null;
// FIX: Ensure the argument to parseInt is a string.
let accumulatedTime = parseInt(localStorage.getItem('fp_aurora_time') || '0', 10);
let unsubscribeLeaderboard = null; 

// --- HELPER: FORMAT TIME ---
function formatTime(seconds) {
    if(seconds < 60) return seconds + 's';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if(h > 0) return `${h}h${m}`;
    return `${m}m`;
}

// --- HELPER: RANK CALCULATION SYSTEM ---
function getRankInfo(score) {
    if (score >= 10000) return { title: 'HUYỀN THOẠI', color: '#ffd700', bg: 'rgba(255, 215, 0, 0.2)', icon: 'fas fa-dragon' };
    if (score >= 5000) return { title: 'ĐẠI SƯ', color: '#f87171', bg: 'rgba(248, 113, 113, 0.2)', icon: 'fas fa-chess-king' };
    if (score >= 2000) return { title: 'TINH ANH', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.2)', icon: 'fas fa-gem' };
    if (score >= 500) return { title: 'HỌC GIẢ', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.2)', icon: 'fas fa-book-reader' };
    return { title: 'TẬP SỰ', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.2)', icon: 'fas fa-seedling' };
}

// --- LANGUAGE/REPO CONFIG ---
const LANG_CONFIG = {
    en: { 
        repo: 'tuvung',
        user: 'ngxuanhai123',
        label: 'Tiếng Anh (Cơ bản)', 
        tts: 'en-US', 
        transPair: 'en|vi',
        flag: '🇺🇸'
    },
    en_adv: {
        repo: '3000tv',
        user: 'ngxuanhai123',
        label: 'Tiếng Anh (Nâng cao)',
        tts: 'en-US',
        transPair: 'en|vi',
        flag: '🇬🇧'
    },
    id: { 
        repo: 'indo',
        user: 'ngxuanhai123',
        label: 'Indonesia', 
        tts: 'id-ID', 
        transPair: 'id|vi',
        flag: '🇮🇩'
    }
};
let currentLang = localStorage.getItem('fp_aurora_lang') || 'en';

// --- DATA KEY HELPERS ---
function getDataKey(prefix) {
    return prefix + '_' + currentLang;
}

// --- FIREBASE FUNCTIONS ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.loginGoogle = () => {
    if(!auth) { showToast("Lỗi kết nối máy chủ", "error"); return; }
    signInWithPopup(auth, provider)
    .then((result) => {
        showToast("Đăng nhập thành công!", "success");
    }).catch((error) => {
        console.error("Login Error:", error);
        showToast("Lỗi đăng nhập: " + error.message, "error");
    });
};

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.logoutGoogle = () => {
    if(!auth) return;
    if(confirm("Bạn muốn đăng xuất?")) {
        signOut(auth).then(() => {
            showToast("Đã đăng xuất");
            accumulatedPoints = 0; 
            updateUserPointsUI();
            
            // Still allow access after logout
            document.getElementById('btnLogin').style.display = 'block';
            document.getElementById('userProfile').style.display = 'none';
        });
    }
};

if(auth) {
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        const btn = document.getElementById('btnLogin');
        const profile = document.getElementById('userProfile');
        const dash = document.getElementById('dashboardContent');
        const reqMsg = document.getElementById('requireLoginMsg');
        
        if (user) {
            btn.style.display = 'none';
            profile.style.display = 'flex';
            
            // FIX: Cast element to HTMLImageElement to access 'src' property.
            (document.getElementById('userImg') as HTMLImageElement).src = user.photoURL;
            document.getElementById('userName').innerText = user.displayName;
            await syncDataFromServer();
            saveProgressToCloud(); 
        } else {
            // GUEST MODE: Allow access
            btn.style.display = 'block';
            profile.style.display = 'none';
            
            // Ensure data is rendered from local storage
            renderDashboard();
        }
        
        // Always show dashboard, never block
        reqMsg.style.display = 'none';
        dash.style.display = 'block';
    });
}

// --- LOGIC ĐỒNG BỘ TOÀN DIỆN (FULL SYNC) ---
async function syncDataFromServer() {
    if(!currentUser || !db) return;
    try {
        const docRef = doc(db, "leaderboard", currentUser.uid);
        const docSnap = await getDoc(docRef);
        
        const currentMonthKey = new Date().getFullYear() + '-' + (new Date().getMonth() + 1);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            if (data.monthKey !== currentMonthKey) {
                accumulatedPoints = 0;
                // FIX: Ensure value passed to localStorage.setItem is a string.
                localStorage.setItem('fp_aurora_points', '0');
                showToast("Chào tháng mới! Điểm đã được reset.", "info");
                await setDoc(docRef, { score: 0, monthKey: currentMonthKey }, { merge: true });
            } else {
                if (data.score > accumulatedPoints) accumulatedPoints = data.score;
                if (data.studyTime > accumulatedTime) accumulatedTime = data.studyTime;
            }
            
            // Sync Language Specific Data
            const srsKey = `srsData_${currentLang}`;
            const masterKey = `masteredWords_${currentLang}`;
            const topicKey = `currentTopicKey_${currentLang}`;

            if(data[srsKey]) {
                srsData = JSON.parse(data[srsKey]);
                localStorage.setItem(getDataKey('fp_aurora_srs'), data[srsKey]);
            }
            if(data[masterKey]) {
                masteredWords = JSON.parse(data[masterKey]);
                localStorage.setItem(getDataKey('fp_aurora_mastered'), data[masterKey]);
            }
            if(data[topicKey]) {
                currentTopicKey = data[topicKey];
                localStorage.setItem(getDataKey('fp_aurora_topic'), currentTopicKey);
            }

            if(data.config) {
                config = data.config;
                // FIX: Ensure value passed to localStorage.setItem is a string.
                localStorage.setItem('fp_aurora_dark', String(config.darkMode));
                // FIX: Ensure value passed to localStorage.setItem is a string.
                localStorage.setItem('fp_aurora_muted', String(config.muted));
                // FIX: Ensure value passed to localStorage.setItem is a string.
                localStorage.setItem('fp_aurora_cfg_new', String(config.newLimit));
                // FIX: Ensure value passed to localStorage.setItem is a string.
                localStorage.setItem('fp_aurora_cfg_review', String(config.reviewLimit));
                applyTheme();
                updateMuteIcon();
                updateConfigUI();
            }

            // FIX: Ensure value passed to localStorage.setItem is a string.
            localStorage.setItem('fp_aurora_points', String(accumulatedPoints));
            // FIX: Ensure value passed to localStorage.setItem is a string.
            localStorage.setItem('fp_aurora_time', String(accumulatedTime));
            updateUserPointsUI();
            renderDashboard();
        }
    } catch (e) {
        console.error("Error syncing from server:", e);
    }
}

async function saveProgressToCloud() {
    if(!currentUser || !db) return;
    const currentMonthKey = new Date().getFullYear() + '-' + (new Date().getMonth() + 1);
    
    // Dynamic keys based on language
    const srsKey = `srsData_${currentLang}`;
    const masterKey = `masteredWords_${currentLang}`;
    const topicKey = `currentTopicKey_${currentLang}`;

    try {
        await setDoc(doc(db, "leaderboard", currentUser.uid), {
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            score: accumulatedPoints,
            studyTime: accumulatedTime,
            lastUpdated: Date.now(),
            monthKey: currentMonthKey,
            [srsKey]: JSON.stringify(srsData),
            [masterKey]: JSON.stringify(masteredWords),
            config: config,
            [topicKey]: currentTopicKey
        }, { merge: true });
    } catch(e) {
        console.error("Error saving progress to cloud", e);
    }
}

// --- NEW LEADERBOARD LOGIC (REAL-TIME SNAPSHOT) ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.initLeaderboardListener = () => {
    if (unsubscribeLeaderboard || !db) return;

    const listDiv = document.getElementById('leaderboardList');
    const podiumDiv = document.getElementById('podiumContainer');
    listDiv.innerHTML = '<div style="text-align:center; padding:30px; opacity:0.7;"><i class="fas fa-spinner fa-spin"></i> Đang kết nối máy chủ...</div>';

    const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(20));
    
    unsubscribeLeaderboard = onSnapshot(q, (querySnapshot) => {
        const users = [];
        querySnapshot.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

        if (users.length === 0) {
             listDiv.innerHTML = '<div style="text-align:center; padding:20px;">Chưa có dữ liệu. Hãy là người đầu tiên!</div>';
             podiumDiv.style.display = 'none';
             return;
        }

        let podiumHTML = '';
        if(users.length > 0) {
            podiumDiv.style.display = 'flex';
            const order = [1, 0, 2];
            order.forEach(idx => {
                if(!users[idx]) return;
                const u = users[idx];
                const rank = idx + 1;
                let avatarHTML = `<img src="${u.photoURL}" class="podium-avatar">`;
                if(rank === 1) avatarHTML = `<i class="fas fa-crown crown-icon"></i>` + avatarHTML;
                
                podiumHTML += `
                    <div class="podium-item rank-${rank}-stage animate__animated animate__fadeInUp">
                        ${avatarHTML}
                        <div class="podium-name">${u.displayName ? u.displayName.split(' ')[0] : 'User'}</div>
                        <div class="podium-score">${u.score.toLocaleString()} XP</div>
                        <div class="podium-rank">${rank}</div>
                    </div>
                `;
            });
            podiumDiv.innerHTML = podiumHTML;
        }

        let listHTML = '';
        users.forEach((u, index) => {
            const rank = index + 1;
            if (rank <= 3) return;

            const isMe = currentUser && u.id === currentUser.uid ? 'background:rgba(59, 130, 246, 0.15); border-left: 3px solid #60a5fa;' : '';
            const rankObj = getRankInfo(u.score);

            listHTML += `
                <div class="leaderboard-row animate__animated animate__fadeIn" style="${isMe}">
                    <div class="rank-num">${rank}</div>
                    <img src="${u.photoURL}" class="lb-avatar">
                    <div class="lb-info">
                        <div class="lb-name">${u.displayName}</div>
                        <div class="lb-meta">
                            <span class="rank-badge" style="color:${rankObj.color}; background:${rankObj.bg}; border-color:${rankObj.color}">
                                <i class="${rankObj.icon}"></i> ${rankObj.title}
                            </span>
                        </div>
                    </div>
                    <div class="lb-stats">
                        <div class="lb-score">${u.score.toLocaleString()}</div>
                        <div class="lb-time">${formatTime(u.studyTime || 0)}</div>
                    </div>
                </div>
            `;
        });
        listDiv.innerHTML = listHTML || '<div style="text-align:center; padding:20px; opacity:0.6; font-size:0.8rem;">Chưa có thêm người chơi khác</div>';
    }, (error) => {
        console.error("Realtime Error:", error);
        listDiv.innerHTML = '<div style="text-align:center; color:#ff5252">Mất kết nối thời gian thực.</div>';
    });
};

/* -------------------------------------------------------------------------
   APP LOGIC & AUDIO ENGINE
   ------------------------------------------------------------------------- */

// FIX: Added window.webkitAudioContext to global declarations to handle vendor prefix.
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let masterGain = null;

function initAudio() {
    if(!masterGain) {
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
}

const SFX = { CORRECT: 'correct', WRONG: 'wrong', FLIP: 'flip', WIN: 'win', POP: 'pop' };

function playTone(freq, type, duration, startTime, vol=0.1) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration);
}

function playSound(sfx) {
    if(config.muted) return;
    initAudio();
    const now = audioCtx.currentTime;

    switch(sfx) {
        case SFX.CORRECT:
            playTone(523.25, 'sine', 0.4, now, 0.2);
            playTone(659.25, 'sine', 0.4, now + 0.1, 0.2);
            playTone(783.99, 'sine', 0.6, now + 0.2, 0.2);
            break;
        case SFX.WRONG:
            playTone(150, 'sawtooth', 0.4, now, 0.15);
            playTone(140, 'sawtooth', 0.4, now + 0.1, 0.15);
            break;
        case SFX.FLIP:
            playTone(800, 'triangle', 0.1, now, 0.05);
            break;
        case SFX.WIN:
            [523, 659, 783, 1046].forEach((f, i) => playTone(f, 'square', 0.6, now + i*0.1, 0.1));
            break;
        case SFX.POP:
             playTone(600, 'sine', 0.1, now, 0.1);
             break;
    }
}

// --- GLOBAL STATE ---
let allTopics = {};
let currentTopicKey = localStorage.getItem(getDataKey('fp_aurora_topic')) || '';

let srsData = safeJsonParse(getDataKey('fp_aurora_srs'), {});
let masteredWords = safeJsonParse(getDataKey('fp_aurora_mastered'), {});

// FIX: Ensure the argument to parseInt is a string.
let accumulatedPoints = parseInt(localStorage.getItem('fp_aurora_points') || '0', 10);

let config = {
    // FIX: Ensure the argument to parseInt is a string.
    newLimit: parseInt(localStorage.getItem('fp_aurora_cfg_new') || '5', 10),
    // FIX: Ensure the argument to parseInt is a string.
    reviewLimit: parseInt(localStorage.getItem('fp_aurora_cfg_review') || '20', 10),
    darkMode: localStorage.getItem('fp_aurora_dark') === 'true',
    muted: localStorage.getItem('fp_aurora_muted') === 'true'
};

let sessionQueue = []; 
let sessionIndex = 0;
let currentMode = '';
let isProcessing = false;
let isFlipped = false;
let selectedVoice = null;
const translationCache = safeJsonParse('fp_aurora_trans_cache', {});

async function getTranslation(text) {
    if (!text) return "";
    if (translationCache[text]) return translationCache[text];
    const pair = LANG_CONFIG[currentLang].transPair;
    try {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`);
        const data = await res.json();
        if(data.responseStatus === 200) {
            translationCache[text] = data.responseData.translatedText;
            localStorage.setItem('fp_aurora_trans_cache', JSON.stringify(translationCache));
            return data.responseData.translatedText;
        }
    } catch (e) { console.error("Translate error:", e); }
    return "Không thể dịch tự động.";
}

// --- INITIALIZATION ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.initApp = function() {
    createParticles();
    startSnow();
    applyTheme();
    updateConfigUI();
    updateLangUI();
    // FIX: Function is assigned to window property, which is handled by the global declaration.
    window.fetchTopics(); 
    document.getElementById('dashTime').innerText = formatTime(accumulatedTime);
    updateUserPointsUI();
    
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = setupVoice;
    }
    setTimeout(setupVoice, 1000);
    // FIX: Function is assigned to window property, which is handled by the global declaration.
    window.navTo('view-home');
    updateMuteIcon();
}

function updateLangUI() {
    document.querySelectorAll('.lang-opt').forEach(el => el.classList.remove('active'));
    // If en OR en_adv, highlight English button
    if(currentLang === 'en' || currentLang === 'en_adv') {
        document.getElementById('btn-lang-en').classList.add('active');
    } else {
        document.getElementById('btn-lang-id').classList.add('active');
    }
    
    // Update config inputs to reflect current language repo
    const conf = LANG_CONFIG[currentLang];
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    (document.getElementById('gh-repo') as HTMLInputElement).value = conf.repo;
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    (document.getElementById('gh-user') as HTMLInputElement).value = conf.user;
}

// Logic mới cho Home screen: chỉ chọn hệ ngôn ngữ
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.switchLanguageFamily = function(family) {
    if(family === 'en') {
        // Nếu đang ở EN hoặc EN_ADV thì giữ nguyên, nếu không thì default về 'en'
        if(currentLang !== 'en' && currentLang !== 'en_adv') {
            // FIX: Function is assigned to window property, which is handled by the global declaration.
            window.switchLanguage('en');
        }
    } else {
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.switchLanguage('id');
    }
    updateLangUI();
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.switchLanguage = function(lang) {
    if(currentLang === lang) return;
    
    currentLang = lang;
    localStorage.setItem('fp_aurora_lang', lang);
    updateLangUI();
    
    // Reload Data for new language
    currentTopicKey = localStorage.getItem(getDataKey('fp_aurora_topic')) || '';
    srsData = safeJsonParse(getDataKey('fp_aurora_srs'), {});
    masteredWords = safeJsonParse(getDataKey('fp_aurora_mastered'), {});
    
    playSound(SFX.POP);
    // FIX: Function is assigned to window property, which is handled by the global declaration.
    window.fetchTopics(); 
    
    // Try to sync to ensure we have latest data for this language
    syncDataFromServer();
}

function startSnow() {
    const snowInterval = setInterval(() => {
        const snowflake = document.createElement('div');
        snowflake.innerHTML = '❄';
        snowflake.classList.add('snowflake');
        snowflake.style.left = Math.random() * 100 + 'vw';
        const size = Math.random() * 10 + 10 + 'px'; 
        snowflake.style.fontSize = size;
        const duration = Math.random() * 5 + 5 + 's'; 
        snowflake.style.animationDuration = duration;
        snowflake.style.opacity = Math.random();
        document.body.appendChild(snowflake);
        setTimeout(() => { snowflake.remove(); }, parseFloat(duration) * 1000);
    }, 400); 
}

function updateUserPointsUI() {
    document.getElementById('userPointsDisplay').innerText = accumulatedPoints.toLocaleString();
}

function addPoints(amount) {
    accumulatedPoints += amount;
    // FIX: Ensure value passed to localStorage.setItem is a string.
    localStorage.setItem('fp_aurora_points', String(accumulatedPoints));
    updateUserPointsUI();
    saveProgressToCloud(); 
}

function createParticles() {
    const container = document.getElementById('particles');
    for(let i=0; i<15; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.width = Math.random() * 5 + 2 + 'px';
        p.style.height = p.style.width;
        p.style.animationDuration = Math.random() * 10 + 10 + 's';
        p.style.animationDelay = Math.random() * 5 + 's';
        container.appendChild(p);
    }
}

// --- NAVIGATION ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.navTo = function(viewId) {
    // FIX: Cast element to HTMLElement to access 'style' property.
    document.querySelectorAll('.view-container').forEach(el => (el as HTMLElement).style.display = 'none');
    const target = document.getElementById(viewId);
    target.style.display = 'block';
    target.classList.remove('animate__fadeIn');
    void target.offsetWidth; 
    target.classList.add('animate__fadeIn');
    
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${viewId}"]`)?.classList.add('active');

    if(viewId === 'view-home') renderDashboard();
    if(viewId === 'view-topics') renderTopicList();
    // FIX: Function is assigned to window property, which is handled by the global declaration.
    if(viewId === 'view-leaderboard') window.initLeaderboardListener(); 
}

// --- DATA & SYNC ---
// --- UPDATED FETCH TOPICS WITH PARALLEL LOADING ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.fetchTopics = async function(manual = false) {
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    let user = (document.getElementById('gh-user') as HTMLInputElement).value;
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    let repo = (document.getElementById('gh-repo') as HTMLInputElement).value;

    if(!manual) {
        const conf = LANG_CONFIG[currentLang];
        user = conf.user;
        repo = conf.repo;
        // FIX: Cast element to HTMLInputElement to access 'value' property.
        (document.getElementById('gh-user') as HTMLInputElement).value = user;
        // FIX: Cast element to HTMLInputElement to access 'value' property.
        (document.getElementById('gh-repo') as HTMLInputElement).value = repo;
    }

    const status = document.getElementById('status-msg');
    
    if(manual) {
        status.innerText = "Đang đồng bộ...";
        playSound(SFX.POP);
    }
    
    try {
        const api = `https://api.github.com/repos/${user}/${repo}/contents/`;
        const res = await fetch(api);
        if(!res.ok) throw new Error("Kết nối thất bại");
        
        const files = await res.json();
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        
        // --- PARALLEL FETCHING OPTIMIZATION ---
        const fetchPromises = jsonFiles.map(async f => {
            const raw = await fetch(f.download_url);
            const data = await raw.json();
            return {
                filename: f.name,
                data: Array.isArray(data) ? data : (data.words || []),
                name: (data.name || f.name.replace('.json','')).replace(/_/g,' ')
            };
        });

        const results = await Promise.all(fetchPromises);

        allTopics = {};
        results.forEach(item => {
            if(item.data.length) {
                allTopics[item.filename] = {
                    name: item.name,
                    words: item.data
                };
            }
        });
        // ----------------------------------------
        
        status.innerText = "Aurora Rank Master • Ready";
        if(!currentTopicKey || !allTopics[currentTopicKey]) {
            if(allTopics[currentTopicKey]) {
                // Key is valid
            } else {
                currentTopicKey = Object.keys(allTopics)[0];
                localStorage.setItem(getDataKey('fp_aurora_topic'), currentTopicKey);
            }
        }
        
        if(manual) showToast("Đồng bộ thành công!", "success");
        renderDashboard();
    } catch(e) {
        console.error(e);
        status.innerText = "Offline Mode / Error";
        if(manual) showToast("Lỗi: Kiểm tra mạng/GitHub", "error");
    }
}

function getWordKey(w) {
    return (w.english + '_' + (w.vietnamese || '').substring(0,3)).toLowerCase().replace(/\s/g,'');
}

// --- IMAGE GENERATION / SEARCH HELPER ---
function getImageUrl(word) {
    // Using Pollinations.ai for dynamic generation without API Key.
    // Adding keywords to make it simple vector/minimalist style suitable for flashcards.
    const cleanWord = encodeURIComponent(word);
    return `https://image.pollinations.ai/prompt/minimalist%20cute%20vector%20illustration%20of%20${cleanWord}?width=300&height=300&nologo=true`;
}

// --- IMAGE PRELOADING ---
function preloadImages(startIdx, count) {
     for(let i = startIdx; i < startIdx + count; i++) {
         if(i < sessionQueue.length) {
             const img = new Image();
             // Preload the image
             img.src = getImageUrl(sessionQueue[i].english);
         }
     }
}

// --- GAME LOGIC START ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.startSmartSession = function() {
    if(!currentUser) return showToast("Vui lòng đăng nhập để học và đồng bộ kết quả!", "error");
    if(!currentTopicKey) return showToast("Chưa chọn chủ đề!", "error");
    
    // FIX: Ensure the argument to parseInt is a string.
    config.newLimit = parseInt(localStorage.getItem('fp_aurora_cfg_new') || '5', 10);
    // FIX: Ensure the argument to parseInt is a string.
    config.reviewLimit = parseInt(localStorage.getItem('fp_aurora_cfg_review') || '20', 10);

    const allWords = allTopics[currentTopicKey].words;
    
    let candidatesNew = allWords.filter(w => {
        const k = getWordKey(w);
        return !masteredWords[k] && !srsData[k];
    });
    const batchNew = candidatesNew.slice(0, config.newLimit);

    let allLearning = allWords.filter(w => {
        const k = getWordKey(w);
        return !masteredWords[k] && srsData[k];
    });

    allLearning.sort((a,b) => srsData[getWordKey(a)].nextReview - srsData[getWordKey(b)].nextReview);
    const batchReview = allLearning.slice(0, config.reviewLimit);
    
    if(batchNew.length === 0 && batchReview.length === 0) {
        // FIX: Add declaration for confetti.
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        playSound(SFX.WIN);
        showToast("Tuyệt vời! Bạn đã hoàn thành tất cả!", "success");
        return;
    }

    showToast(`Bắt đầu: ${batchNew.length} từ mới + ${batchReview.length} ôn tập`, "info");
    playSound(SFX.POP);
    
    let interleaved = [];
    let r = [...batchReview];
    let n = [...batchNew];
    
    while(n.length > 0 || r.length > 0) {
        if(n.length > 0) interleaved.push(n.shift()); 
        if(r.length > 0) interleaved.push(r.shift()); 
        if(r.length > 0) interleaved.push(r.shift()); 
    }
    
    sessionQueue = interleaved;
    sessionIndex = 0;
    currentMode = 'smart';
    
    // Start Preloading First 4 images
    preloadImages(0, 4);

    openGameOverlay();
    decideSmartRender();
}

function decideSmartRender() {
    const w = sessionQueue[sessionIndex];
    const key = getWordKey(w);
    const isNew = !srsData[key] && !masteredWords[key];
    
    if(isNew) {
        renderFlashcard();
    } else {
        const modes = ['flashcard', 'quiz', 'fill', 'spelling', 'sentence'];
        const randomMode = modes[Math.floor(Math.random() * modes.length)];
        
        if(randomMode === 'flashcard') renderFlashcard();
        else if(randomMode === 'quiz') setupQuiz();
        else if(randomMode === 'fill') renderFill();
        else if(randomMode === 'sentence') renderSentence();
        else renderSpelling();
    }
}


// FIX: Function is assigned to window property, which is handled by the global declaration.
window.processResult = function(isCorrect) {
    if(isProcessing) return;
    isProcessing = true;
    
    const w = sessionQueue[sessionIndex];
    const key = getWordKey(w);
    let data = srsData[key] || { interval: 0, level: 0, nextReview: 0, consecutiveWrongs: 0 };
    
    if(isCorrect) {
        playSound(SFX.CORRECT);
        // FIX: Add declaration for confetti.
        confetti({ particleCount: 30, spread: 50, origin: { y: 0.7 }, scalar: 0.7 });
        addPoints(10); 
        
        // Reset count wrong
        data.consecutiveWrongs = 0;

        // Nếu từ này từng bị đánh dấu là "Hard" (isHard), tăng interval chậm hơn
        let multiplier = data.isHard ? 1.5 : 2.5;

        if(data.level === 0) data.interval = 1; 
        else if(data.level === 1) data.interval = 3; 
        else data.interval = Math.ceil(data.interval * multiplier);
        
        // Reset hard flag
        if(data.isHard) data.isHard = false;

        data.level++;
        data.nextReview = Date.now() + (data.interval * 24 * 3600 * 1000);
        
        srsData[key] = data;
        localStorage.setItem(getDataKey('fp_aurora_srs'), JSON.stringify(srsData));
        saveProgressToCloud(); 
        setTimeout(() => { isProcessing = false; nextStep(); }, 600);
        
    } else {
        playSound(SFX.WRONG);
        data.level = 0;
        data.interval = 0;
        data.nextReview = Date.now(); 
        
        // --- LOGIC MỚI: Đếm số lần sai liên tiếp ---
        data.consecutiveWrongs = (data.consecutiveWrongs || 0) + 1;
        
        if (data.consecutiveWrongs > 3) {
            data.isHard = true; // Đánh dấu từ khó
            showToast("Sai quá 3 lần! Từ này sẽ được ưu tiên ôn kỹ.", "error");
            // Thêm vào hàng đợi 2 lần nữa để bắt buộc học ngay
            sessionQueue.push(w);
            sessionQueue.push(w);
        }
        // -------------------------------------------

        srsData[key] = data;
        localStorage.setItem(getDataKey('fp_aurora_srs'), JSON.stringify(srsData));
        saveProgressToCloud(); 

        if(currentMode === 'smart') {
            const reInsertIdx = sessionIndex + 3;
            if(reInsertIdx < sessionQueue.length) {
                sessionQueue.splice(reInsertIdx, 0, w);
            } else {
                sessionQueue.push(w);
            }
            if(data.consecutiveWrongs <= 3) showToast("Sẽ ôn lại từ này ngay!", "error");
        }
        
        // Nếu đang ở Flashcard thì lật để xem đáp án
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        if(document.getElementById('flashcardObj') && !isFlipped) {
            window.flipCard();
        }
        
        setTimeout(() => { 
            isProcessing = false; 
            nextStep();
        }, 2500);
    }
}

// --- UI RENDERING & ANIMATIONS ---
function openGameOverlay() {
    document.getElementById('gameOverlay').style.display = 'flex';
    document.getElementById('gameOverlay').classList.add('animate__animated', 'animate__fadeIn');
    updateProgress();
    startTimer(); 
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.closeGame = function() {
    document.getElementById('gameOverlay').style.display = 'none';
    window.speechSynthesis.cancel();
    stopTimer(); 
    saveProgressToCloud(); 
    renderDashboard();
}

function startTimer() {
    if(studyTimer) clearInterval(studyTimer);
    studyTimer = setInterval(() => {
        accumulatedTime++;
        // FIX: Ensure value passed to localStorage.setItem is a string.
        localStorage.setItem('fp_aurora_time', String(accumulatedTime));
        if(accumulatedTime % 60 === 0) {
            addPoints(5); 
        }
    }, 1000);
}

function stopTimer() {
    if(studyTimer) clearInterval(studyTimer);
    studyTimer = null;
    // FIX: Ensure value passed to localStorage.setItem is a string.
    localStorage.setItem('fp_aurora_time', String(accumulatedTime));
}

function updateProgress() {
    const pct = ((sessionIndex) / sessionQueue.length) * 100;
    document.getElementById('gameProgressBar').style.width = `${pct}%`;
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.nextStep = function() {
    nextStep();
}

function nextStep() {
    if(sessionIndex < sessionQueue.length - 1) {
        const content = document.getElementById('gameContent');
        content.classList.add('slide-out-left');
        
        // Preload next batch (keep 3 images ahead)
        preloadImages(sessionIndex + 1, 3);

        setTimeout(() => {
            sessionIndex++;
            updateProgress();
            
            content.classList.remove('slide-out-left');
            content.style.opacity = 0;
            
            // LOGIC CHUYỂN BÀI MỚI
            if(currentMode === 'smart') {
                decideSmartRender();
            } else {
                if(currentMode === 'flashcard_all') renderFlashcard(); 
                else if(currentMode === 'fill') renderFill();
                else if(currentMode === 'quiz') setupQuiz();
                else if(currentMode === 'spelling') renderSpelling();
                else if(currentMode === 'sentence') renderSentence();
            }
            
            content.classList.add('slide-in-right');
            setTimeout(() => content.classList.remove('slide-in-right'), 400);
            content.style.opacity = 1;
        }, 350);
    } else {
        playSound(SFX.WIN);
        // FIX: Add declaration for confetti.
        confetti({ particleCount: 300, spread: 100, origin: { y: 0.6 } });
        showToast("Buổi học hoàn tất! Xuất sắc!", "success");
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        setTimeout(window.closeGame, 2000);
    }
}

// --- CARD RENDERERS ---
function renderFlashcard() {
    const w = sessionQueue[sessionIndex];
    isFlipped = false;
    isProcessing = false;
    
    const isRelearn = sessionQueue.filter(x => x === w).length > 1;
    const badge = isRelearn ? '<div style="position:absolute; top:-10px; right:-10px; background:#f59e0b; color:white; padding:5px 10px; border-radius:10px; font-size:0.7rem; font-weight:bold; box-shadow:0 5px 10px rgba(0,0,0,0.2);">HỌC LẠI</div>' : '';

    const exampleId = `ex-trans-${sessionIndex}`;
    
    const isReviewMode = (currentMode === 'smart');
    const labelLang = LANG_CONFIG[currentLang].label;

    const imageUrl = getImageUrl(w.english);

    const html = `
        <div class="scene">
            <div class="card" id="flashcardObj" onclick="window.flipCard()">
                <div class="card__face card__face--front">
                    ${badge}
                    <img src="${imageUrl}" class="card-img" alt="${w.english}" onerror="this.style.display='none'">
                    
                    <div style="font-size:0.8rem; opacity:0.6; margin-bottom:5px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">${labelLang}</div>
                    <div class="word-en">${w.english}</div>
                    <div class="ipa">${w.ipa || ''}</div>
                    
                    <div style="margin-top:auto; opacity:0.6; font-size:0.8rem;"><i class="fas fa-touch-app"></i> Chạm để lật</div>
                </div>

                <div class="card__face card__face--back">
                    <div style="font-size:0.8rem; opacity:0.6; margin-bottom:15px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Nghĩa Tiếng Việt</div>
                    <div class="word-vn">${w.vietnamese}</div>
                    
                    <div style="width:100%; border-top:1px dashed rgba(0,0,0,0.1); margin: 20px 0;"></div>
                    <div style="font-size:0.8rem; opacity:0.7; margin-bottom:5px;">Ví dụ mẫu:</div>
                    <div class="example-box">"${w.example || ''}"</div>
                    <div style="font-size:0.8rem; opacity:0.7; margin-top:5px;">Dịch ví dụ:</div>
                    <div class="example-box" id="${exampleId}">
                        <i class="fas fa-spinner fa-spin"></i> Đang dịch...
                    </div>
                </div>
            </div>
        </div>
        
        <div class="control-row">
            ${isReviewMode ? `
                <button class="action-btn btn-wrong" onclick="window.processResult(false)">
                    <i class="fas fa-times"></i> &nbsp;Chưa thuộc
                </button>
                <button class="btn-speak-round animate__animated animate__bounceIn" onclick="window.speakWord(event)"><i class="fas fa-volume-up"></i></button>
                <button class="action-btn btn-next" onclick="window.processResult(true)">
                    Đã thuộc &nbsp;<i class="fas fa-check"></i>
                </button>
            ` : `
                 <button class="btn-speak-round" onclick="window.speakWord(event)"><i class="fas fa-volume-up"></i></button>
                 <button class="action-btn btn-next" onclick="window.nextStep()" style="background:#3b82f6; border-color:#60a5fa;">Tiếp theo <i class="fas fa-arrow-right"></i></button>
            `}
        </div>
        
        <div style="margin-top:15px; cursor:pointer; opacity:0.7; font-size:0.8rem; text-shadow:0 1px 2px rgba(0,0,0,0.5);" onclick="window.markMastered()">
            <i class="fas fa-archive"></i> Đánh dấu đã thuộc lòng (Ẩn vĩnh viễn)
        </div>
    `;
    document.getElementById('gameContent').innerHTML = html;
    
    if(w.example) {
        getTranslation(w.example).then(trans => {
            const el = document.getElementById(exampleId);
            if(el) el.innerText = trans;
        });
    } else {
        const el = document.getElementById(exampleId);
        if(el) el.innerText = "(Không có ví dụ)";
    }

    setTimeout(window.speakWord, 500);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.flipCard = function() {
    if(isProcessing && currentMode === 'smart') return;
    const card = document.getElementById('flashcardObj');
    if(!card) return;
    isFlipped = !isFlipped;
    card.classList.toggle('is-flipped');
    playSound(SFX.FLIP);
}

// --- SPELLING MODE ---
function renderSpelling() {
    isProcessing = false;
    const w = sessionQueue[sessionIndex];
    const target = w.english.trim();
    
    let gridHTML = '';
    for(let i=0; i<target.length; i++) {
        const char = target[i];
        if(char === ' ' || char === '-') {
             gridHTML += `<div class="char-slot space" id="char-${i}"></div>`;
        } else {
             gridHTML += `<div class="char-slot" id="char-${i}"></div>`;
        }
    }

    document.getElementById('gameContent').innerHTML = `
        <div class="glass-panel animate__animated animate__fadeInDown" style="padding:20px; width:95%; text-align:center;">
            <div style="font-size:1.8rem; font-weight:800; color:#fff; text-shadow:0 0 10px rgba(255,255,255,0.4); margin-bottom:5px;">
                ${w.vietnamese}
            </div>
            <div style="opacity:0.8; font-size:0.9rem;">Gõ chính xác từng ký tự</div>
        </div>

        <div class="spelling-container" id="spellingGrid">
            ${gridHTML}
        </div>
        
        <input type="text" id="spellingInput" 
               style="opacity:0; position:absolute; pointer-events:none; top:0; left:0; height:0;" 
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">

        <div style="display:flex; gap:15px; margin-top:20px; align-items:center;">
             <button class="btn-speak-round" onclick="window.speakWord()"><i class="fas fa-volume-up"></i></button>
             <button class="btn-hint" onclick="window.revealSpellingHint()" title="Gợi ý 1 ký tự"><i class="fas fa-lightbulb"></i></button>
        </div>
    `;
    
    // FIX: Properties are assigned to window, which is handled by the global declaration.
    window.spellingTarget = target;
    // FIX: Properties are assigned to window, which is handled by the global declaration.
    window.spellingIdx = 0;
    
    const inp = document.getElementById('spellingInput');
    
    document.addEventListener('click', () => { if(document.getElementById('spellingInput')) document.getElementById('spellingInput').focus(); });
    inp.focus();

    checkSpellingChar(''); 

    inp.addEventListener('input', (e) => {
        if(isProcessing) return;
        // FIX: Cast event target to HTMLInputElement to access 'value' property.
        const val = (e.target as HTMLInputElement).value;
        if(val.length > 0) {
            const char = val[val.length - 1]; 
            checkSpellingChar(char);
            // FIX: Cast event target to HTMLInputElement to access 'value' property.
            (e.target as HTMLInputElement).value = ''; 
        }
    });
    
    setTimeout(window.speakWord, 300);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.revealSpellingHint = function() {
    if(isProcessing) return;
    // FIX: Properties are assigned to window, which is handled by the global declaration.
    const target = window.spellingTarget;
    let idx = window.spellingIdx;
    
    if(idx < target.length) {
        const correctChar = target[idx];
        checkSpellingChar(correctChar);
        document.getElementById('spellingInput').focus();
    }
}

function checkSpellingChar(inputChar) {
    // FIX: Properties are assigned to window, which is handled by the global declaration.
    const target = window.spellingTarget;
    let idx = window.spellingIdx;
    
    while(idx < target.length && (target[idx] === ' ' || target[idx] === '-')) {
        idx++;
    }
    // FIX: Properties are assigned to window, which is handled by the global declaration.
    window.spellingIdx = idx;

    if(idx >= target.length) return; 

    if(inputChar === '') {
        highlightChar(idx);
        return;
    }

    const correctChar = target[idx];
    const slot = document.getElementById(`char-${idx}`);

    if(inputChar.toLowerCase() === correctChar.toLowerCase()) {
        slot.innerText = correctChar;
        slot.classList.add('correct');
        slot.classList.remove('active');
        playSound(SFX.POP);
        
        // FIX: Properties are assigned to window, which is handled by the global declaration.
        window.spellingIdx++;
        
        // FIX: Properties are assigned to window, which is handled by the global declaration.
        while(window.spellingIdx < target.length && (target[window.spellingIdx] === ' ' || target[window.spellingIdx] === '-')) {
            // FIX: Properties are assigned to window, which is handled by the global declaration.
            window.spellingIdx++;
        }
        
        // FIX: Properties are assigned to window, which is handled by the global declaration.
        if(window.spellingIdx >= target.length) {
            document.getElementById('spellingInput').blur();
            showToast("Chính xác!", "success");
            // FIX: Function is assigned to window property, which is handled by the global declaration.
            window.processResult(true);
        } else {
            // FIX: Properties are assigned to window, which is handled by the global declaration.
            highlightChar(window.spellingIdx);
        }
    } else {
        playSound(SFX.WRONG);
        slot.classList.add('animate__animated', 'animate__shakeX');
        slot.style.borderColor = '#ef4444';
        setTimeout(() => {
            slot.classList.remove('animate__animated', 'animate__shakeX');
            slot.style.borderColor = '';
        }, 500);
    }
}

function highlightChar(idx) {
    document.querySelectorAll('.char-slot').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(`char-${idx}`);
    if(el) el.classList.add('active');
}

// --- NEW FEATURE: SENTENCE SCRAMBLE MODE ---
async function renderSentence() {
    isProcessing = false;
    const w = sessionQueue[sessionIndex];

    // Show loading spinner
    document.getElementById('gameContent').innerHTML = `
        <div style="text-align:center; padding:50px; color:white; opacity:0.8;">
            <i class="fas fa-spinner fa-spin fa-2x"></i>
            <div style="margin-top:15px; font-weight:600;">Đang chuẩn bị câu đố...</div>
        </div>
    `;

    // Priority: Example > Word
    const sourceEnglish = w.example || w.english;
    let sourceVietnamese = "";

    // Try to get translation for the example immediately
    if (w.example) {
        try {
            sourceVietnamese = await getTranslation(w.example);
        } catch (e) {
            console.error(e);
            sourceVietnamese = w.vietnamese; // Fallback
        }
    } else {
        sourceVietnamese = w.vietnamese;
    }

    // Determine Mode: 0 = Arrange English, 1 = Arrange Vietnamese
    const mode = Math.random() > 0.5 ? 'arrange_en' : 'arrange_vn';

    let targetStr = "";
    let promptStr = "";
    let guideStr = "";
    const labelLang = LANG_CONFIG[currentLang].label;

    if (mode === 'arrange_en') {
        targetStr = sourceEnglish;
        promptStr = sourceVietnamese; // Prompt is the translation
        guideStr = `Sắp xếp câu ${labelLang}`;
    } else {
        targetStr = sourceVietnamese;
        promptStr = sourceEnglish; // Prompt is the English text
        guideStr = "Sắp xếp bản dịch Tiếng Việt";
    }

    // Clean target string & Split
    targetStr = targetStr.trim();
    const words = targetStr.split(/\s+/);
    
    // Shuffle
    const shuffled = [...words].sort(() => Math.random() - 0.5);

    document.getElementById('gameContent').innerHTML = `
        <div class="glass-panel animate__animated animate__zoomIn" style="padding:20px; width:95%; text-align:center; margin-bottom:15px;">
             <div style="opacity:0.8; font-size:0.85rem; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px;">${guideStr}</div>
             <div style="font-size:1.1rem; font-weight:700; color:#fff; line-height: 1.4;">${promptStr}</div>
             <div style="font-size:0.9rem; opacity:0.6; margin-top:5px; font-style:italic;">(Hãy sắp xếp các từ bên dưới)</div>
        </div>

        <div id="answerArea" class="answer-slot-container"></div>

        <div id="sourceArea" class="sentence-area">
             ${shuffled.map((word, i) => `<div class="word-chip" id="chip-${i}" onclick="window.moveWord(${i}, '${word.replace(/'/g, "\\'")}')">${word}</div>`).join('')}
        </div>

        <div style="display:flex; gap:15px; margin-top:10px;">
             <button class="btn-speak-round" onclick="window.speakText('${sourceEnglish.replace(/'/g, "\\'")}')"><i class="fas fa-volume-up"></i></button>
             <button class="action-btn" style="width:50px; flex:none; background:rgba(255,255,255,0.1);" onclick="window.resetSentence()"><i class="fas fa-redo"></i></button>
        </div>
    `;
    
    // FIX: Property is assigned to window, which is handled by the global declaration.
    window.sentenceState = {
        targetStr: targetStr.replace(/\s+/g, ' '),
        originalMode: mode
    };

    // Auto-read English prompt if we are arranging Vietnamese
    if (mode === 'arrange_vn' && !config.muted) {
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        setTimeout(() => window.speakText(sourceEnglish), 500);
    }
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.moveWord = function(idx, word) {
    if(isProcessing) return;
    const chip = document.getElementById(`chip-${idx}`);
    if(chip.classList.contains('used')) return;
    
    chip.classList.add('used');
    playSound(SFX.POP);
    
    const ansArea = document.getElementById('answerArea');
    const ansChip = document.createElement('div');
    ansChip.className = 'ans-chip';
    ansChip.innerText = word;
    ansChip.dataset.originIdx = idx;
    ansChip.onclick = function() {
        if(isProcessing) return; // Không cho gỡ khi đang check
        // FIX: Cast 'this' to HTMLElement to use the 'remove' method.
        (this as HTMLElement).remove();
        document.getElementById(`chip-${idx}`).classList.remove('used');
        playSound(SFX.FLIP);
    };
    
    ansArea.appendChild(ansChip);

    // --- AUTO CHECK LOGIC ---
    // Kiểm tra xem còn chip nào chưa dùng không
    const remaining = document.querySelectorAll('.sentence-area .word-chip:not(.used)').length;
    if(remaining === 0) {
        // Tự động check sau 1 khoảng ngắn
        // FIX: Functions are assigned to window property, which is handled by the global declaration.
        setTimeout(() => window.checkSentence(window.sentenceState.targetStr), 200);
    }
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.resetSentence = function() {
    if(isProcessing) return;
    const ansArea = document.getElementById('answerArea');
    ansArea.innerHTML = '';
    document.querySelectorAll('.word-chip').forEach(el => el.classList.remove('used'));
    playSound(SFX.FLIP);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.checkSentence = function(correctSentence) {
    if(isProcessing) return;
    const ansArea = document.getElementById('answerArea');
    // FIX: Cast child elements to HTMLElement to access 'innerText' property.
    const userWords = Array.from(ansArea.children).map(c => (c as HTMLElement).innerText);
    const userSentence = userWords.join(' ');
    
    // Case insensitive comparison
    if(userSentence.toLowerCase() === correctSentence.toLowerCase()) {
        showToast("Tuyệt vời! Chính xác!", "success");
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.processResult(true);
    } else {
        playSound(SFX.WRONG);
        ansArea.classList.add('animate__animated', 'animate__shakeX');
        setTimeout(() => ansArea.classList.remove('animate__animated', 'animate__shakeX'), 500);
        showToast("Sai rồi, hãy thử lại!", "error");
        
        // Auto reset sau khi sai để xếp lại cho nhanh
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        setTimeout(window.resetSentence, 1000);
    }
}
// --- END SENTENCE MODE ---

function renderFill() {
    isProcessing = false;
    const w = sessionQueue[sessionIndex];
    const sentence = w.example || `The word is ${w.english}`;
    const hidden = sentence.replace(new RegExp(w.english, 'gi'), '_____');
    
    document.getElementById('gameContent').innerHTML = `
        <div class="glass-panel animate__animated animate__zoomIn" style="padding:30px; width:95%; text-align:center; margin-bottom:25px;">
            <div style="font-size:1.4rem; margin-bottom:15px; line-height:1.5; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,0.5);">${hidden}</div>
            <div style="opacity:0.9; font-size:1rem; color:#60a5fa; font-weight:600;">Gợi ý: ${w.vietnamese}</div>
        </div>
        <div style="width:95%; display:flex; gap:10px;">
            <input type="text" id="fillInp" class="input-glass" style="margin-bottom:0;" placeholder="Nhập từ vựng..." autocomplete="off" 
                   onkeypress="if(event.key==='Enter') window.checkFill('${w.english}')">
            <button class="btn-hint" onclick="window.showHint('${w.english}')"><i class="fas fa-lightbulb"></i></button>
        </div>
        <div style="width:95%; margin-top:15px;">
             <button class="btn-primary" onclick="window.checkFill('${w.english}')">KIỂM TRA</button>
        </div>
        <button class="btn-speak-round" style="margin-top:20px; width:50px; height:50px; font-size:1.2rem;" onclick="window.speakWord()"><i class="fas fa-volume-up"></i></button>
    `;
    setTimeout(() => document.getElementById('fillInp').focus(), 100);
    setTimeout(window.speakWord, 400);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.showHint = function(ans) {
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    const inp = document.getElementById('fillInp') as HTMLInputElement;
    const currentVal = inp.value;
    if (currentVal.length < ans.length) {
        // FIX: Cast element to HTMLInputElement to access 'value' property.
        inp.value = ans.substring(0, currentVal.length + 1);
        playSound(SFX.POP);
        inp.focus();
    }
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.checkFill = function(ans) {
    if(isProcessing) return;
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    const val = (document.getElementById('fillInp') as HTMLInputElement).value.trim();
    const correct = val.toLowerCase() === ans.toLowerCase();
    
    if(correct) {
        showToast("Chính xác!", "success");
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.processResult(true); 
    } else {
        // FIX: Cast element to HTMLInputElement to access 'value' property.
        const inp = document.getElementById('fillInp') as HTMLInputElement;
        inp.classList.add('animate__animated', 'animate__shakeX');
        inp.style.borderColor = '#ef4444';
        inp.style.color = '#ef4444';
        // FIX: Cast element to HTMLInputElement to access 'value' property.
        inp.value = ans; 
        playSound(SFX.WRONG);
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.processResult(false);
    }
}

function setupMatching() {
    const subset = sessionQueue.slice(0, 4);
    if(subset.length < 2) { showToast("Cần tối thiểu 2 từ!", "error"); window.closeGame(); return; }
    sessionQueue = subset;
    
    let items = [];
    subset.forEach((w, i) => {
        items.push({ txt: w.english, id: i, type: 'en' });
        items.push({ txt: w.vietnamese, id: i, type: 'vn' });
    });
    items.sort(() => Math.random() - 0.5);
    
    let html = `<div class="matching-grid animate__animated animate__fadeInUp">`;
    items.forEach((item, idx) => {
        html += `<div class="match-card" id="m-${idx}" onclick="window.matchClick(${idx}, ${item.id})">${item.txt}</div>`;
    });
    html += `</div>`;
    document.getElementById('gameContent').innerHTML = html;
    // FIX: Property is assigned to window, which is handled by the global declaration.
    window.matchState = { selected: null, solved: 0, total: subset.length };
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.matchClick = function(idx, id) {
    const el = document.getElementById(`m-${idx}`);
    if(el.classList.contains('correct')) return;
    
    // FIX: Property is assigned to window, which is handled by the global declaration.
    const state = window.matchState;
    playSound(SFX.POP);
    
    if(state.selected === null) {
        state.selected = { idx, id, el };
        el.classList.add('selected');
    } else {
        if(state.selected.idx === idx) {
            el.classList.remove('selected');
            state.selected = null;
            return;
        }
        
        if(state.selected.id === id) { 
            playSound(SFX.CORRECT);
            el.classList.add('correct');
            state.selected.el.classList.add('correct');
            state.solved++;
            state.selected = null;
            addPoints(5); 
            
            if(state.solved === state.total) {
                // FIX: Function is assigned to window property, which is handled by the global declaration.
                setTimeout(() => { showToast("Hoàn thành xuất sắc!", "success"); window.closeGame(); }, 1000);
            }
        } else {
            playSound(SFX.WRONG);
            el.classList.add('wrong');
            state.selected.el.classList.add('wrong');
            setTimeout(() => {
                el.classList.remove('wrong', 'selected');
                state.selected.el.classList.remove('wrong', 'selected');
                state.selected = null;
            }, 600);
        }
    }
}

function setupQuiz() {
    isProcessing = false;
    const w = sessionQueue[sessionIndex];
    const all = allTopics[currentTopicKey].words;
    
    let options = all.filter(x => getWordKey(x) !== getWordKey(w))
                     .sort(() => Math.random() - 0.5).slice(0,3);
    options.push(w);
    options.sort(() => Math.random() - 0.5);
    
    let html = `<div style="text-align:center; margin-bottom:30px;" class="animate__animated animate__fadeInDown">
        <div style="font-size:2.8rem; font-weight:800; margin-bottom:10px; color:#fff; text-shadow:0 0 20px rgba(59, 130, 246, 0.5);">${w.english}</div>
        <button class="btn-speak-round" style="margin:0 auto; width:50px; height:50px; font-size:1.2rem;" onclick="window.speakWord()"><i class="fas fa-volume-up"></i></button>
    </div>
    <div style="width:100%; display:grid; gap:15px;" class="animate__animated animate__fadeInUp">`;
    
    options.forEach(opt => {
        const isCorrect = getWordKey(opt) === getWordKey(w);
        html += `<button class="action-btn" style="width:100%; background:rgba(255,255,255,0.95); color:#0f172a;" onclick="window.handleQuiz(this, ${isCorrect})">${opt.vietnamese}</button>`;
    });
    html += `</div>`;
    document.getElementById('gameContent').innerHTML = html;
    setTimeout(window.speakWord, 500);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.handleQuiz = function(el, isCorrect) {
    if(isProcessing) return;
    
    if(isCorrect) {
        el.style.background = '#00e676';
        el.style.color = 'white';
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.processResult(true);
    } else {
        el.style.background = '#ff5252';
        el.style.color = 'white';
        el.classList.add('animate__animated', 'animate__shakeX');
        // FIX: Function is assigned to window property, which is handled by the global declaration.
        window.processResult(false);
    }
}

// --- UTILITIES ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.startGame = function(mode) {
    if(!currentUser) return showToast("Vui lòng đăng nhập để luyện tập!", "error");
    if(!currentTopicKey) return showToast("Chưa chọn chủ đề!", "error");
    playSound(SFX.POP);
    const allWords = allTopics[currentTopicKey].words;
    
    // FIX: Ensure the argument to parseInt is a string.
    config.newLimit = parseInt(localStorage.getItem('fp_aurora_cfg_new') || '5', 10);
    // FIX: Ensure the argument to parseInt is a string.
    config.reviewLimit = parseInt(localStorage.getItem('fp_aurora_cfg_review') || '20', 10);
    const totalLimit = config.newLimit + config.reviewLimit;
    
    if(mode === 'flashcard_all') {
        // Flashcard mode shows all words (Preview Mode)
        sessionQueue = [...allWords]; 
    } else {
        // OTHER GAMES: Only show learned words (SRS or Mastered)
        let learnedWords = allWords.filter(w => {
            const k = getWordKey(w);
            return srsData[k] || masteredWords[k];
        });

        if (learnedWords.length === 0) {
            return showToast("Bạn chưa học từ nào! Hãy chọn 'HỌC NGAY' để bắt đầu.", "error");
        }

        if (mode === 'matching' && learnedWords.length < 2) {
            return showToast("Cần ít nhất 2 từ đã học để chơi ghép thẻ!", "error");
        }

        // Shuffle and limit learned words
        learnedWords.sort(() => Math.random() - 0.5);
        if(learnedWords.length > totalLimit) {
            sessionQueue = learnedWords.slice(0, totalLimit);
        } else {
            sessionQueue = learnedWords;
        }
    }
    
    if(sessionQueue.length === 0) return showToast("Không có từ nào để học", "error");

    showToast(`Bắt đầu: ${sessionQueue.length} thẻ`, "info");
    
    sessionIndex = 0;
    currentMode = mode;
    
    // Start Preloading for specific game modes that might use images (flashcard)
    if(mode === 'flashcard_all') preloadImages(0, 4);

    openGameOverlay();
    
    if(mode === 'fill') renderFill();
    else if(mode === 'matching') setupMatching();
    else if(mode === 'quiz') setupQuiz();
    else if(mode === 'spelling') renderSpelling();
    else if(mode === 'sentence') renderSentence();
    else renderFlashcard();
}

function renderDashboard() {
    // REMOVED LOGIN CHECK to allow guest access
    document.getElementById('dashTime').innerText = formatTime(accumulatedTime);
    updateUserPointsUI();
    if(!currentTopicKey || !allTopics[currentTopicKey]) return;
    const topic = allTopics[currentTopicKey];
    document.getElementById('currentTopicName').innerText = topic.name;
    
    let cntNew=0, cntDue=0, cntMaster=0, cntLearned=0;
    const now = Date.now();
    
    topic.words.forEach(w => {
        const key = getWordKey(w);
        if(masteredWords[key]) {
            cntMaster++;
            cntLearned++;
        }
        else if(srsData[key]) {
            if(srsData[key].nextReview <= now) cntDue++;
            cntLearned++;
        } else {
            cntNew++;
        }
    });
    
    animateValue("statNew", parseInt(document.getElementById('statNew').innerText, 10), cntNew, 1000);
    animateValue("statDue", parseInt(document.getElementById('statDue').innerText, 10), cntDue, 1000);
    animateValue("statLearned", parseInt(document.getElementById('statLearned').innerText, 10), cntLearned, 1000);
    animateValue("statMastered", parseInt(document.getElementById('statMastered').innerText, 10), cntMaster, 1000);
}

// --- NEW FUNCTION: WORD LIST POPUP ---
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.openWordList = function(type) {
    if(!currentTopicKey || !allTopics[currentTopicKey]) return;
    const topic = allTopics[currentTopicKey];
    const now = Date.now();
    
    let wordsToShow = [];
    let title = "";

    if(type === 'new') {
        title = "Từ Mới (Chưa học)";
        wordsToShow = topic.words.filter(w => {
            const k = getWordKey(w);
            return !masteredWords[k] && !srsData[k];
        });
    } else if(type === 'due') {
        title = "Cần Ôn Tập";
        wordsToShow = topic.words.filter(w => {
            const k = getWordKey(w);
            return srsData[k] && srsData[k].nextReview <= now && !masteredWords[k];
        });
    } else if(type === 'learned') {
        title = "Đã Học";
        wordsToShow = topic.words.filter(w => {
            const k = getWordKey(w);
            return srsData[k] || masteredWords[k];
        });
    } else if(type === 'mastered') {
        title = "Đã Thuộc Lòng";
        wordsToShow = topic.words.filter(w => {
            const k = getWordKey(w);
            return masteredWords[k];
        });
    }

    const overlay = document.getElementById('wordListOverlay');
    const content = document.getElementById('wordListContent');
    const titleEl = document.getElementById('listTitle');
    
    titleEl.innerText = `${title} (${wordsToShow.length})`;
    content.innerHTML = "";
    
    if(wordsToShow.length === 0) {
        content.innerHTML = `<div style="text-align:center; padding:20px; opacity:0.6;">Chưa có từ nào trong mục này.</div>`;
    } else {
        wordsToShow.forEach(w => {
            const div = document.createElement('div');
            div.className = "list-item";
            div.innerHTML = `
                <div>
                    <div class="list-word-main">${w.english}</div>
                    <div class="list-word-sub">${w.vietnamese}</div>
                </div>
                <div style="opacity:0.6; cursor:pointer;" onclick="window.speakText('${w.english}')">
                    <i class="fas fa-volume-up"></i>
                </div>
            `;
            content.appendChild(div);
        });
    }
    
    overlay.style.display = 'flex';
    playSound(SFX.POP);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.closeWordList = function() {
    document.getElementById('wordListOverlay').style.display = 'none';
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.speakText = function(text) {
    if(config.muted) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // Use dynamic TTS code from config
    u.lang = LANG_CONFIG[currentLang].tts; 
    if(selectedVoice) u.voice = selectedVoice;
    window.speechSynthesis.speak(u);
}

function animateValue(id, start, end, duration) {
    if (start === end) return;
    const range = end - start;
    let current = start;
    const increment = end > start ? 1 : -1;
    const stepTime = Math.abs(Math.floor(duration / range));
    const obj = document.getElementById(id);
    const timer = setInterval(function() {
        current += increment;
        obj.innerHTML = current;
        if (current == end) clearInterval(timer);
    }, Math.max(stepTime, 50));
}

function renderTopicList() {
    const list = document.getElementById('topicList');
    list.innerHTML = '';

    // If active language is English (Basic or Advanced), show repo switcher tab
    if (currentLang.startsWith('en')) {
        const switcher = document.createElement('div');
        switcher.className = 'repo-toggle animate__animated animate__fadeIn';
        const isBasic = currentLang === 'en';
        switcher.innerHTML = `
            <div class="repo-opt ${isBasic ? 'active' : ''}" onclick="window.switchLanguage('en')">
                <i class="fas fa-seedling"></i> Kho Cơ bản (tuvung)
            </div>
            <div class="repo-opt ${!isBasic ? 'active' : ''}" onclick="window.switchLanguage('en_adv')">
                <i class="fas fa-graduation-cap"></i> Kho Nâng cao (3000tv)
            </div>
        `;
        list.appendChild(switcher);
    }

    // Calculate Grand Totals for current Repo
    let repoTotalWords = 0;
    let repoTotalLearned = 0;

    Object.keys(allTopics).forEach(key => {
        const t = allTopics[key];
        repoTotalWords += t.words.length;
        t.words.forEach(w => {
             const k = getWordKey(w);
             if(masteredWords[k] || srsData[k]) repoTotalLearned++;
        });
    });

    // Render Grand Summary Card
    const summaryPct = repoTotalWords > 0 ? Math.floor((repoTotalLearned/repoTotalWords)*100) : 0;
    
    const summaryDiv = document.createElement('div');
    summaryDiv.className = "glass-panel animate__animated animate__fadeInDown";
    summaryDiv.style.padding = "20px";
    summaryDiv.style.marginBottom = "25px";
    summaryDiv.style.background = "rgba(59, 130, 246, 0.15)";
    summaryDiv.style.border = "1px solid rgba(59, 130, 246, 0.4)";
    summaryDiv.innerHTML = `
        <div style="text-align:center;">
            <h3 style="color:#fff; margin-bottom:5px; text-transform:uppercase; letter-spacing:1px; font-size:0.9rem;">Tổng quan Kho từ</h3>
            <div style="font-size:2.5rem; font-weight:800; color:#38bdf8; text-shadow:0 0 10px rgba(56,189,248,0.5)">${repoTotalLearned} <span style="font-size:1rem; color:#94a3b8">/ ${repoTotalWords}</span></div>
            <div style="font-size:0.9rem; margin-top:5px; font-weight:600;">Tiến độ: ${summaryPct}%</div>
            <div class="topic-progress-bg" style="margin-top:10px; height:8px;">
                <div class="topic-progress-fill" style="width:${summaryPct}%; background:#38bdf8; box-shadow:0 0 10px #38bdf8;"></div>
            </div>
        </div>
    `;
    list.appendChild(summaryDiv);

    Object.keys(allTopics).forEach(key => {
        const t = allTopics[key];
        
        let learnedCount = 0;
        t.words.forEach(w => {
            const k = getWordKey(w);
            if(masteredWords[k] || srsData[k]) learnedCount++;
        });
        const pct = t.words.length > 0 ? Math.floor((learnedCount / t.words.length) * 100) : 0;

        const el = document.createElement('div');
        el.className = `glass-panel ${key===currentTopicKey ? 'animate__animated animate__pulse':''}`;
        el.style.padding = '20px';
        el.style.marginBottom = '15px';
        el.style.cursor = 'pointer';
        
        el.innerHTML = `
            <div style="width:100%">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:700; font-size:1.1rem;">${t.name}</div>
                    ${key===currentTopicKey ? '<i class="fas fa-check-circle" style="color:var(--success-color); font-size:1.2rem;"></i>' : ''}
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; opacity:0.7; margin-top:2px;">
                    <span>${t.words.length} thẻ</span>
                    <span>Đã học ${pct}%</span>
                </div>
                <div class="topic-progress-bg">
                    <div class="topic-progress-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
        el.onclick = () => {
            currentTopicKey = key;
            localStorage.setItem(getDataKey('fp_aurora_topic'), key);
            playSound(SFX.POP);
            showToast("Đã chọn: " + t.name);
            saveProgressToCloud(); 
            // FIX: Function is assigned to window property, which is handled by the global declaration.
            window.navTo('view-home');
        };
        list.appendChild(el);
    });
}

function showToast(msg, type='info') {
    const el = document.getElementById('toast');
    const txt = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    
    if(type==='success') { icon.innerHTML = '<i class="fas fa-check-circle" style="color:#4ade80"></i>'; el.style.border = "1px solid #4ade80"; }
    else if(type==='error') { icon.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#f87171"></i>'; el.style.border = "1px solid #f87171"; }
    else { icon.innerHTML = '<i class="fas fa-info-circle" style="color:#60a5fa"></i>'; el.style.border = "1px solid #60a5fa"; }
    
    txt.innerText = msg;
    el.classList.add('show');
    // FIX: Property is assigned to window, which is handled by the global declaration.
    if(window.toastTimeout) clearTimeout(window.toastTimeout);
    // FIX: Property is assigned to window, which is handled by the global declaration.
    window.toastTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.markMastered = function() {
    if(!confirm("Bạn chắc chắn đã thuộc lòng từ này? Nó sẽ không xuất hiện lại.")) return;
    const w = sessionQueue[sessionIndex];
    const key = getWordKey(w);
    masteredWords[key] = true;
    delete srsData[key];
    localStorage.setItem(getDataKey('fp_aurora_srs'), JSON.stringify(srsData));
    localStorage.setItem(getDataKey('fp_aurora_mastered'), JSON.stringify(masteredWords));
    
    addPoints(100); 
    saveProgressToCloud(); 
    playSound(SFX.WIN);
    showToast("Đã chuyển vào kho Tinh thông!", "success");
    nextStep();
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.resetProgress = function() {
    if(!confirm("CẢNH BÁO: Hành động này sẽ xoá TOÀN BỘ dữ liệu học tập của ngôn ngữ hiện tại, bao gồm từ đã thuộc và tiến độ ôn tập. Bạn có chắc chắn không?")) return;
    
    srsData = {};
    masteredWords = {};
    accumulatedPoints = 0;
    accumulatedTime = 0;
    
    localStorage.removeItem(getDataKey('fp_aurora_srs'));
    localStorage.removeItem(getDataKey('fp_aurora_mastered'));
    localStorage.removeItem('fp_aurora_points');
    localStorage.removeItem('fp_aurora_time');
    
    saveProgressToCloud();
    renderDashboard();
    showToast("Đã xoá dữ liệu thành công", "success");
    playSound(SFX.POP);
}

function setupVoice() {
    const voices = window.speechSynthesis.getVoices();
    const targetLang = LANG_CONFIG[currentLang].tts;
    // Try to find exact match for current language
    selectedVoice = voices.find(v => v.lang === targetLang) ||
                    voices.find(v => v.lang.startsWith(targetLang.split('-')[0])) ||
                    voices.find(v => v.name === 'Google US English'); // Fallback
}

// FIX: Function is assigned to window property, which is handled by the global declaration.
window.speakWord = function(e) {
    if(e) e.stopPropagation();
    if(config.muted) return;
    const w = sessionQueue[sessionIndex];
    if(!w) return;
    window.speechSynthesis.cancel();
    // Nếu là mode sentence, đọc cả câu, còn lại đọc từ
    const text = (currentMode === 'sentence' && w.example) ? w.example : w.english;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG_CONFIG[currentLang].tts; 
    u.rate = 0.85; 
    if(selectedVoice) u.voice = selectedVoice;
    window.speechSynthesis.speak(u);
}

function applyTheme() {
    document.body.classList.toggle('dark-mode', config.darkMode);
    document.getElementById('themeBtn').innerHTML = config.darkMode ? '<i class="fas fa-sun" style="color:#fcd34d"></i>' : '<i class="fas fa-moon" style="color:#fff"></i>';
}
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.toggleTheme = function() { config.darkMode = !config.darkMode; localStorage.setItem('fp_aurora_dark', String(config.darkMode)); applyTheme(); playSound(SFX.POP); saveProgressToCloud(); }
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.toggleMute = function() { config.muted = !config.muted; localStorage.setItem('fp_aurora_muted', String(config.muted)); updateMuteIcon(); saveProgressToCloud(); }
function updateMuteIcon() { document.getElementById('muteIcon').className = config.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up'; }
// FIX: Function is assigned to window property, which is handled by the global declaration.
window.saveConfig = function() {
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    config.newLimit = parseInt((document.getElementById('cfgNewLimit') as HTMLInputElement).value, 10);
    // FIX: Cast element to HTMLInputElement to access 'value' property.
    config.reviewLimit = parseInt((document.getElementById('cfgReviewLimit') as HTMLInputElement).value, 10);
    // FIX: Ensure value passed to localStorage.setItem is a string.
    localStorage.setItem('fp_aurora_cfg_new', String(config.newLimit));
    // FIX: Ensure value passed to localStorage.setItem is a string.
    localStorage.setItem('fp_aurora_cfg_review', String(config.reviewLimit));
    saveProgressToCloud();
    updateConfigUI();
}
function updateConfigUI() {
    // FIX: Cast element to HTMLInputElement to access 'value' property and ensure value is a string.
    (document.getElementById('cfgNewLimit') as HTMLInputElement).value = String(config.newLimit);
    // FIX: Ensure value assigned to innerText is a string.
    document.getElementById('dispLimitNew').innerText = String(config.newLimit);
    // FIX: Cast element to HTMLInputElement to access 'value' property and ensure value is a string.
    (document.getElementById('cfgReviewLimit') as HTMLInputElement).value = String(config.reviewLimit);
    // FIX: Ensure value assigned to innerText is a string.
    document.getElementById('dispLimitReview').innerText = String(config.reviewLimit);
}
