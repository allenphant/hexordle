import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __rootdir = resolve(dirname(__filename), "../../..");
dotenv.config({ path: resolve(__rootdir, ".env") });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT ?? 3001;

app.use(express.json());

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ─── OAuth2 Token Exchange ───────────────────────────────────────────────────
app.post("/api/token", async (req, res) => {
  const { code } = req.body;

  const params = new URLSearchParams({
    client_id: process.env.VITE_CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: `https://${process.env.VITE_CLIENT_ID}.discordsays.com`,
  });

  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Token exchange failed:", data);
      return res.status(response.status).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Post Game Result to Discord Channel ─────────────────────────────────────
const GRID_EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

app.post("/api/post-result", async (req, res) => {
  const { userId, username, avatarHash, evaluations, won, guessCount, dayNumber, channelId, guildId } =
    req.body;

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return res.status(503).json({ error: "BOT_TOKEN not configured" });

  const grid = evaluations
    .map((row) => row.map((s) => GRID_EMOJI[s] ?? "⬛").join(""))
    .join("\n");
  const score = won ? guessCount : "X";

  const avatarUrl = avatarHash
    ? `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 6n)}.png`;

  const embed = {
    author: { name: username, icon_url: avatarUrl },
    title: `Hexordle #${dayNumber} — ${score}/6`,
    description: grid,
    color: won ? 0x538d4e : 0x3a3a3c,
    footer: { text: "Play Hexordle in your Voice Channel" },
  };

  const components = channelId
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5, // LINK button
              label: "Play now!",
              url: guildId
                ? `https://discord.com/channels/${guildId}/${channelId}`
                : `https://discord.com/channels/@me/${channelId}`,
            },
          ],
        },
      ]
    : [];

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ embeds: [embed], components }),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error("Discord API error:", err);
      return res.status(502).json({ error: "Discord API rejected the message", detail: err });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Post result error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Word Validation (proxied + cached) ──────────────────────────────────────
const wordCache = new Map(); // word → boolean

app.get("/api/validate", async (req, res) => {
  const word = (req.query.word ?? "").toLowerCase();
  if (!/^[a-z]{6}$/.test(word)) return res.json({ valid: false });

  if (wordCache.has(word)) return res.json({ valid: wordCache.get(word) });

  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
    );
    const valid = response.ok;
    wordCache.set(word, valid);
    res.json({ valid });
  } catch {
    // network failure → optimistically allow
    res.json({ valid: true });
  }
});

// ─── WebSocket (Spectator Sync) ───────────────────────────────────────────────
// rooms: Map<instanceId, Map<userId, { ws, displayName, evaluations[] }>>
const rooms = new Map();

wss.on("connection", (ws) => {
  let instanceId = null;
  let userId = null;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "join") {
        instanceId = msg.instanceId;
        userId = msg.userId;
        const displayName = msg.displayName ?? "Player";

        if (!rooms.has(instanceId)) rooms.set(instanceId, new Map());
        const room = rooms.get(instanceId);

        room.set(userId, { ws, displayName, evaluations: [] });

        // Send current room state to the new player
        const roomSnapshot = getRoomSnapshot(room, userId);
        ws.send(JSON.stringify({ type: "room_state", players: roomSnapshot }));

        // Announce join to others
        broadcast(room, userId, {
          type: "player_joined",
          userId,
          displayName,
        });
      }

      if (msg.type === "guess" && instanceId && userId) {
        const room = rooms.get(instanceId);
        if (!room) return;

        const player = room.get(userId);
        if (!player) return;

        // Append new evaluation row (colors only, no letters)
        player.evaluations.push(msg.evaluation);

        broadcast(room, userId, {
          type: "player_guess",
          userId,
          displayName: player.displayName,
          evaluations: player.evaluations,
        });
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    if (!instanceId || !userId) return;
    const room = rooms.get(instanceId);
    if (!room) return;

    room.delete(userId);

    broadcast(room, null, { type: "player_left", userId });

    // Clean up empty rooms
    if (room.size === 0) rooms.delete(instanceId);
  });
});

function broadcast(room, excludeUserId, message) {
  const payload = JSON.stringify(message);
  for (const [uid, player] of room) {
    if (uid === excludeUserId) continue;
    if (player.ws.readyState === 1 /* OPEN */) {
      player.ws.send(payload);
    }
  }
}

function getRoomSnapshot(room, excludeUserId) {
  const players = [];
  for (const [uid, player] of room) {
    if (uid === excludeUserId) continue;
    players.push({
      userId: uid,
      displayName: player.displayName,
      evaluations: player.evaluations,
    });
  }
  return players;
}

// ─── Serve Built Client ───────────────────────────────────────────────────────
const __dirname = dirname(__filename);
const clientDist = join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
