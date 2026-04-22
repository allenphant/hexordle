import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import nacl from "tweetnacl";
import pg from "pg";
const { Pool } = pg;

// @napi-rs/canvas for Discord progress image generation
let createCanvas = null;
let loadImage = null;
try {
  const canvasModule = await import("@napi-rs/canvas");
  createCanvas = canvasModule.createCanvas;
  loadImage = canvasModule.loadImage;
  console.log("[Canvas] @napi-rs/canvas loaded");
} catch {
  console.warn("[Canvas] @napi-rs/canvas not available — falling back to emoji grid");
}

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
  // Migrate existing tables
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS guild_id TEXT`);
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS username TEXT`);
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS day_number INTEGER`);
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS avatar_hash TEXT`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_guild_date
    ON user_progress (guild_id, date) WHERE guild_id IS NOT NULL
  `);
  // One Discord message per guild per day — migrate old (channel_id,date) PK to (guild_id,date)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'channel_daily_message'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'channel_daily_message' AND column_name = 'guild_id'
      ) THEN
        DROP TABLE channel_daily_message;
      END IF;
    END $$
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_daily_message (
      guild_id    TEXT NOT NULL,
      date        TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      day_number  INTEGER,
      word_length INTEGER NOT NULL DEFAULT 6,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, date, word_length)
    )
  `);
  await pool.query(`ALTER TABLE channel_daily_message ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE channel_daily_message ADD COLUMN IF NOT EXISTS word_length INTEGER NOT NULL DEFAULT 6`);
  // Migrate channel_daily_message PK: drop old (guild_id, date) PK and add (guild_id, date, word_length)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage
        WHERE table_name = 'channel_daily_message' AND constraint_name = 'channel_daily_message_pkey'
          AND column_name = 'word_length'
      ) THEN
        BEGIN
          ALTER TABLE channel_daily_message DROP CONSTRAINT channel_daily_message_pkey;
          ALTER TABLE channel_daily_message ADD PRIMARY KEY (guild_id, date, word_length);
        EXCEPTION WHEN OTHERS THEN
          NULL; -- ignore if already migrated
        END;
      END IF;
    END $$
  `);
  // Migrate user_progress: add word_length column and update PK
  await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS word_length INTEGER NOT NULL DEFAULT 6`);
  // Migrate PK: drop old (user_id, date) PK and add (user_id, date, word_length)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.key_column_usage
        WHERE table_name = 'user_progress' AND constraint_name = 'user_progress_pkey'
          AND column_name = 'word_length'
      ) THEN
        BEGIN
          ALTER TABLE user_progress DROP CONSTRAINT user_progress_pkey;
          ALTER TABLE user_progress ADD PRIMARY KEY (user_id, date, word_length);
        EXCEPTION WHEN OTHERS THEN
          NULL; -- ignore if already migrated
        END;
      END IF;
    END $$
  `);
  // ONE-TIME CLEANUP: clear today's channel_daily_message so new channel preference takes effect
  await pool.query(`DELETE FROM channel_daily_message WHERE date = '2026-03-28'`);
  console.log("[DB] Cleared today's channel_daily_message");
  console.log("[DB] Table ready");
}

// ─── Progress Image Generator ─────────────────────────────────────────────────
const TILE_COLORS = { correct: "#538d4e", present: "#b59f3b", absent: "#3a3a3c" };
const TILE_EMPTY_FILL = "#1a1a1b";
const TILE_EMPTY_STROKE = "#3a3a3c";
const TILE_SIZE = 32;
const TILE_GAP = 4;
const CARD_PAD = 12;
const CARD_SPACING = 10;
const AVATAR_R = 22;   // circle radius
const HEADER_H = AVATAR_R * 2 + 8 + 16; // avatar + gap + score line

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function buildProgressImage(players, dayNumber, wordLength = 6) {
  if (!createCanvas || !loadImage) return null;
  const displayLength = wordLength === 0 ? 8 : wordLength; // eq mode sentinel → 8 tiles
  const gridW = displayLength * TILE_SIZE + (displayLength - 1) * TILE_GAP; // width varies by mode
  const gridH = 6 * TILE_SIZE + 5 * TILE_GAP;                        // height always 6 rows
  const cardW = gridW + CARD_PAD * 2;
  const cardH = HEADER_H + gridH + CARD_PAD * 2;
  const canvasW = players.length * (cardW + CARD_SPACING) - CARD_SPACING + CARD_PAD * 2;
  const canvasH = cardH + CARD_PAD * 2;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0f111a";
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const cx = CARD_PAD + i * (cardW + CARD_SPACING);
    const cy = CARD_PAD;

    // Card background
    ctx.fillStyle = "#1a1d2e";
    roundedRect(ctx, cx, cy, cardW, cardH, 8);
    ctx.fill();

    const score = player.completed
      ? (player.won ? `${(player.evaluations ?? []).length}/6` : "X/6")
      : `${(player.evaluations ?? []).length}/6…`;

    // Avatar (circular)
    const ax = cx + cardW / 2;
    const ay = cy + CARD_PAD + AVATAR_R;
    if (player.user_id && player.avatar_hash) {
      try {
        const avatarUrl = `https://cdn.discordapp.com/avatars/${player.user_id}/${player.avatar_hash}.png?size=64`;
        const img = await loadImage(avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax, ay, AVATAR_R, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, ax - AVATAR_R, ay - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
        ctx.restore();
      } catch {
        // Fallback: coloured circle with initial
        ctx.fillStyle = "#538d4e";
        ctx.beginPath();
        ctx.arc(ax, ay, AVATAR_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${AVATAR_R}px FreeSans,Arial,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText((player.username ?? "?")[0].toUpperCase(), ax, ay);
      }
    } else {
      // Default avatar: coloured circle
      ctx.fillStyle = "#3a3a3c";
      ctx.beginPath();
      ctx.arc(ax, ay, AVATAR_R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Score below avatar
    ctx.fillStyle = "#818384";
    ctx.font = "11px FreeSans,Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(score, ax, cy + CARD_PAD + AVATAR_R * 2 + 4);

    // Grid
    const evals = player.evaluations ?? [];
    const gx = cx + CARD_PAD;
    const gy = cy + HEADER_H + CARD_PAD;

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < displayLength; col++) {
        const tx = gx + col * (TILE_SIZE + TILE_GAP);
        const ty = gy + row * (TILE_SIZE + TILE_GAP);
        const state = evals[row]?.[col];

        if (state && TILE_COLORS[state]) {
          ctx.fillStyle = TILE_COLORS[state];
          roundedRect(ctx, tx, ty, TILE_SIZE, TILE_SIZE, 3);
          ctx.fill();
        } else {
          ctx.fillStyle = TILE_EMPTY_FILL;
          roundedRect(ctx, tx, ty, TILE_SIZE, TILE_SIZE, 3);
          ctx.fill();
          ctx.strokeStyle = TILE_EMPTY_STROKE;
          ctx.lineWidth = 2;
          roundedRect(ctx, tx + 1, ty + 1, TILE_SIZE - 2, TILE_SIZE - 2, 2);
          ctx.stroke();
        }
      }
    }
  }

  return canvas.toBuffer("image/png");
}

