/**
 * Kesem Records — Inline Visual Editor
 * Activate: Ctrl+E or add ?edit to URL
 * Saves directly to GitHub → triggers Netlify rebuild
 */
(function () {
  'use strict';

  const REPO = 'Avichay1977/kesem-records';
  const BRANCH = 'master';
  const TOKEN_KEY = 'kesem_gh_token';
  const API = 'https://api.github.com';

  let editMode = false;
  let activePanel = null;
  let fileCache = {};

  // ── Helpers ──

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getByPath(obj, path) {
    return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
  }

  function setByPath(obj, path, value) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let curr = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = isNaN(keys[i]) ? keys[i] : Number(keys[i]);
      curr = curr[k];
    }
    const last = isNaN(keys[keys.length - 1]) ? keys[keys.length - 1] : Number(keys[keys.length - 1]);
    curr[last] = value;
  }

  // ── GitHub API ──

  async function fetchFile(fileName) {
    if (fileCache[fileName]) return fileCache[fileName];
    const token = getToken();
    const res = await fetch(`${API}/repos/${REPO}/contents/src/data/${fileName}.json?ref=${BRANCH}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(`Failed to fetch ${fileName}.json (${res.status})`);
    const data = await res.json();
    fileCache[fileName] = { content: JSON.parse(atob(data.content)), sha: data.sha };
    return fileCache[fileName];
  }

  async function saveFile(fileName, content, sha, path) {
    const token = getToken();
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + '\n')));
    const res = await fetch(`${API}/repos/${REPO}/contents/src/data/${fileName}.json`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Edit ${fileName}: ${path}`,
        content: encoded,
        sha: sha,
        branch: BRANCH
      })
    });
    if (!res.ok) {
      if (res.status === 409) throw new Error('Conflict — someone else edited this file. Refresh and try again.');
      throw new Error(`Save failed (${res.status})`);
    }
    const result = await res.json();
    fileCache[fileName] = { content, sha: result.content.sha };
    return result;
  }

  // ── Toast ──

  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'ke-toast ke-toast--' + (type || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('ke-toast--visible'));
    setTimeout(() => {
      el.classList.remove('ke-toast--visible');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ── Auth Modal ──

  function showAuthModal() {
    const overlay = document.createElement('div');
    overlay.className = 'ke-overlay';
    overlay.innerHTML = `
      <div class="ke-modal">
        <h3>EDIT MODE</h3>
        <p>Enter your GitHub Personal Access Token<br><small>(needs 'repo' scope)</small></p>
        <input type="password" class="ke-input" placeholder="ghp_..." autofocus />
        <div class="ke-modal-actions">
          <button class="ke-btn ke-btn--save">Connect</button>
          <button class="ke-btn ke-btn--cancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('ke-overlay--visible'));

    const input = overlay.querySelector('input');
    const save = overlay.querySelector('.ke-btn--save');
    const cancel = overlay.querySelector('.ke-btn--cancel');

    function close() {
      overlay.classList.remove('ke-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
    }

    save.addEventListener('click', () => {
      const token = input.value.trim();
      if (!token) return;
      localStorage.setItem(TOKEN_KEY, token);
      close();
      activateEditMode();
    });

    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  }

  // ── Editor Panel ──

  function openEditor(el) {
    closeEditor();
    const file = el.dataset.file;
    const path = el.dataset.path;
    const isHtml = el.dataset.html === 'true';
    const currentText = isHtml ? el.innerHTML.trim() : el.textContent.trim();

    const panel = document.createElement('div');
    panel.className = 'ke-panel';

    const label = path.split('.').pop().replace(/\[\d+\]/, '');
    const isLong = currentText.length > 80 || isHtml;

    panel.innerHTML = `
      <div class="ke-panel-header">
        <span class="ke-panel-label">${label}</span>
        <span class="ke-panel-file">${file}.json</span>
      </div>
      ${isLong
        ? `<textarea class="ke-input ke-textarea">${escapeHtml(currentText)}</textarea>`
        : `<input class="ke-input" type="text" value="${escapeAttr(currentText)}" />`
      }
      <div class="ke-panel-actions">
        <button class="ke-btn ke-btn--save">Save</button>
        <button class="ke-btn ke-btn--cancel">Cancel</button>
      </div>
      <div class="ke-panel-status"></div>
    `;

    // Position near element
    const rect = el.getBoundingClientRect();
    panel.style.top = (window.scrollY + rect.bottom + 8) + 'px';
    panel.style.left = Math.max(8, rect.left) + 'px';

    document.body.appendChild(panel);
    requestAnimationFrame(() => panel.classList.add('ke-panel--visible'));
    activePanel = panel;

    el.classList.add('ke-editing');

    const input = panel.querySelector('.ke-input');
    const status = panel.querySelector('.ke-panel-status');
    input.focus();
    if (input.tagName === 'INPUT') input.select();

    panel.querySelector('.ke-btn--save').addEventListener('click', async () => {
      const newValue = input.value;
      if (newValue === currentText) { closeEditor(); return; }

      status.textContent = 'Saving...';
      status.className = 'ke-panel-status ke-panel-status--saving';

      try {
        const fileData = await fetchFile(file);
        setByPath(fileData.content, path, newValue);
        await saveFile(file, fileData.content, fileData.sha, path);

        // Optimistic DOM update
        if (isHtml) {
          el.innerHTML = newValue;
        } else {
          el.textContent = newValue;
        }

        closeEditor();
        toast('Saved! Site will rebuild in ~1 min.', 'success');
      } catch (err) {
        status.textContent = err.message;
        status.className = 'ke-panel-status ke-panel-status--error';
        delete fileCache[file]; // Clear cache on error
      }
    });

    panel.querySelector('.ke-btn--cancel').addEventListener('click', closeEditor);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditor();
      if (e.key === 'Enter' && !e.shiftKey && input.tagName === 'INPUT') {
        e.preventDefault();
        panel.querySelector('.ke-btn--save').click();
      }
    });
  }

  function closeEditor() {
    if (activePanel) {
      activePanel.remove();
      activePanel = null;
    }
    document.querySelectorAll('.ke-editing').forEach(el => el.classList.remove('ke-editing'));
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Edit Mode ──

  function activateEditMode() {
    editMode = true;
    document.body.classList.add('ke-edit-mode');
    const editables = document.querySelectorAll('[data-editable]');
    editables.forEach(el => {
      el.addEventListener('click', onEditableClick);
    });
    toast('Edit mode ON — click any highlighted text to edit', 'success');
    updateToggleBtn();
  }

  function deactivateEditMode() {
    editMode = false;
    closeEditor();
    document.body.classList.remove('ke-edit-mode');
    document.querySelectorAll('[data-editable]').forEach(el => {
      el.removeEventListener('click', onEditableClick);
    });
    fileCache = {};
    toast('Edit mode OFF');
    updateToggleBtn();
  }

  function onEditableClick(e) {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    openEditor(e.currentTarget);
  }

  // ── Toggle Button ──

  let toggleBtn;

  function createToggleBtn() {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'ke-toggle';
    toggleBtn.setAttribute('aria-label', 'Toggle edit mode');
    updateToggleBtn();
    toggleBtn.addEventListener('click', () => {
      if (editMode) {
        deactivateEditMode();
      } else if (getToken()) {
        activateEditMode();
      } else {
        showAuthModal();
      }
    });
    document.body.appendChild(toggleBtn);
  }

  function updateToggleBtn() {
    if (!toggleBtn) return;
    toggleBtn.textContent = editMode ? 'EXIT' : 'EDIT';
    toggleBtn.classList.toggle('ke-toggle--active', editMode);
  }

  // ── Keyboard Shortcut ──

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      if (editMode) {
        deactivateEditMode();
      } else if (getToken()) {
        activateEditMode();
      } else {
        showAuthModal();
      }
    }
    if (e.key === 'Escape' && activePanel) {
      closeEditor();
    }
  });

  // ── Auto-activate from URL ──

  if (window.location.search.includes('edit')) {
    document.addEventListener('DOMContentLoaded', () => {
      if (getToken()) activateEditMode();
      else showAuthModal();
    });
  }

  // ── Init ──

  document.addEventListener('DOMContentLoaded', createToggleBtn);

  // ── Styles ──

  const style = document.createElement('style');
  style.textContent = `
    /* ── Edit Mode Highlights ── */
    .ke-edit-mode [data-editable] {
      cursor: pointer;
      transition: outline 0.15s ease, outline-offset 0.15s ease;
      outline: 2px dashed transparent;
      outline-offset: 3px;
    }
    .ke-edit-mode [data-editable]:hover {
      outline-color: var(--fg);
    }
    .ke-editing {
      outline-color: var(--fg) !important;
      outline-style: solid !important;
    }

    /* ── Toggle Button ── */
    .ke-toggle {
      position: fixed;
      bottom: 1.2rem;
      left: 1.2rem;
      z-index: 10001;
      background: var(--fg);
      color: var(--bg);
      border: 2px solid var(--border);
      padding: 0.5rem 0.7rem;
      font-family: var(--font);
      font-size: 0.55rem;
      cursor: pointer;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      transition: all 0.3s ease;
      line-height: 1;
    }
    .ke-toggle:hover { transform: scale(1.05); }
    .ke-toggle--active {
      background: #ef4444;
      color: #fff;
      border-color: #ef4444;
    }
    :root[data-theme="commodore"] .ke-toggle {
      background: #0a2e0a;
      color: #33bb33;
      border-color: #145214;
      font-size: 0.5rem;
      padding: 0.6rem 0.8rem;
    }
    :root[data-theme="commodore"] .ke-toggle--active {
      background: #660000;
      color: #ff6666;
      border-color: #660000;
    }

    /* ── Overlay & Modal ── */
    .ke-overlay {
      position: fixed;
      inset: 0;
      z-index: 10002;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .ke-overlay--visible { opacity: 1; }
    .ke-modal {
      background: var(--bg);
      border: 2px solid var(--fg);
      padding: 2rem;
      max-width: 380px;
      width: 90%;
      font-family: var(--font);
    }
    .ke-modal h3 {
      font-size: 0.85rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    .ke-modal p {
      font-size: 0.8rem;
      line-height: 1.6;
      color: var(--accent);
      margin-bottom: 1.2rem;
    }
    .ke-modal small {
      font-size: 0.65rem;
      opacity: 0.7;
    }

    /* ── Editor Panel ── */
    .ke-panel {
      position: absolute;
      z-index: 10002;
      background: var(--bg);
      border: 2px solid var(--fg);
      padding: 1rem;
      min-width: 280px;
      max-width: 520px;
      font-family: var(--font);
      box-shadow: 4px 4px 0 rgba(0,0,0,0.15);
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity 0.15s, transform 0.15s;
    }
    .ke-panel--visible { opacity: 1; transform: translateY(0); }
    .ke-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.6rem;
    }
    .ke-panel-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .ke-panel-file {
      font-size: 0.55rem;
      color: var(--accent);
      letter-spacing: 0.05em;
    }

    /* ── Inputs ── */
    .ke-input {
      width: 100%;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      padding: 0.5rem;
      font-family: var(--font);
      font-size: 0.8rem;
      line-height: 1.6;
      outline: none;
    }
    .ke-input:focus { border-color: var(--fg); }
    .ke-textarea { min-height: 100px; resize: vertical; }
    .ke-modal-actions, .ke-panel-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.8rem;
    }

    /* ── Buttons ── */
    .ke-btn {
      padding: 0.4rem 0.8rem;
      font-family: var(--font);
      font-size: 0.6rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      border: 1px solid var(--border);
      transition: all 0.15s;
    }
    .ke-btn--save {
      background: var(--fg);
      color: var(--bg);
      border-color: var(--fg);
    }
    .ke-btn--save:hover { opacity: 0.85; }
    .ke-btn--cancel {
      background: transparent;
      color: var(--accent);
    }
    .ke-btn--cancel:hover { border-color: var(--fg); color: var(--fg); }

    /* ── Status ── */
    .ke-panel-status {
      font-size: 0.6rem;
      margin-top: 0.5rem;
      letter-spacing: 0.05em;
      min-height: 1em;
    }
    .ke-panel-status--saving { color: var(--accent); }
    .ke-panel-status--error { color: #ef4444; }

    /* ── Toast ── */
    .ke-toast {
      position: fixed;
      bottom: 4rem;
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      z-index: 10003;
      background: var(--fg);
      color: var(--bg);
      padding: 0.6rem 1.2rem;
      font-family: var(--font);
      font-size: 0.65rem;
      letter-spacing: 0.06em;
      opacity: 0;
      transition: opacity 0.3s, transform 0.3s;
      white-space: nowrap;
    }
    .ke-toast--visible { opacity: 1; transform: translateX(-50%) translateY(0); }
    .ke-toast--success { background: #166534; color: #fff; }
    .ke-toast--error { background: #991b1b; color: #fff; }
    :root[data-theme="commodore"] .ke-toast { background: #0a2e0a; color: #33bb33; }
    :root[data-theme="commodore"] .ke-toast--success { background: #003300; color: #66ff66; }
  `;
  document.head.appendChild(style);
})();
