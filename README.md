# GPT Astra

A responsive AI chat website with sign-up/sign-in, persistent chat history, dark/light theme, browser voice input, read-aloud, and image attachment support.

## Requirements
- Node.js 18+
- An API provider that supports the OpenAI Chat Completions-compatible API format (vision requires a vision-capable model)

## Setup
1. Extract the ZIP and open a terminal in this folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`.
4. Edit `.env`:
   - `AI_BASE_URL`: your provider's OpenAI-compatible API base URL, commonly ending in `/v1`.
   - `AI_API_KEY`: your provider's API key.
   - `AI_MODEL`: exact model identifier from your provider.
   - `SESSION_SECRET`: long random secret, at least 32 characters.
5. Run:
   ```bash
   npm start
   ```
6. Open `http://localhost:3000`.

## Security notes
- Never place the API key in `public/index.html`, `public/app.js`, or any browser-side code.
- `.env` is ignored by Git; do not upload it publicly.
- Use HTTPS in production and set `NODE_ENV=production`.
- For production deployment, use a reverse proxy, persistent disk for SQLite, backups, and a strong unique session secret.
- This starter stores account passwords using bcrypt hashes and sessions/chat history in SQLite. Add email verification, password reset, CSRF protection, privacy/retention controls, and production monitoring before public launch.
- Provider endpoints and models differ. If your API isn't OpenAI-compatible, this adapter needs to be changed to match that provider's API format.
- Image understanding requires a provider model that supports image inputs. Browser voice input depends on browser speech-recognition support and microphone permissions.

## Files
- `public/index.html` — website UI
- `public/style.css` — responsive styling
- `public/app.js` — browser interactions
- `server.js` — API backend, authentication, chat persistence, provider requests
- `.env.example` — environment configuration template