// ─── Auto-ensure guild daily message (called on every guess) ─────────────────
function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function autoEnsureGuildMessage(guildId, date, dayNumber, botToken, wordLength = 6) {
  const tag = `[Bot][wl=${wordLength}][${date}]`;
  if (!pool || !botToken || !guildId) {
    console.log(`${tag} autoEnsureGuildMessage skipped: pool=${!!pool} botToken=${!!botToken} guildId=${!!guildId}`);
    return;
  }
  console.log(`${tag} autoEnsureGuildMessage called guildId=${guildId}`);
  try {
    const existing = await pool.query(
      "SELECT channel_id, message_id, created_at FROM channel_daily_message WHERE guild_id = $1 AND date = $2 AND word_length = $3",
      [guildId, date, wordLength]
    );

    if (existing.rows.length > 0) {
      const { channel_id, message_id, created_at } = existing.rows[0];
      const ageHours = (Date.now() - new Date(created_at).getTime()) / 3_600_000;
      console.log(`${tag} existing message found: channel=${channel_id} msg=${message_id} age=${ageHours.toFixed(2)}h`);
      if (ageHours < 3) {
        console.log(`${tag} message fresh (<3h) — refreshing`);
        refreshGuildMessage(guildId, date, botToken, wordLength);
        return;
      }
      console.log(`${tag} message stale (>3h) — creating new`);
    } else {
      console.log(`${tag} no existing message — creating new`);
    }

    // Find which text channel to post in:
    // 1. Reuse today's stale message channel or yesterday's channel
    let channelId = existing.rows[0]?.channel_id ?? null;

    if (!channelId) {
      const prev = await pool.query(
        "SELECT channel_id FROM channel_daily_message WHERE guild_id = $1 AND date = $2 AND word_length = $3",
        [guildId, getYesterdayDate(), wordLength]
      );
      channelId = prev.rows[0]?.channel_id ?? null;
      if (channelId) console.log(`${tag} reusing yesterday's channel=${channelId}`);
    }

    // 2. Find the preferred channel ("窩斗"), fall back to first text channel
    if (!channelId) {
      const chRes = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/channels`,
        { headers: { Authorization: `Bot ${botToken}` } }
      );
      console.log(`${tag} GET guild channels => HTTP ${chRes.status}`);
      if (chRes.ok) {
        const all = await chRes.json();
        const textChannels = all
          .filter((c) => c.type === 0 || c.type === 5)
          .sort((a, b) => a.position - b.position);
        const preferred = textChannels.find((c) => c.name === "窩斗");
        channelId = (preferred ?? textChannels[0])?.id ?? null;
        console.log(`${tag} resolved channel=${channelId} (preferred=${!!preferred})`);
      } else {
        const body = await chRes.text();
        console.error(`${tag} GET guild channels failed: ${body}`);
      }
    }

    if (!channelId) {
      console.error(`${tag} no channelId found — aborting`);
      return;
    }

    const components = [{
      type: 1,
      components: [{ type: 2, style: 1, label: "▶ Play now!", custom_id: "launch_hexordle" }],
    }];

    const modeLabel = wordLength === 0 ? " (Eq)" : wordLength === 5 ? " (5-Letter)" : wordLength === 7 ? " (7-Letter)" : "";
    const postRes = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**Hexordle #${dayNumber}${modeLabel} — Today's Results**`,
          components,
        }),
      }
    );
    console.log(`${tag} POST new message => HTTP ${postRes.status}`);
    if (!postRes.ok) {
      const body = await postRes.text();
      console.error(`${tag} POST new message failed: ${body}`);
      return;
    }

    const posted = await postRes.json();
    console.log(`${tag} new message created id=${posted.id}`);
    await pool.query(
      `INSERT INTO channel_daily_message (guild_id, date, channel_id, message_id, day_number, word_length, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (guild_id, date, word_length) DO UPDATE
       SET channel_id = EXCLUDED.channel_id,
           message_id = EXCLUDED.message_id,
           created_at = EXCLUDED.created_at`,
      [guildId, date, channelId, posted.id, dayNumber, wordLength]
    );

    refreshGuildMessage(guildId, date, botToken, wordLength);
  } catch (err) {
    console.error("[Bot] autoEnsureGuildMessage error:", err);
  }
}

