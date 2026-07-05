/* ==========================================================
   The Hint Ladder — fully static, client-only version.
   Calls Claude directly from the browser using the user's own
   API key (stored in localStorage only). No backend required,
   so this runs as-is on GitHub Pages.

   Cost design:
   - Tiers 1-4: one cheap (Haiku) call each, personalizing a
     pre-written template to the specific problem + attempt.
     Cached in localStorage so an identical resend is free.
   - Tier 5: one heavy (Sonnet) call to actually solve the
     problem — cached FOREVER per unique problem, so re-hitting
     the same problem (even in a future session) is free. A
     second cheap call then writes a personalized comparison
     against this student's specific attempts (not cached,
     since it depends on their attempts).
   - File uploads: one cheap call to read the file, cached by
     file hash.
   ========================================================== */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-5";
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_HAIKU_PER_DAY = 150; // soft, per-browser cap — edit here if you want more/less
const MAX_SONNET_PER_DAY = 50;

const TIER_NAMES = ["Confirmed", "Conceptual Foundation", "Relevant Principles", "Targeted Guidance", "Near-Solution Scaffold", "Full Solution"];

const UNITS = [
  { id: "kinematics", name: "Kinematics", tiers: [
    "Start by naming the type of motion. Is the acceleration constant, zero, or changing? What are the initial position, velocity, and time?",
    "This is a constant-acceleration problem, so the kinematic equations apply: v = v0 + at, x = x0 + v0t + \u00bdat\u00b2, v\u00b2 = v0\u00b2 + 2a\u0394x.",
    "Pick one positive direction and stay consistent with your signs. List every known variable and the one you're solving for \u2014 that narrows down which equation fits.",
    "You should be able to write one kinematic equation that has exactly one unknown in it. Which of the four has only the variables you listed?"
  ]},
  { id: "newtons-laws", name: "Newton's Laws", tiers: [
    "Is the object in equilibrium (at rest or constant velocity) or accelerating? That tells you whether \u03a3F = 0 or \u03a3F = ma applies.",
    "Draw a free-body diagram first. Every force needs a source: gravity, normal force, tension, friction, or an applied push or pull.",
    "Break each force into x- and y-components along your chosen axes. Remember friction is f = \u03bcN, and tension is the same throughout an ideal string.",
    "Write \u03a3F = ma separately for each axis. You should end up with one equation and one unknown, or two equations for two unknowns."
  ]},
  { id: "energy", name: "Energy", tiers: [
    "Tell the energy story: what forms of energy exist at the start, and what forms exist at the end? Is anything, like friction, removing energy from the system?",
    "If only conservative forces act, mechanical energy is conserved: KEi + PEi = KEf + PEf. If a force does work over a distance, use Wnet = \u0394KE instead.",
    "Identify any non-conservative work, like friction or an applied push. That energy isn't lost \u2014 it's removed from or added to the mechanical energy total.",
    "Set up the full energy balance: KEi + PEi + Wnc = KEf + PEf, then fill in every term you already know."
  ]},
  { id: "momentum", name: "Momentum", tiers: [
    "What kind of collision is this \u2014 elastic, inelastic, or perfectly inelastic? Define the system: which objects are you including?",
    "Momentum, p = mv, is conserved for a system with no external force acting on it. Impulse connects force and time to a momentum change: J = F\u0394t = \u0394p.",
    "Sketch a 'before' and 'after' picture. Pick one positive direction and assign every velocity a sign, even if you have to guess \u2014 the math will correct you.",
    "Write p_initial = p_final for the whole system: m1v1i + m2v2i = m1v1f + m2v2f. If the collision is perfectly inelastic, the objects share one final velocity."
  ]},
  { id: "rotation", name: "Rotation", tiers: [
    "Everything from linear motion has a rotational twin: force becomes torque, mass becomes moment of inertia, acceleration becomes angular acceleration. What's rotating, and about what axis?",
    "Torque is \u03c4 = rF sin\u03b8. Rotational dynamics follow \u03a3\u03c4 = I\u03b1, the rotational version of Newton's second law.",
    "Find the moment of inertia for this shape \u2014 a disk, rod, sphere, and hoop all differ. If it's rolling without slipping, v = r\u03c9 links the linear and angular motion.",
    "Write \u03a3\u03c4 = I\u03b1 using the correct moment of inertia. If linear motion is also involved, you may need \u03a3F = ma as a second equation alongside it."
  ]},
  { id: "oscillations", name: "Oscillations", tiers: [
    "What's providing the restoring force \u2014 a spring, gravity on a pendulum, something else? A restoring force proportional to displacement means simple harmonic motion.",
    "Check the SHM condition, F = -kx (or its pendulum equivalent). This sets a specific angular frequency \u03c9, which fixes the period.",
    "Identify the amplitude, the maximum displacement, and think about phase \u2014 does the motion start at maximum displacement, at equilibrium, or somewhere in between?",
    "Use the SHM relationships: x(t) = A cos(\u03c9t + \u03c6), \u03c9 = \u221a(k/m) for a spring or \u221a(g/L) for a pendulum, and T = 2\u03c0/\u03c9."
  ]},
  { id: "gravitation", name: "Gravitation", tiers: [
    "Two masses are interacting \u2014 what are they, and what's the distance between their centers? Are you solving for force, orbital motion, or energy?",
    "Newton's law of gravitation: F = Gm1m2/r\u00b2. This force is what supplies the centripetal force for anything in orbit.",
    "For a circular orbit, set gravitational force equal to centripetal force to find orbital speed. For energy questions, gravitational PE = -Gm1m2/r, negative because the system is bound.",
    "Set up the equation that matches what's being asked: Gm1m2/r\u00b2 = mv\u00b2/r for orbital speed, or conservation of energy using PE = -Gm1m2/r."
  ]},
  { id: "electrostatics", name: "Electrostatics", tiers: [
    "Identify every charge involved, its sign and magnitude. Do the charges here repel or attract?",
    "Coulomb's law: F = kq1q2/r\u00b2. It has the same shape as gravity, except charges can be positive or negative.",
    "Force and electric field are vectors. With more than one charge, add contributions component by component \u2014 this is superposition, not simple addition of magnitudes.",
    "Set up F = kq1q2/r\u00b2 for force, E = kq/r\u00b2 for field, or V = kq/r for potential, depending on which quantity the problem asks for."
  ]},
  { id: "general", name: "General / Unclassified", tiers: [
    "Before diving into equations, restate the problem in your own words. What's actually being asked, and what physical quantities do you already know?",
    "Think about which broad principle governs this situation \u2014 kinematics, forces, energy, momentum, rotation, oscillation, gravitation, or electrostatics \u2014 and what the core equation for that principle looks like.",
    "List every known quantity with its units, and name the one unknown you're solving for. That pairing usually points straight at the right equation.",
    "Try writing one equation that connects your knowns to your unknown, with no other unknowns hiding in it."
  ]}
];
const UNIT_IDS = UNITS.map((u) => u.id);
function getUnit(id) { return UNITS.find((u) => u.id === id) || UNITS.find((u) => u.id === "general"); }

