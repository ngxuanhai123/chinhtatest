import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { UserProfile, Topic, SRSData } from './types';

// --- Firebase Config ---
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
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// --- Auth ---
export const loginGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const logoutGoogle = async () => signOut(auth);

// --- GitHub Fetcher ---
export const fetchTopics = async (lang: string, source: 'basic' | 'advanced' = 'basic'): Promise<Record<string, Topic>> => {
  let user = 'ngxuanhai123';
  let repo = 'tuvung';

  if (lang === 'id') {
    repo = 'indo';
  } else if (lang === 'en') {
    repo = source === 'advanced' ? '3000tv' : 'tuvung';
  }

  try {
    const api = `https://api.github.com/repos/${user}/${repo}/contents/`;
    const res = await fetch(api);
    if (!res.ok) throw new Error("Repo connect failed");

    const files = await res.json();
    const jsonFiles = files.filter((f: any) => f.name.endsWith('.json'));

    const topics: Record<string, Topic> = {};
    
    // Fetch parallel
    await Promise.all(jsonFiles.map(async (f: any) => {
        try {
            const raw = await fetch(f.download_url);
            const data = await raw.json();
            const words = Array.isArray(data) ? data : (data.words || []);
            if (words.length) {
                topics[f.name] = {
                    name: (data.name || f.name.replace('.json', '')).replace(/_/g, ' '),
                    words: words
                };
            }
        } catch (e) {
            console.warn(`Failed to load ${f.name}`);
        }
    }));

    return topics;
  } catch (e) {
    console.error(e);
    return {};
  }
};

// --- Image Service ---
// Using polliniations.ai for consistent, fast, free generative images
export const getImageUrl = (word: string) => {
    const prompt = encodeURIComponent(`${word} minimalistic vector flat illustration cute icon`);
    return `https://image.pollinations.ai/prompt/${prompt}?width=400&height=300&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
}

// Preload helper
export const preloadImage = (url: string) => {
    const img = new Image();
    img.src = url;
};