// ─── Refresh the guild's daily Discord message with all members' progress ─────
const GRID_EMOJI_MAP = { correct: "🟩", present: "🟨", absent: "⬛" };

async function refreshGuildMessage(guildId, date, botToken, wordLength = 6) {
  const tag = `[Bot][wl=${wordLength}][${date}]`;
  if (!pool || !botToken) return;
  try {
    const msgRow = await pool.query(
      "SELECT channel_id, message_id, day_number FROM channel_daily_message WHERE guild_id = $1 AND date = $2 AND word_length = $3",
      [guildId, date, wordLength]
    );
    if (msgRow.rows.length === 0) {
      console.log(`${tag} refreshGuildMessage: no message row in DB`);
      return;
    }
    const { channel_id, message_id, day_number } = msgRow.rows[0];
    console.log(`${tag} refreshGuildMessage: patching channel=${channel_id} msg=${message_id}`);

    const progress = await pool.query(
      `SELECT user_id, username, avatar_hash, evaluations, completed, won, jsonb_array_length(guesses) AS guess_count
       FROM user_progress
       WHERE guild_id = $1 AND date = $2 AND word_length = $3
       ORDER BY completed DESC, jsonb_array_length(guesses) ASC`,
      [guildId, date, wordLength]
    );
    if (progress.rows.length === 0) {
      console.log(`${tag} refreshGuildMessage: no player progress yet`);
      return;
    }
    console.log(`${tag} refreshGuildMessage: ${progress.rows.length} player(s)`);

    const components = [{
      type: 1,
      components: [{ type: 2, style: 1, label: "▶ Play now!", custom_id: "launch_hexordle" }],
    }];

    const patchUrl = `https://discord.com/api/v10/channels/${channel_id}/messages/${message_id}`;
    const authHeader = { Authorization: `Bot ${botToken}` };

    // Try image-based update first
    const imageBuffer = await buildProgressImage(progress.rows, day_number, wordLength);
    const modeLabel = wordLength === 0 ? " (Eq)" : wordLength === 5 ? " (5-Letter)" : wordLength === 7 ? " (7-Letter)" : "";
    if (imageBuffer) {
      const embed = {
        title: `Hexordle #${day_number}${modeLabel} — Today's Results`,
        color: 0x538d4e,
        image: { url: "attachment://progress.png" },
      };
      const payload = {
        content: "",
        embeds: [embed],
        components,
        attachments: [{ id: "0", filename: "progress.png" }],
      };
      const form = new FormData();
      form.append("payload_json", JSON.stringify(payload));
      form.append("files[0]", new Blob([imageBuffer], { type: "image/png" }), "progress.png");
      const patchRes = await fetch(patchUrl, { method: "PATCH", headers: authHeader, body: form });
      console.log(`${tag} PATCH (image) => HTTP ${patchRes.status}`);
      if (!patchRes.ok) {
        const body = await patchRes.text();
        console.error(`${tag} PATCH (image) failed: ${body}`);
      }
      return;
    }

    // Fallback: emoji grid embeds (one per player)
    const emptyRow = "⬜".repeat(wordLength === 0 ? 8 : wordLength);
    const embeds = progress.rows.map((row) => {
      const evals = row.evaluations ?? [];
      const paddedRows = [...evals];
      while (paddedRows.length < 6) paddedRows.push(null);
      const grid = paddedRows
        .map((r) => r ? r.map((s) => GRID_EMOJI_MAP[s] ?? "⬛").join("") : emptyRow)
        .join("\n");
      const score = row.completed
        ? (row.won ? `${row.guess_count}/6` : "X/6")
        : `${row.guess_count}/6…`;
      return {
        author: { name: row.username ?? "Player" },
        title: `Hexordle #${day_number}${modeLabel} — ${score}`,
        description: grid,
        color: row.won ? 0x538d4e : row.completed ? 0x3a3a3c : 0x5865f2,
      };
    });

    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ embeds, components }),
    });
    console.log(`${tag} PATCH (emoji) => HTTP ${patchRes.status}`);
    if (!patchRes.ok) {
      const body = await patchRes.text();
      console.error(`${tag} PATCH (emoji) failed: ${body}`);
    }
  } catch (err) {
    console.error("[Bot] refreshGuildMessage error:", err);
  }
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

    // Type 2 = APPLICATION_COMMAND
    if (body.type === 2 && body.data?.name === "hexordle") {
      // PRIMARY_ENTRY_POINT (data.type 4) — launch activity directly via our handler
      // Using handler:1 instead of handler:2 to let us control the response
      if (body.data?.type === 4) {
        return res.json({ type: 12 }); // LAUNCH_ACTIVITY
      }
      // CHAT_INPUT slash command (data.type 1) — show ephemeral button
      return res.json({
        type: 4,
        data: {
          flags: 64, // ephemeral — only visible to the user who ran the command
          content: "Ready to play Hexordle?",
          components: [{
            type: 1,
            components: [{ type: 2, style: 1, label: "🎮 Play Hexordle", custom_id: "launch_hexordle" }],
          }],
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
  const wordLength = parseInt(req.query.wordLength ?? "6");
  if (!userId || !date) return res.status(400).json({ error: "userId and date required" });
  try {
    const result = await pool.query(
      "SELECT * FROM user_progress WHERE user_id = $1 AND date = $2 AND word_length = $3",
      [userId, date, wordLength]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error("[DB] Error loading progress:", err);
    res.json(null);
  }
});

app.post("/api/progress", async (req, res) => {
  if (!pool) return res.json({ ok: true });
  const { userId, date, dayNumber, guesses, evaluations, completed, won, guildId, username, avatarHash, wordLength } = req.body;
  const wl = wordLength ?? 6;
  console.log(`[API] POST /api/progress userId=${userId} date=${date} wl=${wl} guildId=${guildId ?? "null"} guesses=${(guesses ?? []).length}`);
  if (!userId || !date) return res.status(400).json({ error: "userId and date required" });
  try {
    await pool.query(
      `INSERT INTO user_progress (user_id, date, day_number, guesses, evaluations, completed, won, guild_id, username, avatar_hash, word_length)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, date, word_length) DO UPDATE
       SET guesses = EXCLUDED.guesses, evaluations = EXCLUDED.evaluations,
           completed = EXCLUDED.completed, won = EXCLUDED.won,
           day_number = COALESCE(EXCLUDED.day_number, user_progress.day_number),
           guild_id = COALESCE(EXCLUDED.guild_id, user_progress.guild_id),
           username = COALESCE(EXCLUDED.username, user_progress.username),
           avatar_hash = COALESCE(EXCLUDED.avatar_hash, user_progress.avatar_hash)`,
      [userId, date, dayNumber ?? null, JSON.stringify(guesses), JSON.stringify(evaluations),
       completed, won, guildId ?? null, username ?? null, avatarHash ?? null, wl]
    );
    res.json({ ok: true });
    // Fire-and-forget: auto-create or refresh the guild's daily message
    if (guildId) {
      autoEnsureGuildMessage(guildId, date, dayNumber, process.env.BOT_TOKEN, wl);
    } else {
      console.log(`[API] POST /api/progress — guildId missing, skipping Discord message`);
    }
  } catch (err) {
    console.error("[DB] Error saving progress:", err);
    res.json({ ok: true });
  }
});

// ─── Guild Daily Progress (all members who played today) ─────────────────────
app.get("/api/guild-progress", async (req, res) => {
  if (!pool) return res.json([]);
  const { guildId, date } = req.query;
  const wordLength = parseInt(req.query.wordLength ?? "6");
  if (!guildId || !date) return res.status(400).json({ error: "guildId and date required" });
  try {
    const result = await pool.query(
      `SELECT user_id, username, avatar_hash, evaluations, completed, won, word_length
       FROM user_progress
       WHERE guild_id = $1 AND date = $2 AND word_length = $3
       ORDER BY completed DESC, jsonb_array_length(guesses) ASC`,
      [guildId, date, wordLength]
    );
    res.json(result.rows.map((r) => ({
      userId: r.user_id,
      username: r.username ?? "Player",
      avatarHash: r.avatar_hash ?? null,
      evaluations: r.evaluations,
      completed: r.completed,
      won: r.won,
      wordLength: r.word_length ?? 6,
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
app.post("/api/post-result", async (req, res) => {
  const { dayNumber, date, channelId, guildId, wordLength } = req.body;
  const wl = wordLength ?? 6;
  console.log(`[API] POST /api/post-result date=${date} wl=${wl} guildId=${guildId ?? "null"} channelId=${channelId ?? "null"}`);
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return res.status(503).json({ error: "BOT_TOKEN not configured" });
  if (!channelId) return res.status(400).json({ error: "channelId required" });

  const discordHeaders = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };
  const components = [{
    type: 1,
    components: [{ type: 2, style: 1, label: "▶ Play now!", custom_id: "launch_hexordle" }],
  }];

  try {
    if (pool && guildId && date) {
      // Check if today's guild message already exists for this mode
      const existing = await pool.query(
        "SELECT message_id FROM channel_daily_message WHERE guild_id = $1 AND date = $2 AND word_length = $3",
        [guildId, date, wl]
      );

      if (existing.rows.length > 0) {
        // Message already exists — just refresh it with latest progress
        refreshGuildMessage(guildId, date, botToken, wl);
        return res.json({ success: true });
      }

      // No message yet — create the daily leaderboard message
      const modeLabel = wl === 0 ? " (Eq)" : wl === 5 ? " (5-Letter)" : wl === 7 ? " (7-Letter)" : "";
      const postRes = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: discordHeaders,
          body: JSON.stringify({
            content: `**Hexordle #${dayNumber}${modeLabel} — Today's Results**`,
            components,
          }),
        }
      );

      if (!postRes.ok) {
        const err = await postRes.json();
        return res.status(502).json({ error: "Discord API rejected the message", detail: err });
      }

      const posted = await postRes.json();
      await pool.query(
        `INSERT INTO channel_daily_message (guild_id, date, channel_id, message_id, day_number, word_length)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (guild_id, date, word_length) DO NOTHING`,
        [guildId, date, channelId, posted.id, dayNumber, wl]
      );

      // Fill with actual progress data
      refreshGuildMessage(guildId, date, botToken, wl);
      return res.json({ success: true });
    }

    res.status(400).json({ error: "guildId and date required" });
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
  const length = parseInt(req.query.length ?? "6");
  if (![5, 6, 7].includes(length)) return res.json({ valid: false });
  if (!new RegExp(`^[a-z]{${length}}$`).test(word)) return res.json({ valid: false });

  const cacheKey = `${length}:${word}`;
  if (wordCache.has(cacheKey)) return res.json({ valid: wordCache.get(cacheKey) });

  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
    );
    const valid = response.ok;
    wordCache.set(cacheKey, valid);
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
        const avatarHash = msg.avatarHash ?? null;

        if (!rooms.has(instanceId)) rooms.set(instanceId, new Map());
        const room = rooms.get(instanceId);

        room.set(userId, { ws, displayName, avatarHash, evaluations: [], wordLength: 6 });

        const roomSnapshot = getRoomSnapshot(room, userId);
        ws.send(JSON.stringify({ type: "room_state", players: roomSnapshot }));

        broadcast(room, userId, { type: "player_joined", userId, displayName, avatarHash });
      }

      if (msg.type === "guess" && instanceId && userId) {
        const room = rooms.get(instanceId);
        if (!room) return;

        const player = room.get(userId);
        if (!player) return;

        // Client sends full evaluations array — replace, never accumulate
        player.evaluations = msg.evaluations ?? [];
        player.wordLength = msg.wordLength ?? player.wordLength;

        broadcast(room, userId, {
          type: "player_guess",
          userId,
          displayName: player.displayName,
          evaluations: player.evaluations,
          wordLength: player.wordLength,
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
    players.push({ userId: uid, displayName: player.displayName, avatarHash: player.avatarHash, evaluations: player.evaluations, wordLength: player.wordLength ?? 6 });
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
  // PUT /commands replaces ALL commands atomically — handles updates to existing commands
  const url = `https://discord.com/api/v10/applications/${clientId}/commands`;

  const commands = [
    {
      name: "hexordle",
      description: "Play Hexordle — guess 5, 6, or 7-letter words",
      type: 4,        // PRIMARY_ENTRY_POINT — Activity Launcher entry
      handler: 1,     // APP_HANDLER — our server handles it, responds with LAUNCH_ACTIVITY
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    },
    {
      name: "hexordle",
      description: "Play Hexordle — guess 5, 6, or 7-letter words",
      type: 1,        // CHAT_INPUT — slash command
      integration_types: [0, 1],
      contexts: [0, 1, 2],
    },
  ];

  try {
    // PUT replaces all commands at once — handles handler/type changes correctly
    const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(commands) });
    if (res.ok) {
      console.log("[Bot] Commands registered (Activity Launcher + /hexordle slash command)");
    } else {
      const err = await res.json();
      console.error("[Bot] Failed to register commands:", err);
    }
  } catch (err) {
    console.error("[Bot] Error registering commands:", err);
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