/* ---------------- State ---------------- */
let unitId = null, unitName = "", problemText = "";
let attempts = [], attemptNumber = 0;
let pendingFile = null;
let isSending = false;

/* ---------------- localStorage helpers ---------------- */
const API_KEY_STORAGE = "hintLadderApiKey";
function getApiKey() { return localStorage.getItem(API_KEY_STORAGE) || ""; }
function setApiKey(key) { localStorage.setItem(API_KEY_STORAGE, key); }
function clearApiKey() { localStorage.removeItem(API_KEY_STORAGE); }

function todayKey() { return new Date().toISOString().slice(0, 10); }
function getUsage() {
  try {
    const raw = JSON.parse(localStorage.getItem("hlUsage") || "null");
    if (!raw || raw.date !== todayKey()) return { date: todayKey(), haiku: 0, sonnet: 0 };
    return raw;
  } catch { return { date: todayKey(), haiku: 0, sonnet: 0 }; }
}
function incrementUsage(tier) {
  const u = getUsage();
  u[tier] = (u[tier] || 0) + 1;
  localStorage.setItem("hlUsage", JSON.stringify(u));
  return u;
}

function cacheGet(key) {
  try { const raw = localStorage.getItem("hlCache:" + key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem("hlCache:" + key, JSON.stringify(value)); } catch { /* storage full, ignore */ }
}

async function hashHex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalize(str) { return (str || "").trim().toLowerCase().replace(/\s+/g, " "); }

/* ---------------- Direct browser call to Claude ---------------- */
async function callClaude({ model, system, messages, maxTokens = 800 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key set. Click \u201cSettings\u201d above and paste your Anthropic API key.");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "The Anthropic API returned an error. Check your key in Settings.");
  }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model output.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/* ---------------- File parsing (cheap, cached by file hash) ---------------- */
async function parseFileWithHaiku(base64, mediaType, suggestedUnitId) {
  const fileHash = await hashHex(base64);
  const cacheKey = "parse:" + fileHash;
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cost: "free (cached)" };

  const usage = getUsage();
  if (usage.haiku >= MAX_HAIKU_PER_DAY) {
    throw new Error(`Daily limit for reading uploaded homework (${MAX_HAIKU_PER_DAY}) reached for this browser. Try again tomorrow, or type the problem in instead.`);
  }

  const contentBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };

  const system = `Extract the physics homework problem from this file. Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{"unitId": "one of: ${UNIT_IDS.join(", ")}", "problemText": "the problem statement, cleanly transcribed, including all given numbers and units"}
Pick the closest matching unitId even if imperfect. If the file has multiple problems, transcribe only the first one.`;

  const raw = await callClaude({
    model: HAIKU_MODEL, system, maxTokens: 500,
    messages: [{ role: "user", content: [contentBlock, { type: "text", text: "Extract the problem as instructed." }] }]
  });

  let parsed;
  try { parsed = extractJSON(raw); }
  catch { parsed = { unitId: suggestedUnitId || "general", problemText: raw.trim() }; }
  if (!UNIT_IDS.includes(parsed.unitId)) parsed.unitId = suggestedUnitId || "general";

  incrementUsage("haiku");
  cacheSet(cacheKey, parsed);
  return { ...parsed, cost: `1 ${HAIKU_MODEL} call` };
}

