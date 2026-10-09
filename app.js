(() => {
  const $ = id => document.getElementById(id);
  const state = { user: null, chats: [], chatId: null, image: null, authMode: "login", busy: false, recognition: null };
  const messagesEl = $("messages"), welcome = $("welcome"), promptEl = $("prompt");
  let toastTimer;
  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
  function setBusy(value) { state.busy = value; $("sendBtn").disabled = value; $("sendBtn").innerHTML = value ? "…" : "<span>↑</span>"; }
  function showAuth(mode = "login") { setAuthMode(mode); $("authError").textContent = ""; $("authModal").hidden = false; setTimeout(() => $("email").focus(), 30); }
  function closeAuth() { $("authModal").hidden = true; }
  function setAuthMode(mode) {
    state.authMode = mode;
    document.querySelectorAll(".auth-tabs button").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
    $("authTitle").textContent = mode === "login" ? "Your space for ideas." : "Create your Astra account.";
    $("authSubmit").textContent = mode === "login" ? "Sign in" : "Create account";
    $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("password").minLength = mode === "login" ? 1 : 10;
  }
  function updateAccount() {
    $("accountArea").innerHTML = state.user
      ? `<div class="avatar">${escapeHtml(state.user.email[0].toUpperCase())}</div><div class="account-copy"><b>${escapeHtml(state.user.email)}</b><small>Signed in</small></div><button class="subtle-btn" id="logoutBtn">Log out</button>`
      : `<div class="avatar">A</div><div class="account-copy"><b>Guest mode</b><small>Sign in to save chats</small></div><button class="subtle-btn" id="openAuth">Sign in</button>`;
    $("openAuth")?.addEventListener("click", () => showAuth("login"));
    $("logoutBtn")?.addEventListener("click", logout);
    $("topAuth").textContent = state.user ? "Account" : "Sign in";
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])); }
  function renderChatList() {
    const list = $("chatList"); list.innerHTML = "";
    if (!state.user) { list.innerHTML = '<div class="side-empty">Sign in to save and revisit your conversations.</div>'; return; }
    if (!state.chats.length) { list.innerHTML = '<div class="side-empty">Your conversations will appear here.</div>'; return; }
    state.chats.forEach(chat => {
      const row = document.createElement("div"); row.className = "chat-item" + (chat.id === state.chatId ? " active" : "");
      const label = document.createElement("span"); label.textContent = chat.title || "New chat";
      const del = document.createElement("button"); del.className = "chat-delete"; del.title = "Delete chat"; del.setAttribute("aria-label", "Delete chat"); del.textContent = "×";
      del.addEventListener("click", async e => { e.stopPropagation(); if (!confirm("Delete this conversation?")) return; try { await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "DELETE" }); if (state.chatId === chat.id) await newChat(); await loadChats(); } catch (err) { toast(err.message); } });
      row.append(label, del); row.addEventListener("click", () => openChat(chat.id)); list.append(row);
    });
  }
  function addMessage(role, content, image = null) {
    welcome.hidden = true;
    const wrap = document.createElement("article"); wrap.className = `message ${role}`;
    const avatar = document.createElement("div"); avatar.className = "msg-avatar"; avatar.textContent = role === "assistant" ? "✦" : (state.user?.email?.[0]?.toUpperCase() || "Y");
    const body = document.createElement("div"); body.className = "message-body";
    const text = document.createElement("div"); text.className = "message-text";
    if (image) { const img = document.createElement("img"); img.src = image; img.alt = "Attached image"; text.append(img); }
    if (content) { const contentEl = document.createElement("div"); contentEl.textContent = content; text.append(contentEl); }
    body.append(text);
    if (role === "assistant" && content) {
      const actions = document.createElement("div"); actions.className = "message-actions";
      const copy = document.createElement("button"); copy.textContent = "Copy"; copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(content); toast("Copied to clipboard"); } catch { toast("Unable to copy here"); } });
      const speak = document.createElement("button"); speak.textContent = "Read aloud"; speak.addEventListener("click", () => { if (!("speechSynthesis" in window)) return toast("Read aloud is not supported in this browser."); speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(content)); });
      actions.append(copy, speak); body.append(actions);
    }
    wrap.append(avatar, body); messagesEl.append(wrap); $("conversation").scrollTop = $("conversation").scrollHeight;
    return wrap;
  }
  function showTyping() {
    const wrap = document.createElement("article"); wrap.className = "message"; wrap.id = "typingIndicator";
    wrap.innerHTML = '<div class="msg-avatar">✦</div><div class="message-body"><div class="typing"><i></i><i></i><i></i></div></div>';
    messagesEl.append(wrap); $("conversation").scrollTop = $("conversation").scrollHeight;
  }
  async function loadChats() {
    if (!state.user) { state.chats = []; renderChatList(); return; }
    const data = await api("/api/chats"); state.chats = data.chats; renderChatList();
  }
  async function newChat() {
    messagesEl.innerHTML = ""; welcome.hidden = false; state.image = null; state.chatId = null; updateImagePreview();
    if (state.user) {
      const data = await api("/api/chats", { method: "POST", body: "{}" }); state.chatId = data.chat.id; await loadChats();
    }
    closeSidebar();
  }
  async function openChat(id) {
    try {
      const data = await api(`/api/chats/${encodeURIComponent(id)}`);
      state.chatId = id; messagesEl.innerHTML = ""; welcome.hidden = true;
      for (const m of data.chat.messages) {
        let content = m.content, image = null;
        if (Array.isArray(content)) {
          const t = content.find(x => x.type === "text"); content = t?.text || "";
          image = content ? null : null;
        }
        addMessage(m.role === "assistant" ? "assistant" : "user", typeof content === "string" ? content : "");
      }
      renderChatList(); closeSidebar(); $("conversation").scrollTop = $("conversation").scrollHeight;
    } catch (err) { toast(err.message); }
  }
  async function sendMessage(rawText) {
    const message = rawText.trim();
    if (state.busy || (!message && !state.image)) return;
    if (!state.user) { showAuth("login"); toast("Sign in or create an account to chat."); return; }
    try {
      if (!state.chatId) {
        const created = await api("/api/chats", { method: "POST", body: "{}" }); state.chatId = created.chat.id;
      }
      const attachedImage = state.image;
      addMessage("user", message || "Please describe this image.", attachedImage);
      promptEl.value = ""; resizePrompt(); state.image = null; updateImagePreview();
      setBusy(true); showTyping();
      const result = await api("/api/chat", { method: "POST", body: JSON.stringify({ chatId: state.chatId, message: message || "Please describe this image.", image: attachedImage }) });
      $("typingIndicator")?.remove(); addMessage("assistant", result.answer);
      await loadChats();
    } catch (err) {
      $("typingIndicator")?.remove(); addMessage("assistant", `Sorry, I couldn't complete that request.\n\n${err.message}`);
    } finally { setBusy(false); promptEl.focus(); }
  }
  async function logout() {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); state.user = null; state.chats = []; state.chatId = null; messagesEl.innerHTML = ""; welcome.hidden = false; updateAccount(); renderChatList(); toast("Signed out"); }
    catch (err) { toast(err.message); }
  }
  async function init() {
    try {
      const [me, config] = await Promise.all([api("/api/me"), api("/api/config")]);
      state.user = me.user; updateAccount();
      if (!config.configured) toast("Setup needed: configure your AI provider in the server .env file.");
      if (state.user) { await loadChats(); }
    } catch { toast("Could not connect to the server. Try refreshing."); }
  }
  function updateImagePreview() {
    $("attachmentPreview").hidden = !state.image;
    $("attachmentName").textContent = state.image ? "Image ready to send" : "";
    $("attachBtn").style.color = state.image ? "var(--accent)" : "";
  }
  function resizePrompt() { promptEl.style.height = "auto"; promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + "px"; }
  function closeSidebar() { $("sidebar").classList.remove("open"); $("scrim").classList.remove("show"); }
  $("composer").addEventListener("submit", e => { e.preventDefault(); sendMessage(promptEl.value); });
  promptEl.addEventListener("input", resizePrompt);
  promptEl.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(promptEl.value); } });
  $("newChat").addEventListener("click", async () => { try { await newChat(); } catch (err) { toast(err.message); } });
  $("suggestions")?.addEventListener("click", () => {});
  document.querySelectorAll(".suggestion").forEach(btn => btn.addEventListener("click", () => { promptEl.value = btn.dataset.prompt; resizePrompt(); promptEl.focus(); }));
  $("attachBtn").addEventListener("click", () => $("imageInput").click());
  $("imageInput").addEventListener("change", e => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast("Please choose an image under 6 MB."); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { state.image = reader.result; updateImagePreview(); };
    reader.onerror = () => toast("Could not read that image.");
    reader.readAsDataURL(file); e.target.value = "";
  });
  $("removeImage").addEventListener("click", () => { state.image = null; updateImagePreview(); });
  $("voiceBtn").addEventListener("click", () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input is not supported in this browser. Try Chrome."); return; }
    if (state.recognition) { state.recognition.stop(); state.recognition = null; $("voiceBtn").classList.remove("listening"); return; }
    const rec = new SR(); state.recognition = rec; rec.lang = navigator.language || "en-US"; rec.interimResults = true;
    $("voiceBtn").classList.add("listening"); toast("Listening… speak now");
    rec.onresult = e => { let result = ""; for (let i = e.resultIndex; i < e.results.length; i++) result += e.results[i][0].transcript; promptEl.value = result; resizePrompt(); };
    rec.onerror = () => toast("Microphone unavailable or permission denied.");
    rec.onend = () => { state.recognition = null; $("voiceBtn").classList.remove("listening"); };
    rec.start();
  });
  function toggleTheme() { document.documentElement.classList.toggle("light"); const light = document.documentElement.classList.contains("light"); localStorage.setItem("astra-theme", light ? "light" : "dark"); }
  try { if (localStorage.getItem("astra-theme") === "light") document.documentElement.classList.add("light"); } catch {}
  $("themeToggle").addEventListener("click", toggleTheme); $("topTheme").addEventListener("click", toggleTheme);
  $("openAuth")?.addEventListener("click", () => showAuth("login")); $("topAuth").addEventListener("click", () => state.user ? toast(`Signed in as ${state.user.email}`) : showAuth("login"));
  $("closeAuth").addEventListener("click", closeAuth);
  $("authModal").addEventListener("click", e => { if (e.target === $("authModal")) closeAuth(); });
  document.querySelectorAll(".auth-tabs button").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.mode)));
  $("authForm").addEventListener("submit", async e => {
    e.preventDefault(); $("authError").textContent = ""; $("authSubmit").disabled = true;
    try {
      const endpoint = state.authMode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const data = await api(endpoint, { method: "POST", body: JSON.stringify({ email: $("email").value, password: $("password").value }) });
      state.user = data.user; closeAuth(); updateAccount(); await loadChats();
      if (!state.chatId) { const created = await api("/api/chats", { method: "POST", body: "{}" }); state.chatId = created.chat.id; await loadChats(); }
      toast(state.authMode === "login" ? "Welcome back!" : "Account created."); closeSidebar();
    } catch (err) { $("authError").textContent = err.message; }
    finally { $("authSubmit").disabled = false; }
  });
  $("menuBtn").addEventListener("click", () => { $("sidebar").classList.add("open"); $("scrim").classList.add("show"); });
  $("closeSidebar").addEventListener("click", closeSidebar); $("scrim").addEventListener("click", closeSidebar);
  init();
})();
