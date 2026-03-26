import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import nacl from "tweetnacl";
import pg from "pg";
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __rootdir = resolve(dirname(__filename), "../../..");
dotenv.config({ path: resolve(__rootdir, ".env") });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT ?? 3001;

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) { console.log("[DB] No DATABASE_URL — skipping DB init"); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id     TEXT NOT NULL,
      date        TEXT NOT NULL,
      guesses     JSONB NOT NULL DEFAULT '[]',
      evaluations JSONB NOT NULL DEFAULT '[]',
      completed   BOOLEAN NOT NULL DEFAULT false,
      won         BOOLEAN NOT NULL DEFAULT false,
      guild_id    TEXT,
      username    TEXT,
      PRIMARY KEY (user_id, date)
    )
  `);
  // Migrate existing tables that don't have guild_id / username yet
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS guild_id TEXT`);
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS username TEXT`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guild_date
    ON user_progress (guild_id, date) WHERE guild_id IS NOT NULL
  `);
  console.log("[DB] Table ready");
}

// ─── Discord Signature Verification ──────────────────────────────────────────
// Discord signs every interaction request so we can verify it's genuine.
function verifyDiscordSignature(signature, timestamp, rawBody) {
  try {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (!publicKey || !signature || !timestamp) return false;
    return nacl.sign.detached.verify(
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      Buffer.from(signature, "hex"),
      Buffer.from(publicKey, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Discord Interactions Endpoint ───────────────────────────────────────────
// Must be registered BEFORE express.json() so we get the raw body for sig verification.
// This endpoint handles:
//   1. PING (type 1) — Discord verifies our endpoint is live
//   2. Slash command /hexordle (type 2) — replies with a Launch button
//   3. Button click "launch_hexordle" (type 3) — responds with LAUNCH_ACTIVITY (type 12)
app.post(
  "/api/interactions",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];

    if (!verifyDiscordSignature(signature, timestamp, req.body)) {
      return res.status(401).send("Invalid signature");
    }

    const body = JSON.parse(req.body.toString());

    // Type 1 = PING — Discord verifies our endpoint is live
    if (body.type === 1) {
      return res.json({ type: 1 });
    }

    // Type 2 = APPLICATION_COMMAND — user typed /hexordle in any channel
    // Respond with an ephemeral message containing a Launch button
    if (body.type === 2 && body.data?.name === "hexordle") {
      return res.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          flags: 64, // ephemeral — only visible to the user who ran the command
          content: "Ready to play Hexordle?",
          components: [
            {
              type: 1, // ACTION_ROW
              components: [
                {
                  type: 2,  // BUTTON
                  style: 1, // PRIMARY (blue)
                  label: "🎮 Play Hexordle",
                  custom_id: "launch_hexordle",
                },
              ],
            },
          ],
        },
      });
    }

    // Type 3 = MESSAGE_COMPONENT (button click) — launch the Activity
    if (body.type === 3 && body.data?.custom_id === "launch_hexordle") {
      // Type 12 = LAUNCH_ACTIVITY — tells Discord to open the game
      return res.json({ type: 12 });
    }

    res.status(404).json({ error: "Unknown interaction" });
  }
);