/* ---------------- Tier 1-4: personalize the static template (cheap, cached) ---------------- */
async function personalizeHint(tier, template, problemTxt, attemptText) {
  const key = "hint:" + tier + ":" + (await hashHex(unitId + "::" + problemTxt + "::" + attemptText));
  const cached = cacheGet(key);
  if (cached) return { text: cached.text, cost: "free (cached)" };

  const usage = getUsage();
  if (usage.haiku >= MAX_HAIKU_PER_DAY) {
    throw new Error(`Daily limit for personalized hints (${MAX_HAIKU_PER_DAY}) reached for this browser. Try again tomorrow.`);
  }

  const tierName = TIER_NAMES[tier];
  const system = `You are an AP Physics tutor delivering Tier ${tier} (${tierName}) of a 5-tier Socratic hint ladder. Rewrite the generic template below so it speaks directly to this specific problem and this student's specific attempt \u2014 keep the SAME level of specificity as the template (don't reveal more, and don't give the final answer). 2-4 sentences, warm and encouraging, at most one question. Respond with ONLY the personalized hint text, nothing else, no preamble.

Generic template: "${template}"
Problem: "${problemTxt}"
Student's attempt: "${attemptText}"`;

  const raw = await callClaude({
    model: HAIKU_MODEL, system, maxTokens: 220,
    messages: [{ role: "user", content: [{ type: "text", text: "Personalize this hint as instructed." }] }]
  });

  const text = raw.trim();
  incrementUsage("haiku");
  cacheSet(key, { text });
  return { text, cost: `1 ${HAIKU_MODEL} call` };
}

