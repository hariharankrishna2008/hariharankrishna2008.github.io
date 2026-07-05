const state = {
  sessionId: null,
  attemptCount: 0,
  currentTier: 0,
  tier5Revealed: false,
  canRevealAnswer: false,
  selectedFile: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elements = {
  uploadZone: $('#uploadZone'),
  fileInput: $('#fileInput'),
  browseBtn: $('#browseBtn'),
  clearFile: $('#clearFile'),
  filePreview: $('#filePreview'),
  fileName: $('#fileName'),
  problemText: $('#problemText'),
  loadProblemBtn: $('#loadProblemBtn'),
  submitAttemptBtn: $('#submitAttemptBtn'),
  studentAnswer: $('#studentAnswer'),
  studentReasoning: $('#studentReasoning'),
  chatMessages: $('#chatMessages'),
  attemptCount: $('#attemptCount'),
  currentTier: $('#currentTier'),
  tierList: $('#tierList'),
  revealBtn: $('#revealBtn'),
  newSessionBtn: $('#newSessionBtn'),
  classificationCard: $('#classificationCard'),
  classificationDetails: $('#classificationDetails'),
  toast: $('#toast'),
  loadingOverlay: $('#loadingOverlay'),
  loadingText: $('#loadingText')
};

function showLoading(text = 'Processing…') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  elements.loadingOverlay.classList.add('hidden');
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', isError);
  elements.toast.classList.remove('hidden');
  setTimeout(() => elements.toast.classList.add('hidden'), 4000);
}

function updateUI() {
  elements.attemptCount.textContent = `${state.attemptCount} / 5`;
  elements.currentTier.textContent = state.currentTier > 0 ? `Tier ${state.currentTier}` : '—';

  $$('.tier-item').forEach((item) => {
    const tier = Number(item.dataset.tier);
    item.classList.toggle('active', tier === state.currentTier);
    item.classList.toggle('completed', tier < state.currentTier);
  });

  elements.revealBtn.disabled = !state.canRevealAnswer;
  elements.submitAttemptBtn.disabled = !state.sessionId || state.attemptCount >= 5;
  elements.studentAnswer.disabled = !state.sessionId || state.attemptCount >= 5;
  elements.studentReasoning.disabled = !state.sessionId || state.attemptCount >= 5;
}

