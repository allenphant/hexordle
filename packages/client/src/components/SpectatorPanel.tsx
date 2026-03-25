import { RemotePlayer } from "../hooks/useMultiplayer";
import { TileState } from "../lib/evaluate";

interface MiniGridProps {
  evaluations: TileState[][];
}

function MiniGrid({ evaluations }: MiniGridProps) {
  const rows = Array(6).fill(null);
  return (
    <div className="mini-grid">
      {rows.map((_, i) => (
        <div key={i} className="mini-row">
          {Array(6)
            .fill(null)
            .map((__, j) => {
              const state = evaluations[i]?.[j];
              return (
                <span
                  key={j}
                  className="mini-tile"
                  data-state={state ?? "empty"}
                />
              );
            })}
        </div>
      ))}
    </div>
  );
}

interface SpectatorPanelProps {
  players: RemotePlayer[];
}

export function SpectatorPanel({ players }: SpectatorPanelProps) {
  if (players.length === 0) return null;

  return (
    <div className="spectator-panel">
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
    </div>
  );
}