/* ---------------- Tier 5: solve once (heavy, cached forever) + personalized comparison (cheap) ---------------- */
async function solveOnce(unitObj, problemTxt) {
  const solutionKey = "solution:" + (await hashHex(unitObj.id + "::" + normalize(problemTxt)));
  const cached = cacheGet(solutionKey);
  if (cached) return { solution: cached, wasCached: true };

  const usage = getUsage();
  if (usage.sonnet >= MAX_SONNET_PER_DAY) {
    throw new Error(`Daily limit for full solutions (${MAX_SONNET_PER_DAY}) reached for this browser. Try again tomorrow.`);
  }

  const system = `You are an AP Physics expert. Solve the given problem correctly and completely. Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{"answer": "the final numeric or symbolic answer, with units", "reasoning": "a clear step-by-step correct solution, written for a student, 4-8 sentences"}`;

  const raw = await callClaude({
    model: SONNET_MODEL, system, maxTokens: 900,
    messages: [{ role: "user", content: [{ type: "text", text: `Unit: ${unitObj.name}\nProblem: ${problemTxt}` }] }]
  });

  let solution;
  try { solution = extractJSON(raw); }
  catch { solution = { answer: "(couldn't parse a clean answer)", reasoning: raw.trim() }; }

  incrementUsage("sonnet");
  cacheSet(solutionKey, solution);
  return { solution, wasCached: false };
}

async function buildTier5Response(unitObj, problemTxt, attemptsList) {
  const { solution, wasCached } = await solveOnce(unitObj, problemTxt);

  let comparisonText;
  try {
    const usage = getUsage();
    if (usage.haiku >= MAX_HAIKU_PER_DAY) throw new Error("haiku cap reached");
    const system = `You are a warm AP Physics tutor. Given the correct answer/reasoning for a problem and a student's own attempts (in order), write a specific 2-4 sentence comparison: where their reasoning matched the correct approach, and where it diverged. Reference their actual words where useful. Respond with ONLY the comparison text, nothing else.

Correct answer: ${solution.answer}
Correct reasoning: ${solution.reasoning}
Student's attempts, in order: ${attemptsList.map((a, i) => `(${i + 1}) ${a}`).join(" | ")}`;
    const raw = await callClaude({
      model: HAIKU_MODEL, system, maxTokens: 260,
      messages: [{ role: "user", content: [{ type: "text", text: "Write the comparison as instructed." }] }]
    });
    incrementUsage("haiku");
    comparisonText = raw.trim();
  } catch {
    const last = attemptsList[attemptsList.length - 1] || "";
    comparisonText = `Your last attempt was: "${last}" \u2014 compare it against the correct reasoning above to see where your thinking matched or diverged.`;
  }

  return {
    text: `Correct answer: ${solution.answer}\n\nCorrect reasoning: ${solution.reasoning}\n\n${comparisonText}`,
    cost: wasCached ? "heavy solve cached \u2014 free (+1 light call)" : `1 ${SONNET_MODEL} call (+1 light call)`
  };
}

/* ---------------- DOM refs ---------------- */
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const clearKeyBtn = document.getElementById("clearKeyBtn");
const keyStatus = document.getElementById("keyStatus");

const setupScreen = document.getElementById("setupScreen");
const tutorScreen = document.getElementById("tutorScreen");
const setupForm = document.getElementById("setupForm");
const unitSelect = document.getElementById("unitSelect");
const problemTextArea = document.getElementById("problemText");
const chooseFileBtn = document.getElementById("chooseFileBtn");
const fileInput = document.getElementById("fileInput");
const fileNameLabel = document.getElementById("fileName");
const newProblemBtn = document.getElementById("newProblemBtn");

