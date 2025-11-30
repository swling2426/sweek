
export enum Role {
  SEEKER = 'SEEKER', // 守书人
  HIDER = 'HIDER',   // 夜读者
}

export enum TileType {
  FLOOR = 0,
  WALL = 1,
  BOOKSHELF = 2, // 高层书架 (阻挡视野)
  STATUE = 3,    // 雕像 (躲藏点)
  BOOK_STAND = 4, // 古籍台 (任务点)
  EXIT = 5,
}

export interface Position {
  x: number;
  y: number;
}

export interface Entity {
  id: string;
  role: Role;
  pos: Position;
  isAi: boolean;
  isCaught: boolean; // 被传送至地下室
  isDisguised: boolean; // 伪装状态
  isFixing: boolean; // 修复中
  fixProgress: number; // 0-100
  lastMoveTime: number;
  // Multiplayer additions
  isLocalPlayer?: boolean; 
  playerName?: string;
}

export interface BookTarget {
  id: string;
  pos: Position;
  isFixed: boolean;
  title: string; // Gemini 生成
  lore: string;  // Gemini 生成
}

export interface LogMessage {
  id: number;
  text: string;
  type: 'info' | 'warning' | 'danger' | 'success' | 'chat'; // Added 'chat'
  sender?: string; // Added sender
}

export interface GameConfig {
  mapSize: number;
  totalBooks: number;
  timeLimit: number; // seconds
}

export enum GameStatus {
  MENU,
  LOBBY,
  PLAYING,
  WON,
  LOST,
}

// Networking
export type NetworkMode = 'NONE' | 'HOST' | 'CLIENT';

export interface NetworkPacket {
  type: 'SYNC' | 'INPUT' | 'START' | 'CHAT'; // Added CHAT
  payload: any;
}
