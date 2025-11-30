
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameMap } from './components/GameMap';
import { generateBookLore, generateWhisper, generateEndGameStory } from './services/geminiService';
import { 
    TileType, Role, Entity, Position, GameStatus, BookTarget, LogMessage, NetworkMode, NetworkPacket 
} from './types';
import { 
    Clock, Book, Zap, Volume2, RotateCcw, HeartPulse, User, Ghost, VenetianMask, Users, Copy, Radio, 
    MessageSquare, Send, LogOut, Info
} from 'lucide-react';

// --- Constants ---
const MAP_SIZE = 20;
const TILE_COUNT = MAP_SIZE * MAP_SIZE;
const GAME_DURATION = 600; // 10 minutes
const FIX_TIME_MS = 10000; // 10s to fix
const FIX_TICK = 250;
const DISGUISE_DURATION = 10000;
const DISGUISE_COOLDOWN = 90000; // 90s
const WHISPER_COOLDOWN = 30000; // 30s
const AI_MOVE_INTERVAL = 800; 
const MAX_HIDERS = 3; // Adjusted from 4 to 3 based on request

// PeerJS globally
declare global {
    interface Window {
        Peer: any;
    }
}

// --- Utils ---
const getRandomPos = (map: TileType[][]): Position => {
    let x, y;
    let attempts = 0;
    do {
        x = Math.floor(Math.random() * MAP_SIZE);
        y = Math.floor(Math.random() * MAP_SIZE);
        attempts++;
        if (attempts > 1000) return {x:0, y:0}; // Fallback
    } while (map[y][x] === TileType.WALL || map[y][x] === TileType.BOOKSHELF);
    return { x, y };
};

const createMap = (): TileType[][] => {
    const map = Array(MAP_SIZE).fill(0).map(() => Array(MAP_SIZE).fill(TileType.FLOOR));
    
    // Create random walls and shelves (maze-like)
    for (let i = 0; i < TILE_COUNT / 3.5; i++) {
        const x = Math.floor(Math.random() * MAP_SIZE);
        const y = Math.floor(Math.random() * MAP_SIZE);
        if (Math.random() > 0.6) map[y][x] = TileType.BOOKSHELF;
        else map[y][x] = TileType.WALL;
    }

    // Clear center
    for(let y=8; y<12; y++) {
        for(let x=8; x<12; x++) {
            map[y][x] = TileType.FLOOR;
        }
    }

    // Add statues
    for (let i = 0; i < 12; i++) {
        const x = Math.floor(Math.random() * MAP_SIZE);
        const y = Math.floor(Math.random() * MAP_SIZE);
        if (map[y][x] === TileType.FLOOR) map[y][x] = TileType.STATUE;
    }

    return map;
};

