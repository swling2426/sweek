import React from 'react';
import { TileType, Entity, Role, BookTarget } from '../types';
import { Ghost, User, BookOpen, UserX, VenetianMask, Zap } from 'lucide-react';

interface GameMapProps {
  map: TileType[][];
  entities: Entity[];
  player: Entity;
  books: BookTarget[];
  fogOfWar: boolean;
  terrorLevel: number; // 0-1, affects visuals
}

const TILE_SIZE = 32; // px

export const GameMap: React.FC<GameMapProps> = ({ map, entities, player, books, fogOfWar, terrorLevel }) => {
  // Simple distance check for Fog of War
  const isVisible = (x: number, y: number) => {
    if (!fogOfWar) return true;
    const dist = Math.sqrt(Math.pow(player.pos.x - x, 2) + Math.pow(player.pos.y - y, 2));
    // Seeker sees further, Hider sees less but can hear better (visualized elsewhere)
    const visionRadius = player.role === Role.SEEKER ? 6 : 4; 
    return dist <= visionRadius;
  };

  const getTileStyle = (type: TileType, visible: boolean) => {
    if (!visible) return 'bg-black border-black';
    switch (type) {
      case TileType.WALL: return 'bg-lib-wall border-stone-800';
      case TileType.BOOKSHELF: return 'bg-amber-950 border-amber-900'; // High shelf
      case TileType.STATUE: return 'bg-stone-600 border-stone-500'; // Hiding spot
      case TileType.EXIT: return 'bg-emerald-900 border-emerald-700 animate-pulse';
      case TileType.BOOK_STAND: return 'bg-lib-floor border-lib-accent';
      default: return 'bg-lib-floor border-lib-floor'; // Floor
    }
  };

  const renderEntity = (entity: Entity) => {
    const isSelf = entity.id === player.id;
    
    // Icon Logic
    let Icon = User;
    let color = 'text-blue-400';
    let pulse = false;

    if (entity.role === Role.SEEKER) {
      Icon = Ghost;
      color = 'text-red-600';
      pulse = true;
    } else {
        if (entity.isDisguised) {
            Icon = VenetianMask;
            color = 'text-stone-400';
        } else if (entity.isCaught) {
            Icon = UserX;
            color = 'text-gray-600 opacity-50';
        } else {
            Icon = User;
            // Differentiate Local Player vs Online Partner vs Bots
            color = isSelf ? 'text-amber-300' : (entity.isAi ? 'text-amber-700' : 'text-green-400');
        }
    }

    // Don't render caught entities unless you are the Seeker (you see their souls)
    if (entity.isCaught && player.role !== Role.SEEKER) return null;

    return (
      <div 
        key={entity.id}
        className={`absolute flex items-center justify-center transition-all duration-300 ${color} ${entity.isFixing ? 'animate-bounce' : ''} ${pulse ? 'drop-shadow-[0_0_5px_rgba(220,38,38,0.8)]' : ''}`}
        style={{
          width: TILE_SIZE,
          height: TILE_SIZE,
          left: entity.pos.x * TILE_SIZE,
          top: entity.pos.y * TILE_SIZE,
          zIndex: 20
        }}
      >
        <Icon size={isSelf ? 24 : 20} />
        {entity.isFixing && (
             <div className="absolute -top-2 w-full h-1 bg-gray-700 rounded overflow-hidden">
                <div 
                    className="h-full bg-yellow-400 transition-all duration-200"
                    style={{ width: `${entity.fixProgress}%` }}
                />
             </div>
        )}
        {/* Name Tag for MP */}
        {!entity.isAi && !isSelf && (
          <div className="absolute -bottom-3 text-[8px] bg-black bg-opacity-70 px-1 rounded text-white whitespace-nowrap">
            {entity.role === Role.SEEKER ? '守书人' : '队友'}
          </div>
        )}
      </div>
    );
  };

  const renderedBooks = books.map(book => {
      if (!isVisible(book.pos.x, book.pos.y)) return null;
      return (
        <div 
            key={book.id}
            className={`absolute flex items-center justify-center transition-opacity duration-500`}
            style={{
                width: TILE_SIZE,
                height: TILE_SIZE,
                left: book.pos.x * TILE_SIZE,
                top: book.pos.y * TILE_SIZE,
                zIndex: 10
            }}
        >
            <BookOpen 
                size={20} 
                className={book.isFixed ? 'text-emerald-400' : 'text-lib-gold animate-pulse-fast'} 
            />
        </div>
      );
  });

  return (
    <div className="relative">
        {/* Terror Overlay (Heartbeat) */}
        {terrorLevel > 0 && (
            <div 
                className="absolute inset-0 pointer-events-none z-50 rounded-lg animate-heartbeat"
                style={{
                    boxShadow: `inset 0 0 ${terrorLevel * 100}px rgba(139, 0, 0, ${terrorLevel * 0.5})`
                }}
            />
        )}

        <div 
        className="relative bg-black shadow-2xl border-4 border-lib-wall rounded-lg overflow-hidden"
        style={{
            width: map[0].length * TILE_SIZE,
            height: map.length * TILE_SIZE,
        }}
        >
        {/* Grid Layer */}
        {map.map((row, y) => (
            <div key={y} className="flex">
            {row.map((tile, x) => {
                const visible = isVisible(x, y);
                return (
                <div
                    key={`${x}-${y}`}
                    className={`border border-opacity-10 ${getTileStyle(tile, visible)}`}
                    style={{ width: TILE_SIZE, height: TILE_SIZE }}
                >
                    {/* Visual sugar for hiding spots */}
                    {tile === TileType.STATUE && visible && <div className="text-xs text-center text-stone-400 opacity-50 mt-1">🗿</div>}
                </div>
                );
            })}
            </div>
        ))}

        {/* Book Objects */}
        {renderedBooks}

        {/* Entities Layer */}
        {entities.map(e => {
            // Fog of War Logic for Entities
            // You always see yourself.
            if (e.id === player.id) return renderEntity(e);
            
            const inVision = isVisible(e.pos.x, e.pos.y);
            
            if (!inVision) return null;

            if (player.role === Role.SEEKER && e.role === Role.HIDER && e.isDisguised) {
                // Seeker cannot see disguised hiders unless literally on top of them
                // But let's add a mechanic: if Seeker is adjacent, they might see a "tremble"
                const dist = Math.abs(player.pos.x - e.pos.x) + Math.abs(player.pos.y - e.pos.y);
                if (dist <= 1) return renderEntity(e); // Detected!
                return null;
            }

            return renderEntity(e);
        })}
        </div>
    </div>
  );
};