const chatLog = document.getElementById("chatLog");
const composerForm = document.getElementById("composerForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const ladderRail = document.getElementById("ladderRail");
const ladderUnitName = document.getElementById("ladderUnitName");
const usageFooter = document.getElementById("usageFooter");

/* ---------------- Settings panel ---------------- */
function refreshKeyStatus() {
  keyStatus.textContent = getApiKey()
    ? "API key saved in this browser \u2713"
    : "No API key set yet \u2014 paste one above to start.";
}
function openSettings() { settingsPanel.classList.remove("hidden"); }
function toggleSettings() { settingsPanel.classList.toggle("hidden"); }

settingsBtn.addEventListener("click", toggleSettings);
saveKeyBtn.addEventListener("click", () => {
  const val = apiKeyInput.value.trim();
  if (!val) { alert("Paste your API key first."); return; }
  setApiKey(val);
  apiKeyInput.value = "";
  refreshKeyStatus();
  settingsPanel.classList.add("hidden");
});
clearKeyBtn.addEventListener("click", () => {
  clearApiKey();
  refreshKeyStatus();
});

/* ---------------- Units dropdown ---------------- */
UNITS.filter((u) => u.id !== "general").forEach((u) => {
  const opt = document.createElement("option");
  opt.value = u.id;
  opt.textContent = u.name;
  unitSelect.appendChild(opt);
});

/* ---------------- File picking ---------------- */
chooseFileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    alert("That file is larger than 15MB \u2014 try a smaller photo or a lower-resolution scan.");
    fileInput.value = ""; return;
  }
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) {
    alert("Please upload an image (photo/screenshot) or a PDF of your homework.");
    fileInput.value = ""; return;
  }
  const base64 = await fileToBase64(file);
  pendingFile = { base64, mediaType: file.type, name: file.name };
  fileNameLabel.textContent = file.name;
});
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- Setup submit ---------------- */
setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!getApiKey()) { alert("Set your API key in Settings first."); openSettings(); return; }

  const typedText = problemTextArea.value.trim();
  const chosenUnit = unitSelect.value;
  if (!typedText && !pendingFile) { alert("Type the problem or upload a file."); return; }
  if (!chosenUnit && !pendingFile) { alert("Pick a unit, or upload a file so the tutor can detect it."); return; }

  const submitBtn = setupForm.querySelector(".primary-btn");
  submitBtn.disabled = true;
  submitBtn.textContent = pendingFile ? "Reading your file..." : "Setting up...";

  try {
    if (pendingFile) {
      const data = await parseFileWithHaiku(pendingFile.base64, pendingFile.mediaType, chosenUnit || undefined);
      unitId = data.unitId;
      problemText = data.problemText;
    } else {
      unitId = chosenUnit;
      problemText = typedText;
    }
    unitName = getUnit(unitId).name;
    startTutorScreen();
    updateUsageFooter();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Begin tutoring session";
  }
});

/* ---------------- Tutor screen ---------------- */
function startTutorScreen() {
  setupScreen.classList.add("hidden");
  tutorScreen.classList.remove("hidden");
  newProblemBtn.classList.remove("hidden");
  attempts = []; attemptNumber = 0;
  chatLog.innerHTML = "";
  messageInput.disabled = false;
  sendBtn.disabled = false;

  ladderUnitName.textContent = unitName;
  renderLadder(0);
  addBubble("assistant", `Got it \u2014 this looks like a ${unitName} problem:\n\n"${problemText}"\n\nGive me your best attempt with your reasoning, and I'll help from there.`, "free");
}

function renderLadder(tier) {
  ladderRail.innerHTML = "";
  TIER_NAMES.forEach((name, i) => {
    const li = document.createElement("li");
    let status = "pending";
    if (i < tier) status = "done";
    else if (i === tier) status = "active";
    li.className = status;
    li.innerHTML = `
      <span class="rung-dot">${status === "done" ? "\u2713" : i}</span>
      <span class="rung-title">${i === 0 ? "Start" : "Tier " + i} \u00b7 ${name}</span>
      <p class="rung-desc">${status === "pending" ? "Not there yet." : status === "active" ? "You're here now." : "Cleared."}</p>`;
    ladderRail.appendChild(li);
  });
}

