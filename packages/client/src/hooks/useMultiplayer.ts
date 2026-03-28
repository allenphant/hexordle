import { useEffect, useRef, useState, useCallback } from "react";
import { TileState } from "../lib/evaluate";
import { discordSdk } from "../discordSdk";
import { AuthData } from "../discordSdk";

export interface RemotePlayer {
  userId: string;
  displayName: string;
  avatarHash: string | null;
  evaluations: TileState[][];
}

export function useMultiplayer(auth: AuthData) {
  const wsRef = useRef<WebSocket | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);

  const getWsUrl = () => {
    // In Discord Activity, WebSocket traffic also goes through the proxy
    const isHttps = location.protocol === "https:";
    const protocol = isHttps ? "wss:" : "ws:";
    return `${protocol}//${location.host}`;
  };

  useEffect(() => {
    const instanceId = discordSdk.instanceId;
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join",
          instanceId,
          userId: auth.user.id,
          displayName: auth.user.global_name || auth.user.username,
          avatarHash: auth.user.avatar ?? null,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "room_state") {
          setRemotePlayers(msg.players.map((p: RemotePlayer) => ({ ...p, avatarHash: p.avatarHash ?? null })));
        }

        if (msg.type === "player_joined") {
          setRemotePlayers((prev) => {
            if (prev.find((p) => p.userId === msg.userId)) return prev;
            return [...prev, { userId: msg.userId, displayName: msg.displayName, avatarHash: msg.avatarHash ?? null, evaluations: [] }];
          });
        }

        if (msg.type === "player_guess") {
          setRemotePlayers((prev) =>
            prev.map((p) =>
              p.userId === msg.userId
                ? { ...p, evaluations: msg.evaluations }
                : p
            )
          );
        }

        if (msg.type === "player_left") {
          setRemotePlayers((prev) => prev.filter((p) => p.userId !== msg.userId));
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      // Simple reconnect after 3s
      setTimeout(() => {
        if (wsRef.current === ws) {
          // Will re-run effect if we update state, but simpler to just reload
          // For now, just log
          console.log("WebSocket closed, reconnect needed");
        }
      }, 3000);
    };

    return () => {
      ws.close();
    };
  }, [auth.user.id, auth.user.global_name, auth.user.username]);

  const sendGuess = useCallback((evaluation: TileState[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: "guess", evaluation })
      );
    }
  }, []);

  return { remotePlayers, sendGuess };
}