function scrollChatToBottom() {
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function addMessage(type, html) {
  const div = document.createElement('div');
  div.className = `message message-${type}`;
  div.innerHTML = html;
  elements.chatMessages.appendChild(div);
  scrollChatToBottom();
}

function formatHintMessage(hint, analysis) {
  const tierClass = `tier-${hint.tier}`;
  let html = `
    <div class="message-avatar">${hint.tier === 5 ? '🎯' : '💡'}</div>
    <div class="message-body">
      <span class="hint-badge ${tierClass}">Tier ${hint.tier}</span>
      <div class="hint-title">${escapeHtml(hint.title)}</div>
      <p>${escapeHtml(hint.content)}</p>
  `;

  if (analysis) {
    const tagClass = analysis.isCorrect ? 'correct' : 'incorrect';
    const tagText = analysis.isCorrect ? 'On track' : 'Keep trying';
    html += `
      <div class="message-meta">
        <span class="feedback-tag ${tagClass}">${tagText}</span>
        ${escapeHtml(analysis.feedback)}
      </div>
    `;
  }

  if (hint.tier === 5) {
    if (hint.correctAnswer) {
      html += `<div class="correct-answer">Answer: ${escapeHtml(hint.correctAnswer)}</div>`;
    }

    if (hint.reasoningComparison) {
      const rc = hint.reasoningComparison;
      html += `<div class="comparison-block">
        <h4>Reasoning Comparison</h4>`;

      if (rc.studentStrengths?.length) {
        html += `<p><strong>Strengths:</strong></p><ul>${rc.studentStrengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
      }
      if (rc.studentGaps?.length) {
        html += `<p><strong>Gaps:</strong></p><ul>${rc.studentGaps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
      }
      if (rc.improvementTips?.length) {
        html += `<p><strong>Tips:</strong></p><ul>${rc.improvementTips.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`;
      }
      html += `</div>`;
    }

    if (hint.source === 'cache') {
      html += `<div class="message-meta">Solution retrieved from cache (no API cost)</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showClassification(classification) {
  elements.classificationCard.classList.remove('hidden');
  elements.classificationDetails.innerHTML = `
    <dt>Unit</dt>
    <dd>Unit ${classification.unitId}: ${escapeHtml(classification.unitName)}</dd>
    <dt>Problem Type</dt>
    <dd>${escapeHtml(classification.problemType)}</dd>
    <dt>Summary</dt>
    <dd>${escapeHtml(classification.problemSummary)}</dd>
    <dt>Variables</dt>
    <dd>${(classification.variables || []).map(escapeHtml).join(', ') || '—'}</dd>
    <dt>Unknowns</dt>
    <dd>${(classification.unknowns || []).map(escapeHtml).join(', ') || '—'}</dd>
  `;
}

async function loadProblem() {
  const text = elements.problemText.value.trim();

  if (!text && !state.selectedFile) {
    showToast('Enter problem text or upload a file.', true);
    return;
  }

  showLoading('Classifying problem…');

  try {
    const formData = new FormData();
    if (text) formData.append('text', text);
    if (state.selectedFile) formData.append('file', state.selectedFile);

    const res = await fetch('/api/problem', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load problem');

    state.sessionId = data.sessionId;
    state.attemptCount = 0;
    state.currentTier = 0;
    state.tier5Revealed = false;
    state.canRevealAnswer = false;

    showClassification(data.classification);

    addMessage('system', `
      <div class="message-avatar">⚛</div>
      <div class="message-body">
        <p><strong>Problem loaded!</strong></p>
        <p>${escapeHtml(data.problemText.substring(0, 300))}${data.problemText.length > 300 ? '…' : ''}</p>
        <div class="message-meta">Classified as Unit ${data.classification.unitId}: ${escapeHtml(data.classification.unitName)}</div>
        <p style="margin-top:0.5rem">Submit your first attempt to unlock Tier 1 hints.</p>
      </div>
    `);

    elements.studentAnswer.disabled = false;
    elements.studentReasoning.disabled = false;
    elements.submitAttemptBtn.disabled = false;
    updateUI();
    showToast('Problem loaded — start your first attempt!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    hideLoading();
  }
}

async function submitAttempt() {
  const answer = elements.studentAnswer.value.trim();
  const reasoning = elements.studentReasoning.value.trim();

  if (!answer && !reasoning) {
    showToast('Provide an answer or your reasoning.', true);
    return;
  }

  showLoading(`Analyzing attempt ${state.attemptCount + 1}…`);

  addMessage('user', `
    <div class="message-avatar">📝</div>
    <div class="message-body">
      ${answer ? `<p><strong>Answer:</strong> ${escapeHtml(answer)}</p>` : ''}
      ${reasoning ? `<p><strong>Reasoning:</strong> ${escapeHtml(reasoning)}</p>` : ''}
      <div class="message-meta">Attempt ${state.attemptCount + 1}</div>
    </div>
  `);

  try {
    const res = await fetch('/api/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, answer, reasoning })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit attempt');

    state.attemptCount = data.attemptNumber;
    state.currentTier = data.currentTier;
    state.tier5Revealed = data.tier5Revealed;
    state.canRevealAnswer = data.canRevealAnswer;

    const hintDiv = document.createElement('div');
    hintDiv.className = 'message message-system';
    hintDiv.innerHTML = formatHintMessage(data.hint, data.analysis);
    elements.chatMessages.appendChild(hintDiv);
    scrollChatToBottom();

    elements.studentAnswer.value = '';
    elements.studentReasoning.value = '';
    updateUI();

    if (data.hint.tier === 5) {
      showToast(state.tier5Revealed ? 'Full solution revealed!' : 'Tier 5 unlocked!');
    } else {
      showToast(`Tier ${data.hint.tier} hint unlocked`);
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    hideLoading();
  }
}

async function revealAnswer() {
  if (!state.canRevealAnswer) return;

  showLoading('Retrieving full solution…');

  try {
    const res = await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reveal answer');

    const sol = data.tier5Solution;
    const hint = {
      tier: 5,
      title: 'Tier 5 — Full Solution + Reasoning Comparison',
      content: sol.fullSolution,
      correctAnswer: sol.correctAnswer,
      reasoningComparison: sol.reasoningComparison,
      source: data.fromCache ? 'cache' : 'model'
    };

    const hintDiv = document.createElement('div');
    hintDiv.className = 'message message-system';
    hintDiv.innerHTML = formatHintMessage(hint, null);
    elements.chatMessages.appendChild(hintDiv);
    scrollChatToBottom();

    showToast(data.fromCache ? 'Solution loaded from cache' : 'Full solution revealed');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    hideLoading();
  }
}

function resetSession() {
  state.sessionId = null;
  state.attemptCount = 0;
  state.currentTier = 0;
  state.tier5Revealed = false;
  state.canRevealAnswer = false;

  elements.chatMessages.innerHTML = `
    <div class="message message-system">
      <div class="message-avatar">⚛</div>
      <div class="message-body">
        <p>Welcome! Load a physics problem to begin. You'll get progressively stronger hints with each attempt — the full solution unlocks at Tier 5.</p>
      </div>
    </div>
  `;

  elements.classificationCard.classList.add('hidden');
  elements.studentAnswer.value = '';
  elements.studentReasoning.value = '';
  elements.studentAnswer.disabled = true;
  elements.studentReasoning.disabled = true;
  updateUI();
}

function setupFileUpload() {
  elements.browseBtn.addEventListener('click', () => elements.fileInput.click());

  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setSelectedFile(file);
  });

  elements.clearFile.addEventListener('click', () => {
    state.selectedFile = null;
    elements.fileInput.value = '';
    elements.filePreview.classList.add('hidden');
  });

  elements.uploadZone.addEventListener('click', () => elements.fileInput.click());

  elements.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.add('dragover');
  });

  elements.uploadZone.addEventListener('dragleave', () => {
    elements.uploadZone.classList.remove('dragover');
  });

  elements.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  });
}

function setSelectedFile(file) {
  state.selectedFile = file;
  elements.fileName.textContent = file.name;
  elements.filePreview.classList.remove('hidden');
}

elements.loadProblemBtn.addEventListener('click', loadProblem);
elements.submitAttemptBtn.addEventListener('click', submitAttempt);
elements.revealBtn.addEventListener('click', revealAnswer);
elements.newSessionBtn.addEventListener('click', resetSession);

elements.studentReasoning.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) submitAttempt();
});

setupFileUpload();
updateUI();
