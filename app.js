/**
 * PST Engine — Frontend Application
 * Handles chat UI, Cloudflare Worker communication, and PST result rendering.
 *
 * SETUP: Set WORKER_URL to your deployed Cloudflare Worker URL.
 */

// ─── Configuration ─────────────────────────────────────────────────────────────
// Replace with your Cloudflare Worker URL after deployment
const WORKER_URL = "https://pst.emezch93.workers.dev/chat";

// ─── State ────────────────────────────────────────────────────────────────────
let conversationHistory = [];  // [{role: "user"|"model", content: "string"}]
let messageCount = 0;
let isWaiting = false;
let lastPSTResult = null;

// ─── DOM References ───────────────────────────────────────────────────────────
const messagesEl    = document.getElementById("messages");
const inputEl       = document.getElementById("user-input");
const sendBtn       = document.getElementById("send-btn");
const typingEl      = document.getElementById("typing-indicator");
const welcomeEl     = document.getElementById("welcome-screen");
const chatEl        = document.getElementById("chat-container");
const msgCountEl    = document.getElementById("message-count");
const statusEl      = document.getElementById("status-indicator");

// ─── Init ─────────────────────────────────────────────────────────────────────
inputEl.focus();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 128) + "px";
}

function handleKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function setStatus(text, active = true) {
  const dot  = statusEl.querySelector("div");
  const span = statusEl.querySelector("span");
  if (span) span.textContent = text;
  if (dot)  dot.className = `w-1.5 h-1.5 rounded-full ${active ? "bg-signal animate-pulse" : "bg-dim"}`;
}

function updateMessageCount() {
  msgCountEl.textContent = messageCount;
}

function setExample(text) {
  inputEl.value = text;
  autoResize(inputEl);
  inputEl.focus();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    const container = chatEl;
    container.scrollTop = container.scrollHeight;
  });
}

// ─── PST Math ─────────────────────────────────────────────────────────────────

function calculatePSF(vars) {
  const { I, S, R, C, T, U, K, P } = vars;
  const positive = Math.pow(I * S * R * C * T, 1 / 5);
  const negative = Math.pow(U * K * P, 1 / 3);
  return negative === 0 ? 0 : positive / negative;
}

function getStabilityLevel(psf) {
  if (psf < 0.8)  return "CRITICAL";
  if (psf < 1.2)  return "WEAK";
  if (psf < 2.0)  return "MODERATE";
  if (psf < 3.0)  return "STRONG";
  return "EXCEPTIONAL";
}

function getStabilityColor(level) {
  const map = {
    CRITICAL:    "#FF4444",
    WEAK:        "#FF8C00",
    MODERATE:    "#F5C518",
    STRONG:      "#4CAF50",
    EXCEPTIONAL: "#00E5A0",
  };
  return map[level] || "#8899AA";
}

// ─── Message Rendering ─────────────────────────────────────────────────────────

function appendUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg-user";
  el.innerHTML = `<div class="bubble">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendAIMessage(text) {
  // Check for PST result block
  const pstMatch = text.match(/<PST_RESULT>([\s\S]*?)<\/PST_RESULT>/);

  if (pstMatch) {
    try {
      const jsonStr = pstMatch[1].trim();
      const data    = JSON.parse(jsonStr);

      // Recalculate PSF for verification
      const scores = {
        I: data.variables.I.score,
        S: data.variables.S.score,
        R: data.variables.R.score,
        C: data.variables.C.score,
        T: data.variables.T.score,
        U: data.variables.U.score,
        K: data.variables.K.score,
        P: data.variables.P.score,
      };
      data.psf             = parseFloat(calculatePSF(scores).toFixed(3));
      data.stability_level = getStabilityLevel(data.psf);
      lastPSTResult        = data;

      // Render compact result card in chat
      renderPSTCard(data);

      // If there's text after the block, show it too
      const afterText = text.replace(/<PST_RESULT>[\s\S]*?<\/PST_RESULT>/, "").trim();
      if (afterText) appendAITextBubble(afterText);

      return;
    } catch (err) {
      console.error("PST JSON parse error:", err);
      // Fall through to render as normal text
    }
  }

  appendAITextBubble(text);
}

function appendAITextBubble(text) {
  const el = document.createElement("div");
  el.className = "msg-ai";
  el.innerHTML = `
    <div class="avatar">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M1 9 L2.5 5.5 L5 7.5 L7.5 3 L10 4.5" stroke="#00E5A0" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="bubble">${formatText(text)}</div>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function appendErrorMessage(text) {
  const el = document.createElement("div");
  el.className = "msg-ai msg-error";
  el.innerHTML = `
    <div class="avatar" style="border-color:rgba(255,68,68,0.3);background:rgba(255,68,68,0.1)">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 2v4M6 8.5v.5" stroke="#FF4444" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="bubble">${escapeHtml(text)}</div>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();
}

// ─── PST Result Card Renderer ──────────────────────────────────────────────────

function renderPSTCard(data) {
  const color  = getStabilityColor(data.stability_level);
  const scores = data.variables;

  const variableDefs = [
    { key: "I", label: "Information",   type: "pos" },
    { key: "S", label: "Skills",        type: "pos" },
    { key: "R", label: "Resources",     type: "pos" },
    { key: "C", label: "Coordination",  type: "pos" },
    { key: "T", label: "Time",          type: "pos" },
    { key: "U", label: "Uncertainty",   type: "neg" },
    { key: "K", label: "Risk",          type: "neg" },
    { key: "P", label: "Pressure",      type: "neg" },
  ];

  const barsHtml = variableDefs.map(({ key, label, type }) => {
    const score    = scores[key]?.score || 0;
    const pct      = (score / 10) * 100;
    const barColor = type === "pos" ? "#00E5A0" : "#FF4444";
    const lblColor = type === "pos" ? "#00E5A0" : "#FF4444";
    return `
      <div class="flex items-center gap-2 py-0.5">
        <div class="w-3 text-xs font-mono font-medium" style="color:${lblColor}">${key}</div>
        <div class="text-xs text-dim w-20 truncate">${label}</div>
        <div class="flex-1 var-bar-track">
          <div class="var-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="text-xs font-mono text-ink w-4 text-right">${score}</div>
      </div>
    `;
  }).join("");

  const recsHtml = (data.recommendations || []).slice(0, 3).map(r => `
    <div class="rec-item">
      <div class="rec-priority-${r.priority} text-xs font-mono font-medium w-12 flex-shrink-0 pt-0.5">${r.priority}</div>
      <div class="text-xs text-dim leading-relaxed">${escapeHtml(r.action)}</div>
    </div>
  `).join("");

  const cardEl = document.createElement("div");
  cardEl.className = "msg-ai";
  cardEl.innerHTML = `
    <div class="avatar" style="align-self:flex-start;margin-top:2px">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M1 9 L2.5 5.5 L5 7.5 L7.5 3 L10 4.5" stroke="#00E5A0" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div>
      <div class="pst-result-card">
        <!-- Header: PSF Score + Goal -->
        <div class="pst-result-header">
          <div class="flex-1 min-w-0">
            <div class="text-xs text-dim mb-1">DOMAIN — ${escapeHtml(data.domain || "—")}</div>
            <div class="text-sm font-medium text-ink mb-2 leading-snug">${escapeHtml(data.goal || "")}</div>
            <span class="badge-${data.stability_level} px-2 py-0.5 rounded text-xs font-mono font-semibold">${data.stability_level}</span>
          </div>
          <div class="psf-ring" style="border-color:${color};background:${color}15">
            <div class="text-xs font-mono font-semibold" style="color:${color}">${data.psf.toFixed(2)}</div>
            <div class="text-xs text-dim" style="font-size:9px">PSF</div>
          </div>
        </div>

        <!-- Variable Bars -->
        <div class="pst-result-body border-b border-border/60">
          <div class="text-xs text-dim mb-2 font-mono">VARIABLE SCORES</div>
          ${barsHtml}
        </div>

        <!-- Stability explanation -->
        <div class="pst-result-body border-b border-border/60 py-3">
          <div class="text-xs text-dim mb-1.5 font-mono">ANALYSIS</div>
          <p class="text-xs text-dim leading-relaxed">${escapeHtml(data.stability_explanation || "")}</p>
        </div>

        <!-- Recommendations -->
        ${recsHtml ? `
        <div class="pst-result-body py-3">
          <div class="text-xs text-dim mb-1.5 font-mono">RECOMMENDATIONS</div>
          ${recsHtml}
        </div>` : ""}

        <!-- Footer -->
        <div class="px-4 pb-3">
          <button class="view-report-btn" onclick="openModal()">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="2" width="10" height="8" rx="1" stroke="currentColor" stroke-width="1.1"/>
              <line x1="3" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
              <line x1="3" y1="7" x2="7" y2="7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
            View Full Report
          </button>
        </div>
      </div>
    </div>
  `;

  messagesEl.appendChild(cardEl);
  scrollToBottom();
}

// ─── Full Report Modal ─────────────────────────────────────────────────────────

function openModal() {
  if (!lastPSTResult) return;
  const data  = lastPSTResult;
  const color = getStabilityColor(data.stability_level);

  // Badge
  const badge = document.getElementById("modal-stability-badge");
  badge.className = `badge-${data.stability_level} px-2 py-0.5 rounded text-xs font-mono font-semibold`;
  badge.textContent = data.stability_level;

  document.getElementById("modal-goal").textContent = data.goal || "—";

  const variableDefs = [
    { key: "I", label: "Information",  type: "pos", full: "I (Information)" },
    { key: "S", label: "Skills",       type: "pos", full: "S (Skills)" },
    { key: "R", label: "Resources",    type: "pos", full: "R (Resources)" },
    { key: "C", label: "Coordination", type: "pos", full: "C (Coordination)" },
    { key: "T", label: "Time",         type: "pos", full: "T (Time Availability)" },
    { key: "U", label: "Uncertainty",  type: "neg", full: "U (Uncertainty)" },
    { key: "K", label: "Risk",         type: "neg", full: "K (Risk)" },
    { key: "P", label: "Pressure",     type: "neg", full: "P (Pressure)" },
  ];

  const scores = data.variables;

  const allVarsHtml = variableDefs.map(({ key, label, type, full }) => {
    const score    = scores[key]?.score || 0;
    const reason   = scores[key]?.reasoning || "";
    const pct      = (score / 10) * 100;
    const barColor = type === "pos" ? "#00E5A0" : "#FF4444";
    const lblColor = type === "pos" ? "#00E5A0" : "#FF4444";
    const icon     = type === "pos"
      ? `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 8L5 2L8 8" stroke="#00E5A0" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2L5 8L8 2" stroke="#FF4444" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

    return `
      <div class="bg-panel rounded-xl p-3 border border-border/60">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            ${icon}
            <span class="text-xs font-mono" style="color:${lblColor}">${key}</span>
            <span class="text-xs text-dim">${label}</span>
          </div>
          <span class="text-sm font-mono font-semibold" style="color:${lblColor}">${score}/10</span>
        </div>
        <div class="var-bar-track mb-2">
          <div class="var-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <p class="text-xs text-dim leading-relaxed">${escapeHtml(reason)}</p>
      </div>
    `;
  }).join("");

  const posDrivers = (data.positive_drivers || []).map(d =>
    `<div class="flex gap-2 text-xs"><span class="text-signal mt-0.5">+</span><span class="text-dim">${escapeHtml(d)}</span></div>`
  ).join("");

  const negDrivers = (data.negative_drivers || []).map(d =>
    `<div class="flex gap-2 text-xs"><span class="text-critical mt-0.5">−</span><span class="text-dim">${escapeHtml(d)}</span></div>`
  ).join("");

  const allRecsHtml = (data.recommendations || []).map((r, i) => `
    <div class="bg-panel rounded-lg p-3 border border-border/60 flex gap-3">
      <div class="flex-shrink-0 mt-0.5">
        <span class="text-xs font-mono font-semibold rec-priority-${r.priority}">${r.priority}</span>
      </div>
      <div class="flex-1">
        <p class="text-xs text-ink leading-relaxed">${escapeHtml(r.action)}</p>
        ${r.targets?.length ? `<div class="mt-1 flex gap-1 flex-wrap">${r.targets.map(t => `<span class="text-xs px-1.5 py-0.5 rounded bg-border/50 text-dim font-mono">${t}</span>`).join("")}</div>` : ""}
      </div>
    </div>
  `).join("");

  // Compute formula display
  const v   = scores;
  const pos = Math.pow(v.I.score * v.S.score * v.R.score * v.C.score * v.T.score, 1/5).toFixed(3);
  const neg = Math.pow(v.U.score * v.K.score * v.P.score, 1/3).toFixed(3);

  document.getElementById("modal-body").innerHTML = `
    <!-- PSF Summary -->
    <div class="flex items-center gap-4 bg-panel rounded-xl p-4 border border-border/60">
      <div class="psf-ring flex-shrink-0" style="border-color:${color};background:${color}15;width:72px;height:72px">
        <div class="text-lg font-mono font-bold" style="color:${color}">${data.psf.toFixed(3)}</div>
        <div class="text-xs text-dim">PSF</div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-dim mb-1 font-mono">FORMULA BREAKDOWN</div>
        <div class="font-mono text-xs text-dim">
          Positive: (${v.I.score}×${v.S.score}×${v.R.score}×${v.C.score}×${v.T.score})^1/5 = <span class="text-signal">${pos}</span>
        </div>
        <div class="font-mono text-xs text-dim mt-0.5">
          Negative: (${v.U.score}×${v.K.score}×${v.P.score})^1/3 = <span class="text-critical">${neg}</span>
        </div>
        <div class="font-mono text-xs text-ink mt-1">
          PSF = ${pos} / ${neg} = <span style="color:${color}">${data.psf.toFixed(3)}</span>
        </div>
      </div>
    </div>

    <!-- Variables -->
    <div>
      <div class="text-xs text-dim font-mono mb-3">VARIABLE ASSESSMENT</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        ${allVarsHtml}
      </div>
    </div>

    <!-- Drivers -->
    ${(posDrivers || negDrivers) ? `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      ${posDrivers ? `
      <div class="bg-panel rounded-xl p-3 border border-border/60">
        <div class="text-xs text-signal font-mono mb-2">STABILITY DRIVERS</div>
        <div class="space-y-1.5">${posDrivers}</div>
      </div>` : ""}
      ${negDrivers ? `
      <div class="bg-panel rounded-xl p-3 border border-border/60">
        <div class="text-xs text-critical font-mono mb-2">DESTABILISING FACTORS</div>
        <div class="space-y-1.5">${negDrivers}</div>
      </div>` : ""}
    </div>` : ""}

    <!-- Analysis -->
    <div class="bg-panel rounded-xl p-4 border border-border/60">
      <div class="text-xs text-dim font-mono mb-2">STABILITY ANALYSIS</div>
      <p class="text-sm text-dim leading-relaxed">${escapeHtml(data.stability_explanation || "")}</p>
    </div>

    <!-- Recommendations -->
    ${allRecsHtml ? `
    <div>
      <div class="text-xs text-dim font-mono mb-3">IMPROVEMENT PLAN</div>
      <div class="space-y-2">${allRecsHtml}</div>
    </div>` : ""}
  `;

  document.getElementById("result-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("result-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

// Close modal on backdrop click
document.getElementById("result-modal").addEventListener("click", function(e) {
  if (e.target === this) closeModal();
});

// Close on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ─── Core Send Logic ──────────────────────────────────────────────────────────

async function sendMessage() {
  if (isWaiting) return;
  const text = inputEl.value.trim();
  if (!text) return;

  // Switch from welcome screen to chat
  if (welcomeEl && !welcomeEl.classList.contains("hidden")) {
    welcomeEl.classList.add("hidden");
    chatEl.classList.remove("hidden");
    chatEl.classList.add("flex", "flex-col");
  }

  // Add to history and UI
  conversationHistory.push({ role: "user", content: text });
  appendUserMessage(text);
  messageCount++;
  updateMessageCount();

  // Clear input
  inputEl.value = "";
  inputEl.style.height = "auto";
  inputEl.focus();

  // Set waiting state
  isWaiting = true;
  sendBtn.disabled = true;
  typingEl.classList.remove("hidden");
  setStatus("Analysing…");
  scrollToBottom();

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Server returned an invalid response.");
    }

    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }

    const reply = data.reply || "No response.";
    conversationHistory.push({ role: "model", content: reply });
    appendAIMessage(reply);
    messageCount++;
    updateMessageCount();
    setStatus("Ready");

  } catch (err) {
    console.error("Chat error:", err);
    const msg = err.message || "Connection failed. Check your Worker URL and try again.";
    appendErrorMessage(`⚠ ${msg}`);
    setStatus("Error", false);
    // Remove the failed user message from history to allow retry
    conversationHistory.pop();
    messageCount--;
    updateMessageCount();
  } finally {
    isWaiting = false;
    sendBtn.disabled = false;
    typingEl.classList.add("hidden");
    scrollToBottom();
  }
}

// ─── Session Reset ─────────────────────────────────────────────────────────────

function resetSession() {
  conversationHistory = [];
  messageCount        = 0;
  lastPSTResult       = null;
  messagesEl.innerHTML = "";
  updateMessageCount();
  setStatus("Ready");

  welcomeEl.classList.remove("hidden");
  chatEl.classList.add("hidden");
  chatEl.classList.remove("flex", "flex-col");

  inputEl.value = "";
  inputEl.style.height = "auto";
  inputEl.focus();
  closeModal();
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(text) {
  // Basic markdown-like formatting for AI text responses
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, `<code class="font-mono text-signal bg-signal/10 px-1 py-0.5 rounded text-xs">$1</code>`)
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p><\/p>/g, "");
}