/**
 * app.js – Part Scrapper main application logic
 */

/* ======================================================================
   STATE
   ====================================================================== */
const state = {
  currentView: 'home',        // 'home' | 'job' | 'history'
  currentJob: null,           // { jobId, timestamp, items[] }
  editingItemIndex: null,     // index into currentJob.items (null = new)
  scanner: null,              // Html5QrcodeScanner instance
  scanStep: 'part',           // 'part' | 'snum'
  scanData: {                 // accumulated scan data before modal
    partNumber: '',
    sNumber: '',
  },
  beepCtx: null,              // AudioContext for beep
};

/* ======================================================================
   HELPERS
   ====================================================================== */
function generateJobId() {
  return 'job_' + Date.now();
}

function formatTimestamp(isoOrMs) {
  const d = new Date(isoOrMs);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds())
  );
}

function formatDisplayDate(ts) {
  const d = new Date(ts.replace(' ', 'T'));
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function playBeep() {
  try {
    if (!state.beepCtx) {
      state.beepCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = state.beepCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    // Audio not available – ignore
  }
}

/* ======================================================================
   VIEW NAVIGATION
   ====================================================================== */
function showView(viewName) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');
  state.currentView = viewName;
}

/* ======================================================================
   HOME VIEW
   ====================================================================== */
async function renderHome() {
  showView('home');
  try {
    const count = await db.getJobCount();
    document.getElementById('stat-jobs').textContent = count;
    if (state.currentJob) {
      document.getElementById('stat-items').textContent =
        state.currentJob.items.length;
    } else {
      document.getElementById('stat-items').textContent = '–';
    }
  } catch (e) {
    console.error('renderHome', e);
  }

  // Show "Resume" button when a job is loaded in memory
  const resumeBtn = document.getElementById('resume-job-btn');
  if (resumeBtn) {
    resumeBtn.style.display = state.currentJob ? '' : 'none';
  }
}

async function startNewJob() {
  const jobId = generateJobId();
  const ts = formatTimestamp(Date.now());
  state.currentJob = { jobId, timestamp: ts, items: [] };
  await db.saveJob(state.currentJob);
  renderJobView();
}

/* ======================================================================
   JOB VIEW
   ====================================================================== */
function renderJobView() {
  showView('job');
  const job = state.currentJob;
  if (!job) { renderHome(); return; }

  document.getElementById('job-title').textContent =
    'Job: ' + formatDisplayDate(job.timestamp);
  renderItemsTable();
}

function renderItemsTable() {
  const job = state.currentJob;
  const tbody = document.getElementById('items-tbody');
  const emptyState = document.getElementById('items-empty');
  const table = document.getElementById('items-table');
  const countBadge = document.getElementById('item-count-badge');

  countBadge.textContent = job.items.length + ' item' + (job.items.length !== 1 ? 's' : '');

  if (job.items.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    table.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  table.classList.remove('hidden');
  tbody.innerHTML = job.items.map((item, i) => `
    <tr>
      <td class="part-num">${escHtml(item.partNumber || '—')}</td>
      <td class="s-num">${escHtml(item.sNumber || '—')}</td>
      <td><span class="qty-badge">${escHtml(String(item.quantity))}</span></td>
      <td class="actions-cell">
        <button class="btn-edit" title="Edit" onclick="openEditModal(${i})">✏️</button>
        <button class="btn-del" title="Delete" onclick="confirmDeleteItem(${i})">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ======================================================================
   SCANNER
   ====================================================================== */
function openScanner() {
  state.scanStep = 'part';
  state.scanData = { partNumber: '', sNumber: '' };
  updateScannerUI();
  document.getElementById('scanner-overlay').classList.remove('hidden');
  startScanner();
}

function updateScannerUI() {
  const stepEl = document.getElementById('scan-step-label');
  if (state.scanStep === 'part') {
    stepEl.textContent = '📦 Scan Part Number barcode';
  } else {
    stepEl.textContent = '🔍 Scan S-Number barcode';
  }
}

function startScanner() {
  // Stop any existing instance
  if (state.scanner) {
    state.scanner.stop()
      .catch(() => {})
      .finally(() => {
        state.scanner.clear().catch(() => {});
        state.scanner = null;
        _doStartScanner();
      });
  } else {
    _doStartScanner();
  }
}

function _doStartScanner() {
  state.scanner = new Html5Qrcode('reader', { verbose: false });

  const scanConfig = {
    fps: 15,
    qrbox: { width: 260, height: 130 },
    aspectRatio: 1.777,
  };

  state.scanner.start(
    { facingMode: { ideal: 'environment' } },
    scanConfig,
    onScanSuccess,
    onScanError
  ).catch((err) => {
    console.error('Scanner start error:', err);
    showToast('Camera unavailable. Check permissions.', 'error');
    closeScanner();
  });
}

function onScanSuccess(decodedText) {
  playBeep();

  // Flash effect
  const flash = document.createElement('div');
  flash.className = 'scan-flash';
  document.getElementById('scanner-container').appendChild(flash);
  setTimeout(() => flash.remove(), 400);

  // Pause scanning while processing
  if (state.scanner) {
    try { state.scanner.pause(true); } catch (e) { /* ignore */ }
  }

  if (state.scanStep === 'part') {
    state.scanData.partNumber = decodedText.trim();
    state.scanStep = 'snum';
    updateScannerUI();
    showToast('Part # scanned! Now scan S-Number…', 'info');
    // Resume scanner for next barcode after a short delay
    setTimeout(() => {
      if (state.scanner) {
        try { state.scanner.resume(); } catch (e) { /* ignore */ }
      }
    }, 600);
  } else {
    state.scanData.sNumber = decodedText.trim();
    closeScanner();
    openItemModal(state.scanData.partNumber, state.scanData.sNumber);
  }
}

function onScanError() {
  // Continuous errors from no-barcode frames – ignore
}

function closeScanner() {
  const overlay = document.getElementById('scanner-overlay');
  overlay.classList.add('hidden');
  if (state.scanner) {
    const s = state.scanner;
    state.scanner = null;
    s.stop()
      .catch(() => {})
      .finally(() => { s.clear().catch(() => {}); });
  }
}

function skipScanStep() {
  if (state.scanStep === 'part') {
    state.scanData.partNumber = '';
    state.scanStep = 'snum';
    updateScannerUI();
    showToast('Part # skipped. Scan S-Number…', '');
  } else {
    state.scanData.sNumber = '';
    closeScanner();
    openItemModal(state.scanData.partNumber, state.scanData.sNumber);
  }
}

/* ======================================================================
   ITEM EDIT MODAL
   ====================================================================== */
function openItemModal(partNumber, sNumber, editIndex) {
  state.editingItemIndex = (editIndex !== undefined) ? editIndex : null;

  const isEdit = editIndex !== undefined;
  const item = isEdit ? state.currentJob.items[editIndex] : null;

  document.getElementById('item-modal-title').textContent =
    isEdit ? '✏️ Edit Item' : '➕ Add Item';
  document.getElementById('item-modal-subtitle').textContent =
    isEdit ? 'Update the details below and tap Save.' :
             'Review and edit the scanned data, then tap Add to List.';

  const pn = isEdit ? item.partNumber : (partNumber || '');
  const sn = isEdit ? item.sNumber : (sNumber || '');
  const qty = isEdit ? item.quantity : 1;

  document.getElementById('modal-part-number').value = pn;
  document.getElementById('modal-s-number').value = sn;
  document.getElementById('modal-quantity').value = qty;

  // Show scanned preview badges
  const pnBadge = document.getElementById('pn-scanned-badge');
  const snBadge = document.getElementById('sn-scanned-badge');
  if (!isEdit && partNumber) {
    pnBadge.classList.remove('hidden');
  } else {
    pnBadge.classList.add('hidden');
  }
  if (!isEdit && sNumber) {
    snBadge.classList.remove('hidden');
  } else {
    snBadge.classList.add('hidden');
  }

  document.getElementById('item-modal-submit-btn').textContent =
    isEdit ? '💾 Save Changes' : '✅ Add to List';

  document.getElementById('item-modal-overlay').classList.remove('hidden');
  // Focus quantity field for quick entry
  setTimeout(() => {
    document.getElementById('modal-quantity').focus();
    document.getElementById('modal-quantity').select();
  }, 150);
}

function closeItemModal() {
  document.getElementById('item-modal-overlay').classList.add('hidden');
  state.editingItemIndex = null;
}

async function submitItemModal() {
  const partNumber = document.getElementById('modal-part-number').value.trim();
  const sNumber = document.getElementById('modal-s-number').value.trim();
  const quantityRaw = document.getElementById('modal-quantity').value;
  const quantity = parseInt(quantityRaw, 10);

  if (!partNumber && !sNumber) {
    showToast('Enter at least a Part # or S-Number.', 'error');
    return;
  }

  if (isNaN(quantity) || quantity < 1) {
    showToast('Quantity must be at least 1.', 'error');
    document.getElementById('modal-quantity').focus();
    return;
  }

  const item = { partNumber, sNumber, quantity };

  if (state.editingItemIndex !== null) {
    state.currentJob.items[state.editingItemIndex] = item;
    showToast('Item updated.', 'success');
  } else {
    state.currentJob.items.push(item);
    showToast('Item added to list!', 'success');
  }

  try {
    await db.saveJob(state.currentJob);
  } catch (e) {
    console.error('saveJob error', e);
    showToast('Failed to save – please try again.', 'error');
    return;
  }

  closeItemModal();
  renderItemsTable();
}

/* ======================================================================
   EDIT / DELETE FROM TABLE
   ====================================================================== */
function openEditModal(index) {
  openItemModal('', '', index);
}

function confirmDeleteItem(index) {
  const item = state.currentJob.items[index];
  const label = item.partNumber || item.sNumber || 'this item';
  document.getElementById('confirm-item-label').textContent = label;
  document.getElementById('confirm-delete-btn').onclick = () => deleteItem(index);
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

async function deleteItem(index) {
  state.currentJob.items.splice(index, 1);
  await db.saveJob(state.currentJob);
  closeConfirm();
  renderItemsTable();
  showToast('Item deleted.', '');
}

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
}

/* ======================================================================
   EXPORT
   ====================================================================== */
function buildCSV(job) {
  const rows = ['Part Number,S-Number,Quantity'];
  for (const item of job.items) {
    const pn = (item.partNumber || '').replace(/"/g, '""');
    const sn = (item.sNumber || '').replace(/"/g, '""');
    const qty = item.quantity;
    rows.push(`"${pn}","${sn}",${qty}`);
  }
  return rows.join('\n');
}

async function exportJob() {
  const job = state.currentJob;
  if (!job || job.items.length === 0) {
    showToast('No items to export.', 'error');
    return;
  }

  const csv = buildCSV(job);
  const filename = `parts-${job.jobId}.csv`;

  // Try Web Share API first (best on mobile)
  if (navigator.canShare) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], filename, { type: 'text/csv' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Parts List',
          text: `Parts list from ${job.timestamp}`,
        });
        return;
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.warn('Web Share API failed, falling back', e);
        } else {
          return; // User cancelled
        }
      }
    }
  }

  // Fallback: download file
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded.', 'success');
}

/* ======================================================================
   HISTORY VIEW
   ====================================================================== */
async function renderHistory() {
  showView('history');
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const jobs = await db.getAllJobs();
    if (jobs.length === 0) {
      container.innerHTML = `
        <div class="history-empty">
          <div class="empty-state-icon">📂</div>
          <h3>No history yet</h3>
          <p>Completed jobs will appear here.</p>
        </div>`;
      return;
    }

    container.innerHTML = jobs.map((job) => {
      const totalQty = job.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
      return `
        <div class="job-card" onclick="loadJob('${escHtml(job.jobId)}')">
          <div class="job-card-header">
            <span class="job-card-title">📋 Job</span>
            <span class="job-card-date">${escHtml(formatDisplayDate(job.timestamp))}</span>
          </div>
          <div class="job-card-meta">
            <span class="job-card-stat"><strong>${job.items.length}</strong> items</span>
            <span class="job-card-stat"><strong>${totalQty}</strong> total qty</span>
          </div>
          <div class="job-card-actions">
            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); loadJob('${escHtml(job.jobId)}')">
              📂 Open
            </button>
            <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation(); exportJobById('${escHtml(job.jobId)}')">
              📤 Export
            </button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); confirmDeleteJob('${escHtml(job.jobId)}')">
              🗑️ Delete
            </button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('renderHistory', e);
    container.innerHTML = '<p class="text-muted text-center mt-2">Failed to load history.</p>';
  }
}

