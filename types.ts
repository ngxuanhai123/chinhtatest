export interface Word {
  english: string;
  vietnamese: string;
  ipa?: string;
  example?: string;
  type?: string;
}

export interface Topic {
  name: string;
  words: Word[];
}

export interface SRSData {
  level: number;
  interval: number;
  nextReview: number;
  consecutiveWrongs: number;
  isHard?: boolean;
}

export interface UserConfig {
  newLimit: number;
  reviewLimit: number;
  darkMode: boolean;
  muted: boolean;
  repoSource: 'basic' | 'advanced'; // For English
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  score: number;
  scores?: Record<string, number>; // Breakdown by language
  studyTime: number;
  monthKey?: string;
}

export type GameMode = 'flashcard_all' | 'fill' | 'sentence' | 'matching' | 'quiz' | 'spelling' | 'smart';
export type Language = 'en' | 'id';