function addBubble(role, text, costLabel) {
  const row = document.createElement("div");
  row.className = `bubble-row ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  if (costLabel) {
    const tag = document.createElement("span");
    const cls = costLabel.includes("heavy") || costLabel.includes(SONNET_MODEL) ? "heavy" : costLabel.includes("free") ? "free" : "cheap";
    tag.className = `cost-tag ${cls}`;
    tag.textContent = costLabel === "free" ? "\u2713 free" : costLabel;
    row.appendChild(tag);
  }
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
  return row;
}

function addTypingIndicator() {
  const row = document.createElement("div");
  row.className = "bubble-row assistant";
  row.id = "typingRow";
  row.innerHTML = `<div class="bubble"><span class="typing-indicator"><span></span><span></span><span></span></span></div>`;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}
function removeTypingIndicator() { document.getElementById("typingRow")?.remove(); }

function addErrorBubble(text) {
  const row = document.createElement("div");
  row.className = "bubble-row assistant error-bubble";
  row.innerHTML = `<div class="bubble">${text}</div>`;
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* ---------------- Composer ---------------- */
composerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSending) return;
  const text = messageInput.value.trim();
  if (!text || attemptNumber >= 5) return;
  if (!getApiKey()) { alert("Set your API key in Settings first."); openSettings(); return; }

  attempts.push(text);
  attemptNumber += 1;
  addBubble("user", text);
  messageInput.value = "";
  autoResize();

  isSending = true;
  sendBtn.disabled = true;
  addTypingIndicator();

  try {
    const unitObj = getUnit(unitId);
    let result;
    if (attemptNumber <= 4) {
      const template = unitObj.tiers[attemptNumber - 1];
      const { text: hintText, cost } = await personalizeHint(attemptNumber, template, problemText, text);
      result = { tier: attemptNumber, text: hintText, cost };
    } else {
      const { text: finalText, cost } = await buildTier5Response(unitObj, problemText, attempts);
      result = { tier: 5, text: finalText, cost };
    }
    removeTypingIndicator();
    addBubble("assistant", result.text, result.cost);
    renderLadder(result.tier);
    if (result.tier >= 5) {
      messageInput.disabled = true;
      sendBtn.disabled = true;
      addBubble("assistant", "That's the full solution \u2014 start a new problem whenever you're ready.", "free");
    }
    updateUsageFooter();
  } catch (err) {
    removeTypingIndicator();
    addErrorBubble(err.message || "Something went wrong. Check your API key in Settings and try again.");
  }

  isSending = false;
  if (attemptNumber < 5) sendBtn.disabled = false;
});

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
}
messageInput.addEventListener("input", autoResize);
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composerForm.requestSubmit(); }
});

/* ---------------- New problem ---------------- */
newProblemBtn.addEventListener("click", () => {
  if (attemptNumber > 0 && attemptNumber < 5) {
    if (!confirm("Start a new problem? This clears the current conversation.")) return;
  }
  unitId = null; unitName = ""; problemText = ""; attempts = []; attemptNumber = 0;
  pendingFile = null;
  fileInput.value = "";
  fileNameLabel.textContent = "No file chosen";
  problemTextArea.value = "";
  unitSelect.value = "";
  tutorScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  newProblemBtn.classList.add("hidden");
});

/* ---------------- Usage footer ---------------- */
function updateUsageFooter() {
  const usage = getUsage();
  usageFooter.textContent = `Today's AI calls (this browser) \u2014 light: ${usage.haiku || 0} \u00b7 heavy: ${usage.sonnet || 0}`;
}

/* ---------------- Boot ---------------- */
refreshKeyStatus();
updateUsageFooter();
if (!getApiKey()) openSettings();