async function loadJob(jobId) {
  const job = await db.getJob(jobId);
  if (!job) { showToast('Job not found.', 'error'); return; }
  state.currentJob = job;
  renderJobView();
}

async function exportJobById(jobId) {
  const prevJob = state.currentJob;
  const job = await db.getJob(jobId);
  if (!job) return;
  state.currentJob = job;
  await exportJob();
  state.currentJob = prevJob;
}

function confirmDeleteJob(jobId) {
  document.getElementById('confirm-item-label').textContent = 'this job and all its items';
  document.getElementById('confirm-delete-btn').onclick = () => deleteJob(jobId);
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

async function deleteJob(jobId) {
  await db.deleteJob(jobId);
  closeConfirm();
  if (state.currentJob && state.currentJob.jobId === jobId) {
    state.currentJob = null;
  }
  showToast('Job deleted.', '');
  renderHistory();
}

/* ======================================================================
   BACK NAVIGATION
   ====================================================================== */
function goBack() {
  if (state.currentView === 'job') {
    renderHome();
  } else if (state.currentView === 'history') {
    renderHome();
  }
}

/* ======================================================================
   PWA INSTALL PROMPT
   ====================================================================== */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.add('hidden');
  showToast('App installed!', 'success');
});

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') showToast('Installing…', 'info');
  deferredInstallPrompt = null;
}

/* ======================================================================
   KEYBOARD SHORTCUTS
   ====================================================================== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!document.getElementById('scanner-overlay').classList.contains('hidden')) {
      closeScanner();
    } else if (!document.getElementById('item-modal-overlay').classList.contains('hidden')) {
      closeItemModal();
    } else if (!document.getElementById('confirm-overlay').classList.contains('hidden')) {
      closeConfirm();
    }
  }
});

/* ======================================================================
   SERVICE WORKER REGISTRATION
   ====================================================================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

/* ======================================================================
   APP INIT
   ====================================================================== */
async function initApp() {
  try {
    await db.init();
  } catch (e) {
    console.error('DB init failed', e);
    showToast('Storage unavailable. Some features may not work.', 'error');
  }
  renderHome();
}

document.addEventListener('DOMContentLoaded', initApp);
