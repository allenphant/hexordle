import { useEffect, useState } from "react";
import { TileState } from "../lib/evaluate";
import { generateShareText } from "../lib/share";
import { Stats } from "../hooks/useStats";

interface TextChannel { id: string; name: string; }

interface ResultModalProps {
  gameStatus: "won" | "lost";
  answer: string;
  evaluations: TileState[][];
  stats: Stats;
  dayNumber: number;
  channelId: string | null;
  guildId: string | null;
  userId: string;
  username: string;
  avatarHash: string | null;
  onClose: () => void;
}

function getNextMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function formatCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ResultModal({
  gameStatus, answer, evaluations, stats, dayNumber,
  channelId, guildId, userId, username, avatarHash,
  onClose,
}: ResultModalProps) {
  const [countdown, setCountdown] = useState(getNextMidnight());
  const [copied, setCopied] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Channel picker state
  const [channels, setChannels] = useState<TextChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>(channelId ?? "");
  const [loadingChannels, setLoadingChannels] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setCountdown(getNextMidnight()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch text channels when modal opens (only if in a guild)
  useEffect(() => {
    if (!guildId) return;
    setLoadingChannels(true);
    fetch(`/.proxy/api/channels?guildId=${guildId}`)
      .then((r) => r.json())
      .then((list: TextChannel[]) => {
        setChannels(list);
        // Default to current voice channel if it's in the list, otherwise first text channel
        const match = list.find((c) => c.id === channelId);
        setSelectedChannelId(match ? match.id : (list[0]?.id ?? channelId ?? ""));
      })
      .catch(() => {
        // If fetch fails, fall back to the current channel
        setSelectedChannelId(channelId ?? "");
      })
      .finally(() => setLoadingChannels(false));
  }, [guildId, channelId]);

  const shareText = generateShareText(evaluations, gameStatus === "won");

  const handleCopy = async () => {
    const ok = await copyToClipboard(shareText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePostToChannel = async () => {
    if (isPosting || posted || !selectedChannelId) return;
    setIsPosting(true);
    setPostError(null);
    try {
      const res = await fetch("/.proxy/api/post-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, username, avatarHash, evaluations,
          won: gameStatus === "won",
          guessCount: evaluations.length,
          dayNumber,
          channelId: selectedChannelId,
          guildId,
        }),
      });
      if (res.ok) {
        setPosted(true);
      } else {
        const err = await res.json();
        const detail = err.detail?.message ?? err.detail?.code;
        setPostError(detail ? `${err.error}: ${detail}` : (err.error ?? "Failed to post"));
      }
    } catch {
      setPostError("Network error");
    } finally {
      setIsPosting(false);
    }
  };

  const winRate = stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0;

  const canShare = !!(guildId || channelId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <h2 className="modal-title">
          {gameStatus === "won" ? "You got it!" : "Better luck tomorrow!"}
        </h2>

        {gameStatus === "lost" && (
          <p className="modal-answer">
            The word was <strong>{answer.toUpperCase()}</strong>
          </p>
        )}

        <div className="stats-row">
          <div className="stat">
            <span className="stat-value">{stats.gamesPlayed}</span>
            <span className="stat-label">Played</span>
          </div>
          <div className="stat">
            <span className="stat-value">{winRate}</span>
            <span className="stat-label">Win %</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.currentStreak}</span>
            <span className="stat-label">Streak</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats.maxStreak}</span>
            <span className="stat-label">Max</span>
          </div>
        </div>

        <div className="modal-bottom">
          <div className="modal-timer-row">
            <div className="next-word">
              <span className="next-label">Next Hexordle</span>
              <span className="next-countdown">{formatCountdown(countdown)}</span>
            </div>
            <button className="share-btn share-btn--copy" onClick={handleCopy}>
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>

          {canShare && (
            <>
              {/* Channel selector — only shown in guilds with channels loaded */}
              {channels.length > 0 && (
                <select
                  className="channel-select"
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  disabled={isPosting || posted}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
              )}

              <button
                className="share-btn share-btn--channel"
                onClick={handlePostToChannel}
                disabled={isPosting || posted || loadingChannels}
              >
                {posted
                  ? "✓ Posted!"
                  : isPosting
                  ? "Posting..."
                  : loadingChannels
                  ? "Loading channels..."
                  : "📤 Share to Channel"}
              </button>
            </>
          )}

          {postError && <p className="modal-post-error">{postError}</p>}
        </div>
      </div>
    </div>
  );
}