// --- Main Component ---
export default function App() {
    // -- State --
    const [status, setStatus] = useState<GameStatus>(GameStatus.MENU);
    const [map, setMap] = useState<TileType[][]>([]);
    const [myRole, setMyRole] = useState<Role>(Role.HIDER);
    const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [entities, setEntities] = useState<Entity[]>([]);
    const [books, setBooks] = useState<BookTarget[]>([]);
    const [endStory, setEndStory] = useState<string>("");
    const [skillCooldown, setSkillCooldown] = useState(0);
    const [terrorLevel, setTerrorLevel] = useState(0); // 0.0 to 1.0
    const [chatInput, setChatInput] = useState("");

    // -- Networking State --
    const [networkMode, setNetworkMode] = useState<NetworkMode>('NONE');
    const [peerId, setPeerId] = useState<string>('');
    const [targetPeerId, setTargetPeerId] = useState<string>('');
    const [isConnected, setIsConnected] = useState(false);
    
    // Refs
    const peerRef = useRef<any>(null);
    const connRef = useRef<any>(null);
    const gameStateRef = useRef({ entities, books, status, timeLeft, map });
    
    // Keep ref updated
    useEffect(() => {
        gameStateRef.current = { entities, books, status, timeLeft, map };
    }, [entities, books, status, timeLeft, map]);

    const addLog = (text: string, type: LogMessage['type'] = 'info', sender?: string) => {
        setLogs(prev => [{ id: Date.now(), text, type, sender }, ...prev].slice(0, 50));
    };

    // --- Networking Logic ---
    const initPeer = (mode: NetworkMode) => {
        if (!window.Peer) return;
        
        // Clean up old
        if (peerRef.current) peerRef.current.destroy();

        const peer = new window.Peer(null, {
            debug: 2
        });

        peer.on('open', (id: string) => {
            setPeerId(id);
            setNetworkMode(mode);
            setStatus(GameStatus.LOBBY);
        });

        peer.on('connection', (conn: any) => {
            // Only Host accepts connections
            if (mode === 'HOST') {
                connRef.current = conn;
                setIsConnected(true);
                addLog("另一位玩家已连接!", 'success');
                setupConnection(conn);
            }
        });

        peer.on('error', (err: any) => {
            console.error(err);
            addLog("连接错误: " + err.type, 'danger');
        });

        peerRef.current = peer;
    };

    const joinGame = () => {
        if (!peerRef.current || !targetPeerId) return;
        const conn = peerRef.current.connect(targetPeerId);
        connRef.current = conn;
        
        conn.on('open', () => {
            setIsConnected(true);
            addLog("已连接到房主!", 'success');
            setupConnection(conn);
        });
    };

    const setupConnection = (conn: any) => {
        conn.on('data', (data: NetworkPacket) => {
            handleNetworkData(data);
        });
        
        conn.on('close', () => {
             addLog("连接已断开", 'danger');
             setIsConnected(false);
             if (status === GameStatus.PLAYING) {
                 endGame(false, "连接中断", false); // Force end
             }
        });
    };

    const handleNetworkData = (data: NetworkPacket) => {
        if (data.type === 'SYNC') {
            // Client receives state from Host
            if (networkMode === 'CLIENT') {
                if (data.payload.map) setMap(data.payload.map); // Only sent once usually
                setEntities(data.payload.entities);
                setBooks(data.payload.books);
                setTimeLeft(data.payload.timeLeft);
                if (data.payload.status && status !== data.payload.status) {
                    setStatus(data.payload.status);
                    if (data.payload.status === GameStatus.PLAYING) addLog("游戏开始！", 'warning');
                }
            }
        } else if (data.type === 'INPUT') {
            // Host receives input from Client
            if (networkMode === 'HOST') {
                processClientInput(data.payload);
            }
        } else if (data.type === 'CHAT') {
            addLog(data.payload.text, 'chat', data.payload.sender);
        }
    };

    const processClientInput = (input: { playerId: string, action: string, dir?: {x:number, y:number} }) => {
        // Host logic to update client entity
        if (status !== GameStatus.PLAYING) return;
        
        setEntities(prev => {
            const newEntities = [...prev];
            const entityIdx = newEntities.findIndex(e => e.id === input.playerId);
            if (entityIdx === -1) return prev;
            
            const entity = newEntities[entityIdx];
            if (entity.isCaught || entity.isFixing) return prev;

            if (input.action === 'MOVE' && input.dir) {
                const nx = entity.pos.x + input.dir.x;
                const ny = entity.pos.y + input.dir.y;
                if (isValidMove(nx, ny, gameStateRef.current.map)) {
                    entity.pos = { x: nx, y: ny };
                    entity.lastMoveTime = Date.now();
                }
            } else if (input.action === 'ACTION') {
                handleActionForEntity(entity.id);
            }
            return newEntities;
        });
    };

    const sendChat = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!chatInput.trim()) return;

        const senderName = networkMode === 'HOST' ? '房主' : (networkMode === 'CLIENT' ? '玩家' : '我');
        addLog(chatInput, 'chat', senderName);

        if (connRef.current) {
            connRef.current.send({
                type: 'CHAT',
                payload: { text: chatInput, sender: senderName }
            });
        }
        setChatInput("");
    };

    const exitToMenu = () => {
        // Cleanup Networking
        if (peerRef.current) {
            peerRef.current.destroy();
            peerRef.current = null;
        }
        connRef.current = null;
        setIsConnected(false);
        setNetworkMode('NONE');

        // Cleanup Game State
        setStatus(GameStatus.MENU);
        setLogs([]);
        setMap([]);
        setEntities([]);
        setBooks([]);
        setEndStory("");
        setTerrorLevel(0);
    };

    const isValidMove = (x: number, y: number, mapData: TileType[][]) => {
        if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) return false;
        const tile = mapData[y][x];
        return tile !== TileType.WALL && tile !== TileType.BOOKSHELF;
    };

    // --- AI Pathfinding (BFS) ---
    const getBFSNextMove = (start: Position, target: Position, mapGrid: TileType[][]): Position => {
        if (start.x === target.x && start.y === target.y) return start;

        const queue: { pos: Position, firstMove: Position | null }[] = [];
        const visited = new Set<string>();
        
        queue.push({ pos: start, firstMove: null });
        visited.add(`${start.x},${start.y}`);

        while (queue.length > 0) {
            const { pos, firstMove } = queue.shift()!;

            if (pos.x === target.x && pos.y === target.y) {
                return firstMove || start;
            }

            const dirs = [{x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0}];
            // Shuffle dirs to make AI less predictable when multiple paths exist
            dirs.sort(() => Math.random() - 0.5);

            for (let d of dirs) {
                const nx = pos.x + d.x;
                const ny = pos.y + d.y;
                const key = `${nx},${ny}`;

                if (nx >= 0 && nx < MAP_SIZE && ny >= 0 && ny < MAP_SIZE && !visited.has(key)) {
                    const tile = mapGrid[ny][nx];
                    if (tile !== TileType.WALL && tile !== TileType.BOOKSHELF) {
                        visited.add(key);
                        // If this is the immediate neighbor of start, it becomes the firstMove candidates
                        const newFirstMove = firstMove ? firstMove : { x: nx, y: ny };
                        queue.push({ pos: { x: nx, y: ny }, firstMove: newFirstMove });
                    }
                }
            }
        }

        // If no path found (target blocked), stay or move random valid
        return start;
    };

    // --- Game Logic ---
    const startGame = async (isHost: boolean, hostRole: Role) => {
        const newMap = createMap();
        setMap(newMap);
        setMyRole(hostRole); // For local/host UI
        setStatus(GameStatus.PLAYING);
        setTimeLeft(GAME_DURATION);
        setLogs([]);
        setSkillCooldown(0);
        setEndStory("");

        // Spawn Books
        const newBooks: BookTarget[] = [];
        for (let i = 0; i < 5; i++) {
            let pos = getRandomPos(newMap);
            newMap[pos.y][pos.x] = TileType.BOOK_STAND;
            newBooks.push({
                id: `book-${i}`,
                pos,
                isFixed: false,
                title: "未知古籍",
                lore: "散发着不祥的气息。"
            });
        }
        setBooks(newBooks);

        // Spawn Entities
        const newEntities: Entity[] = [];
        
        // Helper to add bots
        const addBotHider = (index: number) => {
            newEntities.push({ id: `bot-hider-${index}`, role: Role.HIDER, pos: getRandomPos(newMap), isAi: true, isCaught: false, isDisguised: false, isFixing: false, fixProgress: 0, lastMoveTime: 0 });
        }

        if (networkMode === 'NONE') {
            // Single Player
            newEntities.push({ id: 'player', role: hostRole, pos: getRandomPos(newMap), isAi: false, isCaught: false, isDisguised: false, isFixing: false, fixProgress: 0, lastMoveTime: 0, isLocalPlayer: true });
            
            if (hostRole === Role.HIDER) {
                // Player is Hider. Needs 1 Seeker Bot and (MAX_HIDERS - 1) Hider Bots
                newEntities.push({ id: 'bot-seeker', role: Role.SEEKER, pos: getRandomPos(newMap), isAi: true, isCaught: false, isDisguised: false, isFixing: false, fixProgress: 0, lastMoveTime: 0 });
                for(let i = 0; i < MAX_HIDERS - 1; i++) addBotHider(i);
            } else {
                // Player is Seeker. Needs MAX_HIDERS Hider Bots
                for(let i = 0; i < MAX_HIDERS; i++) addBotHider(i);
            }
        } else {
            // Multiplayer
            const clientRole = hostRole === Role.SEEKER ? Role.HIDER : Role.SEEKER;
            
            // Host Entity
            newEntities.push({ id: 'host-player', role: hostRole, pos: getRandomPos(newMap), isAi: false, isCaught: false, isDisguised: false, isFixing: false, fixProgress: 0, lastMoveTime: 0, isLocalPlayer: isHost });
            // Client Entity
            newEntities.push({ id: 'client-player', role: clientRole, pos: getRandomPos(newMap), isAi: false, isCaught: false, isDisguised: false, isFixing: false, fixProgress: 0, lastMoveTime: 0, isLocalPlayer: !isHost });

            // Calculate remaining slots for bots
            // Count human hiders
            const humanHiders = (hostRole === Role.HIDER ? 1 : 0) + (clientRole === Role.HIDER ? 1 : 0);
            const botsNeeded = Math.max(0, MAX_HIDERS - humanHiders);
            
            for(let i=0; i < botsNeeded; i++) {
                addBotHider(i);
            }

            // Sync Initial Map to Client
            if (isHost && connRef.current) {
                connRef.current.send({
                    type: 'SYNC',
                    payload: { map: newMap, entities: newEntities, books: newBooks, timeLeft: GAME_DURATION, status: GameStatus.PLAYING }
                });
            }
        }

        setEntities(newEntities);
        addLog("午夜图书馆的大门打开了...", 'warning');

        // Pre-fetch lore
        generateBookLore().then(lore => {
             setBooks(prev => prev.map((b, i) => i === 0 ? { ...b, ...lore } : b));
        });
    };

    // --- Host Loop ---
    useEffect(() => {
        if (status !== GameStatus.PLAYING) return;
        // Only Host or Single Player runs the game loop logic
        if (networkMode === 'CLIENT') return;

        const timerInterval = setInterval(() => {
            setTimeLeft(t => {
                if (t <= 1) {
                    endGame(false, "时间耗尽。", true);
                    return 0;
                }
                return t - 1;
            });
            
            setSkillCooldown(c => c > 0 ? c - 1 : 0);

            // Host sends sync packet every second (optimization: could be faster but lighter)
            if (networkMode === 'HOST' && connRef.current) {
                connRef.current.send({
                    type: 'SYNC',
                    payload: { 
                        entities: gameStateRef.current.entities, 
                        books: gameStateRef.current.books,
                        timeLeft: gameStateRef.current.timeLeft,
                        status: gameStateRef.current.status 
                    }
                });
            }

        }, 1000);

        const aiInterval = setInterval(() => {
            updateHostLogic();
        }, AI_MOVE_INTERVAL);

        return () => {
            clearInterval(timerInterval);
            clearInterval(aiInterval);
        };
    }, [status, networkMode]);

    // --- AI & Host Physics ---
    const updateHostLogic = () => {
        setEntities(prevEntities => {
            const currentBooks = gameStateRef.current.books;
            const newEntities = [...prevEntities];

            const seeker = newEntities.find(e => e.role === Role.SEEKER);
            const hiders = newEntities.filter(e => e.role === Role.HIDER && !e.isCaught);

            if (!seeker) return newEntities;

            // 1. Move AI Seeker
            if (seeker.isAi) {
                let target = null;
                let minDist = 999;
                
                // Prioritize visible/close hiders
                hiders.forEach(h => {
                    const d = Math.abs(h.pos.x - seeker.pos.x) + Math.abs(h.pos.y - seeker.pos.y);
                    if (d < 8 && !h.isDisguised && d < minDist) { 
                        minDist = d;
                        target = h.pos;
                    }
                });

                // If no hiders nearby, check books
                if (!target) {
                    const unfixedBooks = currentBooks.filter(b => !b.isFixed);
                    // Chance to check a random book or just patrol
                    if (unfixedBooks.length > 0 && Math.random() > 0.3) {
                         // Pick nearest book occasionally
                         target = unfixedBooks[Math.floor(Math.random() * unfixedBooks.length)].pos;
                    } else {
                        // Wander to random spot
                        target = getRandomPos(map); 
                    }
                }

                // Use BFS for intelligent pathfinding
                seeker.pos = getBFSNextMove(seeker.pos, target, map);
            }

            // 2. Move AI Hiders
            hiders.forEach(h => {
                if (h.isAi) {
                    if (h.isFixing) {
                        h.fixProgress += (100 / (FIX_TIME_MS / AI_MOVE_INTERVAL));
                        if (h.fixProgress >= 100) {
                            const bookIndex = currentBooks.findIndex(b => b.pos.x === h.pos.x && b.pos.y === h.pos.y);
                            if (bookIndex !== -1 && !currentBooks[bookIndex].isFixed) {
                                fixBookComplete(currentBooks[bookIndex].id);
                            }
                            h.isFixing = false;
                            h.fixProgress = 0;
                        }
                        const dToSeeker = Math.abs(h.pos.x - seeker.pos.x) + Math.abs(h.pos.y - seeker.pos.y);
                        if (dToSeeker < 4) h.isFixing = false;
                    } else {
                        const dToSeeker = Math.abs(h.pos.x - seeker.pos.x) + Math.abs(h.pos.y - seeker.pos.y);
                        if (dToSeeker < 5) {
                            // Simple flee (away from seeker)
                            const fleeX = h.pos.x + (h.pos.x - seeker.pos.x);
                            const fleeY = h.pos.y + (h.pos.y - seeker.pos.y);
                            // Ensure flee target is somewhat valid to avoid bouncing against walls forever
                            // For hiders, simple greedy + random is usually enough "panic" behavior
                            const targetFlee = { x: fleeX, y: fleeY };
                            h.pos = getBFSNextMove(h.pos, targetFlee, map); 
                        } else {
                             const unfixed = currentBooks.filter(b => !b.isFixed);
                             if (unfixed.length > 0) {
                                 // Find closest book
                                 let closestBook = unfixed[0];
                                 let closestD = 999;
                                 unfixed.forEach(b => {
                                     const d = Math.abs(h.pos.x - b.pos.x) + Math.abs(h.pos.y - b.pos.y);
                                     if(d < closestD) { closestD = d; closestBook = b; }
                                 });

                                 if (h.pos.x === closestBook.pos.x && h.pos.y === closestBook.pos.y) {
                                     h.isFixing = true;
                                     h.fixProgress = 0;
                                 } else {
                                     h.pos = getBFSNextMove(h.pos, closestBook.pos, map);
                                 }
                             }
                        }
                    }
                }
            });

            // 3. Catch Logic
            hiders.forEach(h => {
                if (h.pos.x === seeker.pos.x && h.pos.y === seeker.pos.y && !h.isDisguised) {
                    h.isCaught = true;
                    h.isFixing = false;
                    addLog(h.isLocalPlayer ? "你被抓住了！" : "一声惨叫回荡在图书馆...", 'danger');
                    if (h.isLocalPlayer) {
                        // If Client was caught
                    }
                }
            });

            // Win Condition
            const activeHiders = hiders.filter(h => !h.isCaught);
            if (activeHiders.length === 0) {
                endGame(true, "所有罪人都已伏法。", true); // Seeker wins
            }

            // Sync fast updates (like movement) for smoother host XP
            if (networkMode === 'HOST' && connRef.current) {
                 connRef.current.send({
                    type: 'SYNC',
                    payload: { 
                        entities: newEntities, 
                        books: currentBooks,
                        timeLeft: gameStateRef.current.timeLeft,
                        status: gameStateRef.current.status
                    }
                });
            }

            return newEntities;
        });
    };

    // --- Interaction ---
    const handleMove = useCallback((dx: number, dy: number) => {
        if (status !== GameStatus.PLAYING) return;
        
        const myId = networkMode === 'NONE' ? 'player' : (networkMode === 'HOST' ? 'host-player' : 'client-player');

        if (networkMode === 'CLIENT') {
            // Send request to host
            if (connRef.current) {
                connRef.current.send({
                    type: 'INPUT',
                    payload: { playerId: myId, action: 'MOVE', dir: {x: dx, y: dy} }
                });
            }
            return;
        }

        // Host/Local Move
        setEntities(prev => {
            const newEntities = [...prev];
            const pIdx = newEntities.findIndex(e => e.id === myId);
            if (pIdx === -1) return prev;
            
            const player = newEntities[pIdx];
            if (player.isCaught || player.isFixing || player.isDisguised) return prev;

            const nx = player.pos.x + dx;
            const ny = player.pos.y + dy;

            if (isValidMove(nx, ny, map)) {
                player.pos = { x: nx, y: ny };
                
                if (map[ny][nx] === TileType.BOOK_STAND && player.role === Role.HIDER) {
                     addLog("按空格键修复古籍。", 'info');
                }
            }
            return newEntities;
        });
    }, [map, status, networkMode]);

    const handleAction = useCallback(() => {
        if (status !== GameStatus.PLAYING) return;
        const myId = networkMode === 'NONE' ? 'player' : (networkMode === 'HOST' ? 'host-player' : 'client-player');

        if (networkMode === 'CLIENT') {
             if (connRef.current) {
                connRef.current.send({
                    type: 'INPUT',
                    payload: { playerId: myId, action: 'ACTION' }
                });
            }
            return;
        }

        handleActionForEntity(myId);
    }, [status, networkMode]);

    const handleActionForEntity = (entityId: string) => {
        setEntities(prev => {
            const player = prev.find(e => e.id === entityId);
            if (!player || player.isCaught) return prev;
            
            // Logic similar to single player but generalized
            if (player.role === Role.HIDER) {
                const onBook = gameStateRef.current.books.find(b => b.pos.x === player.pos.x && b.pos.y === player.pos.y);
                if (onBook && !onBook.isFixed) {
                    if (player.isFixing) {
                        return prev.map(e => e.id === entityId ? { ...e, isFixing: false, fixProgress: 0 } : e);
                    } else {
                        // Start fixing
                        addLog("正在修复古籍... (保持静止)", 'info');
                        if (onBook.title === "未知古籍") {
                            generateBookLore().then(lore => {
                                setBooks(bs => bs.map(b => b.id === onBook.id ? { ...b, ...lore } : b));
                            });
                        }
                        
                        // Start interval specifically for this entity
                        const intervalId = setInterval(() => {
                            setEntities(curr => {
                                const p = curr.find(e => e.id === entityId);
                                if (!p || !p.isFixing) {
                                    clearInterval(intervalId);
                                    return curr;
                                }
                                const newProgress = p.fixProgress + (100 / (FIX_TIME_MS / FIX_TICK));
                                if (newProgress >= 100) {
                                    clearInterval(intervalId);
                                    fixBookComplete(onBook.id);
                                    return curr.map(e => e.id === entityId ? { ...e, isFixing: false, fixProgress: 0 } : e);
                                }
                                return curr.map(e => e.id === entityId ? { ...e, fixProgress: newProgress } : e);
                            });
                        }, FIX_TICK);

                        return prev.map(e => e.id === entityId ? { ...e, isFixing: true } : e);
                    }
                } else {
                    // Disguise
                     const tile = gameStateRef.current.map[player.pos.y][player.pos.x];
                     if (tile === TileType.STATUE && skillCooldown <= 0) {
                         setSkillCooldown(DISGUISE_COOLDOWN / 1000);
                         addLog("你融入了阴影...", 'success');
                         setTimeout(() => {
                            setEntities(ps => ps.map(e => e.id === entityId ? { ...e, isDisguised: false } : e));
                         }, DISGUISE_DURATION);
                         return prev.map(e => e.id === entityId ? { ...e, isDisguised: true } : e);
                     } else if (skillCooldown <= 0 && tile !== TileType.STATUE) {
                         addLog("你需要靠近雕像才能伪装！", 'warning');
                     }
                }
            } else {
                // Seeker Whisper
                if (skillCooldown <= 0) {
                    const hiders = prev.filter(e => e.role === Role.HIDER && !e.isCaught);
                    if (hiders.length > 0) {
                        setSkillCooldown(WHISPER_COOLDOWN / 1000);
                        generateWhisper("The seeker is hunting nearby prey").then(msg => {
                             addLog(`低语: "${msg}"`, 'danger');
                        });
                        const closest = hiders[0]; 
                        const dx = closest.pos.x - player.pos.x;
                        const dy = closest.pos.y - player.pos.y;
                        let dir = "";
                        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "东" : "西";
                        else dir = dy > 0 ? "南" : "北";
                        addLog(`声音指引向${dir}方...`, 'info');
                    }
                }
            }
            return prev;
        });
    };

    const fixBookComplete = (bookId: string) => {
        setBooks(prev => {
            const newBooks = prev.map(b => b.id === bookId ? { ...b, isFixed: true } : b);
            const fixedCount = newBooks.filter(b => b.isFixed).length;
            
            if (fixedCount >= newBooks.length) {
                endGame(true, "古籍已修复，诅咒解除！", false); // Hiders win
            } else {
                addLog(`古籍已修复! (${fixedCount}/${newBooks.length})`, 'success');
            }
            return newBooks;
        });
    };

    const endGame = async (winConditionMet: boolean, reason: string, seekerWins: boolean) => {
        // Logic inversion depending on who I am
        const iAmSeeker = myRole === Role.SEEKER;
        const iWon = iAmSeeker ? seekerWins : !seekerWins;

        setStatus(iWon ? GameStatus.WON : GameStatus.LOST);
        
        // Sync End State
        if (networkMode === 'HOST' && connRef.current) {
            connRef.current.send({
                type: 'SYNC',
                payload: { entities: [], books: [], timeLeft: 0, status: iWon ? GameStatus.WON : GameStatus.LOST } 
            });
        }

        const survivors = entities.filter(e => e.role === Role.HIDER && !e.isCaught).length;
        const story = await generateEndGameStory(iWon, myRole === Role.HIDER ? "夜读者" : "守书人", survivors);
        setEndStory(story);
    };

    // --- Terror Heartbeat Effect ---
    useEffect(() => {
        if (status !== GameStatus.PLAYING) return;
        const myId = networkMode === 'NONE' ? 'player' : (networkMode === 'HOST' ? 'host-player' : 'client-player');
        const me = entities.find(e => e.id === myId);
        if (!me || me.role === Role.SEEKER) {
            setTerrorLevel(0);
            return;
        }

        const seeker = entities.find(e => e.role === Role.SEEKER);
        if (seeker) {
            const dist = Math.sqrt(Math.pow(seeker.pos.x - me.pos.x, 2) + Math.pow(seeker.pos.y - me.pos.y, 2));
            if (dist < 6) {
                setTerrorLevel(1 - (dist / 6)); // Closer = Higher
            } else {
                setTerrorLevel(0);
            }
        }
    }, [entities, status, networkMode]);

    // --- Inputs ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (status !== GameStatus.PLAYING) return;
            // Avoid capturing input if typing in chat
            if (document.activeElement?.tagName === 'INPUT') return;

            switch(e.key) {
                case 'ArrowUp': case 'w': handleMove(0, -1); break;
                case 'ArrowDown': case 's': handleMove(0, 1); break;
                case 'ArrowLeft': case 'a': handleMove(-1, 0); break;
                case 'ArrowRight': case 'd': handleMove(1, 0); break;
                case ' ': handleAction(); break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleMove, handleAction, status]);

    // --- Renders ---

    if (status === GameStatus.MENU) {
        return (
            <div className="min-h-screen bg-lib-dark flex flex-col items-center justify-center text-lib-gold p-4">
                <h1 className="text-6xl font-serif mb-4 text-red-900 tracking-widest animate-pulse font-bold">午夜图书馆</h1>
                <p className="text-xl mb-12 italic text-stone-400">"沉默是你唯一的盾牌"</p>
                
                <div className="flex flex-col gap-4 w-full max-w-md">
                    <button onClick={() => { setNetworkMode('NONE'); setStatus(GameStatus.LOBBY); }} 
                        className="p-4 bg-stone-900 border border-stone-700 hover:border-lib-gold text-xl flex justify-center items-center gap-2">
                        <User /> 单人游戏
                    </button>
                    <button onClick={() => { initPeer('HOST'); }} 
                        className="p-4 bg-stone-900 border border-stone-700 hover:border-red-600 text-xl flex justify-center items-center gap-2">
                        <Radio /> 创建联机房间 (房主)
                    </button>
                    <button onClick={() => { initPeer('CLIENT'); }} 
                        className="p-4 bg-stone-900 border border-stone-700 hover:border-blue-500 text-xl flex justify-center items-center gap-2">
                        <Users /> 加入联机房间
                    </button>
                </div>
            </div>
        );
    }

    if (status === GameStatus.LOBBY) {
        return (
             <div className="min-h-screen bg-lib-dark flex flex-col items-center justify-center text-stone-300 p-4">
                 <div className="w-full max-w-3xl flex flex-col gap-6">
                     <div className="flex justify-between items-center">
                        <h2 className="text-3xl text-lib-gold">游戏大厅</h2>
                        <button onClick={exitToMenu} className="flex items-center gap-2 text-stone-500 hover:text-white">
                            <LogOut size={20}/> 离开
                        </button>
                     </div>
                     
                     {networkMode === 'HOST' && (
                         <div className="bg-lib-wall p-6 rounded text-center border border-stone-700">
                             <p className="mb-2">你的房间 ID:</p>
                             <div className="flex items-center gap-2 bg-black p-2 rounded justify-center mb-4">
                                 <code className="text-emerald-400 text-xl tracking-wider">{peerId}</code>
                                 <button onClick={() => navigator.clipboard.writeText(peerId)} className="p-1 hover:text-white"><Copy size={16}/></button>
                             </div>
                             <p className="text-sm text-stone-500 animate-pulse">等待玩家加入...</p>
                             {isConnected && <p className="text-emerald-400 font-bold mt-2">玩家已连接!</p>}
                         </div>
                     )}

                     {networkMode === 'CLIENT' && !isConnected && (
                         <div className="bg-lib-wall p-6 rounded text-center border border-stone-700">
                             <p className="mb-2">输入房主 ID:</p>
                             <input 
                                type="text" 
                                className="bg-black border border-stone-600 p-2 rounded text-center w-full mb-4 text-white"
                                onChange={(e) => setTargetPeerId(e.target.value)}
                             />
                             <button onClick={joinGame} className="bg-blue-900 px-6 py-2 rounded hover:bg-blue-800 w-full">连接</button>
                         </div>
                     )}

                     {/* Chat Area in Lobby */}
                     {networkMode !== 'NONE' && (
                         <div className="bg-black bg-opacity-40 p-4 rounded border border-stone-800 h-48 flex flex-col">
                             <div className="flex-1 overflow-y-auto mb-2 space-y-1">
                                 {logs.filter(l => l.type === 'chat').map(l => (
                                     <div key={l.id} className="text-sm"><span className="text-stone-500">[{l.sender}]:</span> {l.text}</div>
                                 ))}
                             </div>
                             <form onSubmit={sendChat} className="flex gap-2">
                                 <input 
                                    className="flex-1 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-sm"
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    placeholder="输入消息..."
                                 />
                                 <button type="submit" className="bg-stone-700 px-3 rounded hover:bg-stone-600"><Send size={14}/></button>
                             </form>
                         </div>
                     )}

                     {(networkMode === 'NONE' || (networkMode === 'HOST' && isConnected)) && (
                        <div className="flex gap-8 justify-center">
                            <button onClick={() => startGame(true, Role.HIDER)} className="p-8 border border-stone-600 hover:bg-stone-900 rounded flex flex-col items-center gap-4 transition-colors">
                                <User size={48} className="text-blue-400"/>
                                <span className="text-2xl">夜读者 (Hider)</span>
                            </button>
                            <button onClick={() => startGame(true, Role.SEEKER)} className="p-8 border border-stone-600 hover:bg-stone-900 rounded flex flex-col items-center gap-4 transition-colors">
                                <Ghost size={48} className="text-red-600"/>
                                <span className="text-2xl">守书人 (Seeker)</span>
                            </button>
                        </div>
                     )}

                     {networkMode === 'CLIENT' && isConnected && (
                         <div className="text-center">
                             <p className="text-xl animate-pulse text-stone-400">等待房主开始游戏...</p>
                         </div>
                     )}
                 </div>
             </div>
        );
    }

    if (status === GameStatus.WON || status === GameStatus.LOST) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-8 animate-fade-in">
                <h2 className={`text-6xl font-bold mb-6 ${status === GameStatus.WON ? 'text-emerald-500' : 'text-red-700'}`}>
                    {status === GameStatus.WON ? "逃出生天" : "吞噬殆尽"}
                </h2>
                <div className="max-w-md text-center italic text-stone-400 mb-8 border-l-2 border-stone-700 pl-4 text-lg">
                    {endStory || "书本合上了..."}
                </div>
                <button 
                    onClick={exitToMenu} 
                    className="flex items-center gap-2 px-6 py-3 bg-lib-accent text-white rounded hover:bg-red-800 transition"
                >
                    <RotateCcw size={20} /> 返回菜单
                </button>
            </div>
        );
    }

    // Determine current player ID for UI rendering
    const myId = networkMode === 'NONE' ? 'player' : (networkMode === 'HOST' ? 'host-player' : 'client-player');
    const myEntity = entities.find(e => e.id === myId);
    const myCurrentRole = myEntity?.role || myRole;

    return (
        <div className="min-h-screen bg-lib-dark text-stone-300 flex flex-col items-center p-4">
            
            {/* Header HUD */}
            <div className="w-full max-w-4xl flex justify-between items-center mb-4 bg-lib-wall p-3 rounded border border-stone-800 shadow-lg">
                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 text-xl font-bold ${timeLeft < 60 ? 'text-red-600 animate-pulse' : 'text-stone-300'}`}>
                        <Clock size={24} /> 
                        <span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
                    </div>
                    <div className="flex items-center gap-2 text-lib-gold">
                        <Book size={20} />
                        <span>已修复: {books.filter(b => b.isFixed).length} / {books.length}</span>
                    </div>
                </div>

                <div className="text-stone-500 text-sm flex items-center gap-2">
                     <span className={myCurrentRole === Role.SEEKER ? 'text-red-500 font-bold' : 'text-blue-400 font-bold'}>
                        {myCurrentRole === Role.SEEKER ? "守书人" : "夜读者"}
                     </span>
                     {networkMode !== 'NONE' && <span className="bg-stone-800 px-2 rounded text-xs">联机模式</span>}
                     <button onClick={exitToMenu} className="ml-4 hover:text-white text-stone-600" title="退出游戏"><LogOut size={16}/></button>
                </div>
            </div>

            <div className="flex gap-4">
                {/* Main Game Board */}
                <div className="relative">
                    <GameMap 
                        map={map} 
                        entities={entities} 
                        player={myEntity || entities[0]} 
                        books={books}
                        fogOfWar={true}
                        terrorLevel={terrorLevel}
                    />
                    
                    {/* Interaction Prompt Overlay */}
                    {myEntity?.isFixing && (
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-90 p-6 rounded-lg text-center border-2 border-lib-gold shadow-[0_0_20px_rgba(212,175,55,0.3)]">
                            <h3 className="text-lib-gold font-bold mb-4 animate-pulse text-lg">修复古籍中...</h3>
                            <div className="w-64 h-3 bg-gray-800 rounded-full overflow-hidden border border-gray-600">
                                <div 
                                    className="h-full bg-gradient-to-r from-yellow-600 to-yellow-300 transition-all duration-200" 
                                    style={{ width: `${myEntity.fixProgress}%` }}
                                />
                            </div>
                            <p className="text-xs text-stone-500 mt-2">切勿移动</p>
                        </div>
                    )}
                </div>

                {/* Sidebar Info */}
                <div className="w-64 flex flex-col gap-4">
                    {/* Controls */}
                    <div className="bg-lib-wall p-4 rounded border border-stone-800">
                        <h3 className="text-stone-400 font-bold mb-2 text-sm uppercase">操作指南</h3>
                        <ul className="text-sm space-y-2 text-stone-500">
                            <li className="flex items-center gap-2"><div className="w-6 h-6 border border-stone-600 rounded flex items-center justify-center font-mono">W</div> 移动</li>
                            <li className="flex items-center gap-2"><div className="w-16 h-6 border border-stone-600 rounded flex items-center justify-center text-xs">Space</div> 互动 / 技能</li>
                        </ul>
                    </div>

                    {/* Skill Status */}
                    <div className="bg-lib-wall p-4 rounded border border-stone-800">
                        <h3 className="text-stone-400 font-bold mb-2 text-sm uppercase flex justify-between">
                            特殊能力
                            <Info size={14} className="text-stone-600"/>
                        </h3>
                        <div className="flex items-center gap-2 mb-2">
                            {myCurrentRole === Role.HIDER ? <VenetianMask size={20} className="text-stone-400" /> : <HeartPulse size={20} className="text-red-500" />}
                            <span className="text-sm font-bold text-stone-300">{myCurrentRole === Role.HIDER ? "伪装 (靠近雕像)" : "低语追踪"}</span>
                        </div>
                        <div className="w-full bg-gray-900 h-2 rounded overflow-hidden">
                             <div 
                                className={`h-full ${skillCooldown === 0 ? 'bg-emerald-500' : 'bg-red-900'}`} 
                                style={{ width: `${skillCooldown === 0 ? 100 : 100 - ((skillCooldown / (myCurrentRole === Role.HIDER ? 90 : 30)) * 100)}%` }}
                             />
                        </div>
                        <div className="flex justify-between items-start mt-2">
                             <p className="text-xs text-stone-500 w-3/4 italic leading-tight">
                                {myCurrentRole === Role.HIDER 
                                    ? "靠近雕像按空格键，可暂时隐身并躲避守书人的视野。" 
                                    : "使用技能可获得最近一名夜读者的大致方位提示。"}
                             </p>
                             <p className="text-xs text-stone-600 whitespace-nowrap">{skillCooldown > 0 ? `${Math.ceil(skillCooldown)}s` : "就绪"}</p>
                        </div>
                    </div>

                    {/* Log & Chat */}
                    <div className="flex-1 bg-black bg-opacity-60 p-2 rounded border border-stone-900 overflow-hidden flex flex-col shadow-inner min-h-[200px]">
                        <h3 className="text-stone-600 font-bold text-xs uppercase mb-2 flex items-center gap-2"><MessageSquare size={12}/> 游戏记录</h3>
                        <div className="flex-1 space-y-2 overflow-y-auto mb-2 pr-1">
                            {logs.map(log => (
                                <div key={log.id} className={`text-xs p-1.5 rounded bg-opacity-10 break-words ${
                                    log.type === 'danger' ? 'bg-red-900 text-red-400 border-l-2 border-red-600' :
                                    log.type === 'success' ? 'bg-emerald-900 text-emerald-400 border-l-2 border-emerald-600' :
                                    log.type === 'warning' ? 'bg-amber-900 text-amber-400 border-l-2 border-amber-600' :
                                    log.type === 'chat' ? 'bg-stone-800 text-white border-l-2 border-stone-500' :
                                    'bg-blue-900 text-blue-300 border-l-2 border-blue-600'
                                }`}>
                                    {log.type === 'chat' && log.sender && <span className="font-bold text-stone-400 block mb-0.5">{log.sender}:</span>}
                                    {log.text}
                                </div>
                            ))}
                        </div>
                        {/* Chat Input */}
                        {networkMode !== 'NONE' && (
                             <form onSubmit={sendChat} className="flex gap-1">
                                 <input 
                                    className="flex-1 bg-stone-900 border border-stone-700 rounded px-1.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-stone-500"
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    placeholder="聊天..."
                                 />
                                 <button type="submit" className="bg-stone-800 px-2 rounded hover:bg-stone-700"><Send size={12}/></button>
                             </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
