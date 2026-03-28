import { RemotePlayer } from "../hooks/useMultiplayer";
import { TileState } from "../lib/evaluate";

// Shared type — exported so Game.tsx can use it without circular imports
export interface GuildRecord {
  userId: string;
  username: string;
  avatarHash: string | null;
  evaluations: TileState[][];
  completed: boolean;
  won: boolean;
  wordLength: number;
}

function avatarUrl(userId: string, avatarHash: string | null): string | null {
  return avatarHash
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`
    : null;
}

interface PlayerCardProps {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  evaluations: TileState[][];
  score: string;
  wordLength: number;
  isLive?: boolean;
}

function PlayerCard({ userId, displayName, avatarHash, evaluations, score, wordLength, isLive }: PlayerCardProps) {
  const url = avatarUrl(userId, avatarHash);
  const initial = (displayName || "?")[0].toUpperCase();

  return (
    <div className={`spec-card${isLive ? " spec-card--live" : ""}`}>
      {/* Avatar */}
      {url ? (
        <img
          className="spec-avatar"
          src={url}
          alt={displayName}
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            const sib = el.nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = "flex";
          }}
        />
      ) : null}
      <div
        className="spec-avatar spec-avatar--fallback"
        style={{ display: url ? "none" : "flex" }}
      >
        {initial}
      </div>

      {/* Score */}
      <span className="spec-score">{score}</span>

      {/* Mini grid — always 6 rows */}
      <div className="mini-grid">
        {Array(6).fill(null).map((_, i) => (
          <div key={i} className="mini-row">
            {Array(wordLength).fill(null).map((__, j) => {
              const state = evaluations[i]?.[j];
              return <span key={j} className="mini-tile" data-state={state ?? "empty"} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SpectatorPanelProps {
  players: RemotePlayer[];
  guildRecords: GuildRecord[];
  myUserId: string;
  wordLength: number;
}

export function SpectatorPanel({ players, guildRecords, myUserId, wordLength }: SpectatorPanelProps) {
  // Only show live players in the current mode
  const livePlayers = players.filter((p) => p.wordLength === wordLength);
  const liveIds = new Set(livePlayers.map((p) => p.userId));

  // DB completed records — exclude self and anyone already in live list, filter by mode
  const completedRecords = guildRecords.filter(
    (r) => r.completed && r.userId !== myUserId && !liveIds.has(r.userId) && r.wordLength === wordLength
  );

  if (livePlayers.length === 0 && completedRecords.length === 0) return null;

  return (
    <div className="spectator-panel">
      {livePlayers.map((p) => (
        <PlayerCard
          key={p.userId}
          userId={p.userId}
          displayName={p.displayName}
          avatarHash={p.avatarHash}
          evaluations={p.evaluations}
          score={p.evaluations.length > 0 ? `${p.evaluations.length}/6…` : "—"}
          wordLength={wordLength}
          isLive
        />
      ))}
      {completedRecords.map((r) => (
        <PlayerCard
          key={r.userId}
          userId={r.userId}
          displayName={r.username}
          avatarHash={r.avatarHash}
          evaluations={r.evaluations}
          score={r.won ? `${r.evaluations.length}/6` : "X/6"}
          wordLength={r.wordLength}
        />
      ))}
    </div>
  );
}
