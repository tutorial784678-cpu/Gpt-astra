require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  console.warn("WARNING: Set SESSION_SECRET to a random value of at least 32 characters in .env");
}
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: sessionSecret || "development-only-change-this-session-secret-now",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const db = require("better-sqlite3")(path.join(DATA_DIR, "astra.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    messages TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: "draft-7", legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in to continue." });
  next();
}
function getChat(chatId, userId) {
  return db.prepare("SELECT * FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId);
}
function aiClient() {
  if (!process.env.AI_API_KEY || !process.env.AI_BASE_URL || !process.env.AI_MODEL) {
    throw new Error("AI provider is not configured. Set AI_API_KEY, AI_BASE_URL, and AI_MODEL in your server .env file.");
  }
  return new OpenAI({
    apiKey: process.env.AI_API_KEY,
    baseURL: process.env.AI_BASE_URL,
    timeout: 90000,
    maxRetries: 1
  });
}

app.get("/api/config", (_req, res) => res.json({
  appName: "GPT Astra",
  configured: Boolean(process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL)
}));
app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(req.session.userId);
  res.json({ user: user || null });
});
app.post("/api/auth/signup", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: "Password must be 10–128 characters long." });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
    req.session.userId = result.lastInsertRowid;
    res.json({ user: { id: result.lastInsertRowid, email } });
  } catch (e) {
    if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({ error: "An account with this email already exists." });
    res.status(500).json({ error: "Could not create your account." });
  }
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  req.session.userId = user.id;
  res.json({ user: { id: user.id, email: user.email } });
});
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/chats", requireAuth, (req, res) => {
  const chats = db.prepare("SELECT id, title, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC").all(req.session.userId);
  res.json({ chats });
});
app.post("/api/chats", requireAuth, (req, res) => {
  const id = require("crypto").randomUUID();
  db.prepare("INSERT INTO chats (id, user_id, title, messages) VALUES (?, ?, 'New chat', '[]')").run(id, req.session.userId);
  res.json({ chat: { id, title: "New chat", messages: [] } });
});
app.get("/api/chats/:id", requireAuth, (req, res) => {
  const chat = getChat(req.params.id, req.session.userId);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  res.json({ chat: { id: chat.id, title: chat.title, messages: JSON.parse(chat.messages) } });
});
app.delete("/api/chats/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM chats WHERE id = ? AND user_id = ?").run(req.params.id, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: "Chat not found." });
  res.json({ ok: true });
});

app.post("/api/chat", requireAuth, chatLimiter, async (req, res) => {
  const { chatId, message, image } = req.body || {};
  if (typeof chatId !== "string" || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "A chat and a message are required." });
  }
  if (message.length > 20000) return res.status(413).json({ error: "Message is too long." });
  if (image && (typeof image !== "string" || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image) || image.length > 8_000_000)) {
    return res.status(400).json({ error: "Use a PNG, JPG, WEBP, or GIF image smaller than about 6 MB." });
  }
  const chat = getChat(chatId, req.session.userId);
  if (!chat) return res.status(404).json({ error: "Chat not found." });

  let messages;
  try { messages = JSON.parse(chat.messages); } catch { messages = []; }
  const userContent = image
    ? [{ type: "text", text: message.trim() || "Please describe this image." }, { type: "image_url", image_url: { url: image } }]
    : message.trim();
  messages.push({ role: "user", content: userContent });
  try {
    const client = aiClient();
    const response = await client.chat.completions.create({
      model: process.env.AI_MODEL,
      messages: [
        { role: "system", content: "You are GPT Astra, a helpful, honest, friendly AI assistant. Respond in the language the user uses when practical. Do not claim capabilities you do not have." },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ],
      max_tokens: 1800
    });
    const answer = response.choices?.[0]?.message?.content;
    if (!answer || typeof answer !== "string") throw new Error("The AI provider returned an empty response.");
    messages.push({ role: "assistant", content: answer });
    const title = chat.title === "New chat" ? message.trim().slice(0, 48) : chat.title;
    db.prepare("UPDATE chats SET title = ?, messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
      .run(title || "New chat", JSON.stringify(messages), chatId, req.session.userId);
    res.json({ answer, title });
  } catch (err) {
    // Avoid returning provider internals, request headers, or secrets to the browser.
    const status = err.status === 401 ? 502 : 502;
    console.error("AI request failed:", err.message);
    res.status(status).json({ error: "AI request failed. Check your provider URL, API key, model name, and provider compatibility in .env." });
  }
});

app.use(express.static(path.join(__dirname, "public")));
app.use((err, _req, res, _next) => {
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Unexpected server error." });
});
app.listen(PORT, () => console.log(`GPT Astra running at http://localhost:${PORT}`));
