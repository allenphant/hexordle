import { RemotePlayer } from "../hooks/useMultiplayer";
import { TileState } from "../lib/evaluate";

// Shared type — exported so Game.tsx can use it without circular imports
export interface GuildRecord {
  userId: string;
  username: string;
  evaluations: TileState[][];
  completed: boolean;
  won: boolean;
}

interface MiniGridProps {
  evaluations: TileState[][];
}

function MiniGrid({ evaluations }: MiniGridProps) {
  const rows = Array(6).fill(null);
  return (
    <div className="mini-grid">
      {rows.map((_, i) => (
        <div key={i} className="mini-row">
          {Array(6).fill(null).map((__, j) => {
            const state = evaluations[i]?.[j];
            return <span key={j} className="mini-tile" data-state={state ?? "empty"} />;
          })}
        </div>
      ))}
    </div>
  );
}

interface SpectatorPanelProps {
  players: RemotePlayer[];
  guildRecords: GuildRecord[];
  myUserId: string;
}

export function SpectatorPanel({ players, guildRecords, myUserId }: SpectatorPanelProps) {
  // Live players currently in the same voice channel session
  const liveIds = new Set(players.map((p) => p.userId));

  // Completed guild records — exclude myself and anyone already shown as live
  const completedRecords = guildRecords.filter(
    (r) => r.completed && r.userId !== myUserId && !liveIds.has(r.userId)
  );

  if (players.length === 0 && completedRecords.length === 0) return null;

  return (
    <div className="spectator-panel">
      {players.length > 0 && (
        <>
          <h3 className="spectator-title">Others Playing</h3>
          <div className="spectator-list">
            {players.map((player) => (
              <div key={player.userId} className="spectator-player">
                <span className="spectator-name">
                  {player.displayName}
                  {player.evaluations.length > 0 && (
                    <span className="spectator-guesses"> {player.evaluations.length}/6</span>
                  )}
                </span>
                <MiniGrid evaluations={player.evaluations} />
              </div>
            ))}
          </div>
        </>
      )}

      {completedRecords.length > 0 && (
        <>
          <h3 className="spectator-title" style={{ marginTop: players.length > 0 ? "12px" : 0 }}>
            Today's Results
          </h3>
          <div className="spectator-list">
            {completedRecords.map((r) => (
              <div key={r.userId} className="spectator-player">
                <span className="spectator-name">
                  {r.username}
                  <span className="spectator-guesses">
                    {" "}{r.won ? `${r.evaluations.length}/6` : "X/6"}
                  </span>
                </span>
                <MiniGrid evaluations={r.evaluations} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