// Global JSON body parser for all other routes
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ─── Cross-Device Progress Sync ───────────────────────────────────────────────
app.get("/api/progress", async (req, res) => {
  if (!pool) return res.json(null);
  const { userId, date } = req.query;
  if (!userId || !date) return res.status(400).json({ error: "userId and date required" });
  try {
    const result = await pool.query(
      "SELECT * FROM user_progress WHERE user_id = $1 AND date = $2",
      [userId, date]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error("[DB] Error loading progress:", err);
    res.json(null);
  }
});

app.post("/api/progress", async (req, res) => {
  if (!pool) return res.json({ ok: true });
  const { userId, date, guesses, evaluations, completed, won, guildId, username } = req.body;
  if (!userId || !date) return res.status(400).json({ error: "userId and date required" });
  try {
    await pool.query(
      `INSERT INTO user_progress (user_id, date, guesses, evaluations, completed, won, guild_id, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, date) DO UPDATE
       SET guesses = EXCLUDED.guesses, evaluations = EXCLUDED.evaluations,
           completed = EXCLUDED.completed, won = EXCLUDED.won,
           guild_id = COALESCE(EXCLUDED.guild_id, user_progress.guild_id),
           username = COALESCE(EXCLUDED.username, user_progress.username)`,
      [userId, date, JSON.stringify(guesses), JSON.stringify(evaluations), completed, won, guildId ?? null, username ?? null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[DB] Error saving progress:", err);
    res.json({ ok: true }); // fail silently — game continues
  }
});

// ─── Guild Daily Progress (all members who played today) ─────────────────────
app.get("/api/guild-progress", async (req, res) => {
  if (!pool) return res.json([]);
  const { guildId, date } = req.query;
  if (!guildId || !date) return res.status(400).json({ error: "guildId and date required" });
  try {
    const result = await pool.query(
      `SELECT user_id, username, evaluations, completed, won
       FROM user_progress
       WHERE guild_id = $1 AND date = $2
       ORDER BY completed DESC, array_length(ARRAY(SELECT * FROM jsonb_array_elements(guesses)), 1) ASC`,
      [guildId, date]
    );
    res.json(result.rows.map((r) => ({
      userId: r.user_id,
      username: r.username ?? "Player",
      evaluations: r.evaluations,
      completed: r.completed,
      won: r.won,
    })));
  } catch (err) {
    console.error("[DB] Error loading guild progress:", err);
    res.json([]);
  }
});

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
    .map((row) => row.map((s) => GRID_EMOJI[s] ?? "⬛").join(" "))
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
    footer: { text: "Click ▶ Play now! to join the game" },
  };

  // Interaction button (style 1 = blue) — clicking this triggers our /api/interactions
  // endpoint, which responds with type 12 (LAUNCH_ACTIVITY) to open the game
  const components = channelId
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1, // PRIMARY (blue button, triggers interaction)
              label: "▶ Play now!",
              custom_id: "launch_hexordle",
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

// ─── Fetch Text Channels for Channel Picker ──────────────────────────────────
app.get("/api/channels", async (req, res) => {
  const { guildId } = req.query;
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return res.status(503).json({ error: "BOT_TOKEN not configured" });
  if (!guildId) return res.status(400).json({ error: "guildId required" });

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    if (!response.ok) return res.status(502).json({ error: "Failed to fetch channels" });

    const all = await response.json();
    // type 0 = GUILD_TEXT, type 5 = GUILD_ANNOUNCEMENT — both are text channels
    const text = all
      .filter((c) => c.type === 0 || c.type === 5)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));

    res.json(text);
  } catch (err) {
    console.error("Fetch channels error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Word Validation (proxied + cached) ──────────────────────────────────────
const wordCache = new Map();

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
    res.json({ valid: true });
  }
});

// ─── WebSocket (Spectator Sync) ───────────────────────────────────────────────
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

        const roomSnapshot = getRoomSnapshot(room, userId);
        ws.send(JSON.stringify({ type: "room_state", players: roomSnapshot }));

        broadcast(room, userId, { type: "player_joined", userId, displayName });
      }

      if (msg.type === "guess" && instanceId && userId) {
        const room = rooms.get(instanceId);
        if (!room) return;

        const player = room.get(userId);
        if (!player) return;

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

    if (room.size === 0) rooms.delete(instanceId);
  });
});

function broadcast(room, excludeUserId, message) {
  const payload = JSON.stringify(message);
  for (const [uid, player] of room) {
    if (uid === excludeUserId) continue;
    if (player.ws.readyState === 1) player.ws.send(payload);
  }
}

function getRoomSnapshot(room, excludeUserId) {
  const players = [];
  for (const [uid, player] of room) {
    if (uid === excludeUserId) continue;
    players.push({ userId: uid, displayName: player.displayName, evaluations: player.evaluations });
  }
  return players;
}

// ─── Register Discord Commands (on startup) ───────────────────────────────────
// Registers two commands:
//   1. PRIMARY_ENTRY_POINT (type 4) — appears in the Activity Launcher (🎮) everywhere
//   2. CHAT_INPUT (type 1)          — /hexordle slash command in any text channel
async function registerCommands() {
  const clientId = process.env.VITE_CLIENT_ID;
  const botToken = process.env.BOT_TOKEN;
  if (!botToken || !clientId) return;

  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };
  const url = `https://discord.com/api/v10/applications/${clientId}/commands`;

  const commands = [
    {
      name: "hexordle",
      description: "Play Hexordle — the 6-letter word game",
      type: 4,        // PRIMARY_ENTRY_POINT — Activity Launcher entry
      handler: 2,     // DISCORD_LAUNCH_ACTIVITY
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    },
    {
      name: "hexordle",
      description: "Play Hexordle — the 6-letter word game",
      type: 1,        // CHAT_INPUT — slash command
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    },
  ];

  for (const cmd of commands) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(cmd) });
      if (res.ok) {
        const label = cmd.type === 4 ? "Activity Launcher entry" : "/hexordle slash command";
        console.log(`[Bot] Registered: ${label}`);
      } else {
        const err = await res.json();
        // 50223 = already registered (harmless on redeploy), 50032 = duplicate name+type
        if (err.code === 50223 || err.code === 50032) {
          const label = cmd.type === 4 ? "Activity Launcher entry" : "/hexordle slash command";
          console.log(`[Bot] Already registered (ok): ${label}`);
        } else {
          console.error("[Bot] Failed to register command:", err);
        }
      }
    } catch (err) {
      console.error("[Bot] Error registering command:", err);
    }
  }
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
  initDb();
  registerCommands();
});
