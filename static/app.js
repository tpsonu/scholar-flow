/**
 * OmniStudy (ScholarFlow) Main Application Controller
 * Coordinates views, state restoration after sudden window close, theme toggling, and notifications.
 */

import { initStorage, setupSuddenCloseProtection, getLastLiveSnapshot } from './modules/storage.js';
import { initNotesModule, renderSubjectTiles } from './modules/notes.js';
import { initVoiceModule } from './modules/voice-notes.js';
import { initPdfStudio } from './modules/pdf-studio.js';
import { initPassportModule, renderLiveCanvas } from './modules/passport.js';
import { initCalendarModule } from './modules/calendar.js';
import { initLearningModule, updateTimerFloatingVisibility } from './modules/learning.js';
import { initPartnersModule } from './modules/partners.js';
import { initCreatorsModule } from './modules/creators.js';
import { initSettingsModule } from './modules/settings.js';
import { initBrancherModule, renderBrancherView } from './modules/brancher.js';
import { initBitsModule, renderBitsView } from './modules/bits.js';

let activeViewId = 'view-dashboard';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize storage layer
  await initStorage();

  // Initialize theme
  initTheme();

  // Setup view routing
  setupNavigation();

  // Initialize Toast system
  const showToast = createToastNotifier();

  // Initialize modules
  initNotesModule(() => triggerAutoSaveIndicator(), showToast);
  initVoiceModule((newMemo) => showToast(`✓ Voice memo "${newMemo.title}" saved!`), showToast);
  initBrancherModule(showToast);
  initPdfStudio();
  initPassportModule(() => triggerAutoSaveIndicator());
  initCalendarModule(showToast);
  initLearningModule(showToast);
  initPartnersModule(showToast);
  initCreatorsModule(showToast);
  initSettingsModule(showToast);
  initBitsModule(showToast);

  // Setup sudden-close protection
  setupSuddenCloseProtection(collectCurrentLiveState);

  // Restore state from sudden close if available
  restoreLastSession(showToast);

  // Bind modal dismissal
  setupModals();

  // Dashboard quick resume button
  document.getElementById('quick-resume-btn')?.addEventListener('click', () => {
    switchView('view-notes');
  });
});

/**
 * Navigation View Switching
 */
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetView = item.dataset.view;
      switchView(targetView);
    });
  });
}

export function switchView(viewId) {
  activeViewId = viewId;

  // Update sidebar active classes
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    if (item.dataset.view === viewId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch visible panel
  document.querySelectorAll('.view-panel').forEach(panel => {
    if (panel.id === viewId) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  // Trigger sub-renderers if needed
  if (viewId === 'view-passport') {
    setTimeout(renderLiveCanvas, 50);
  }
  if (viewId === 'view-notes') {
    setTimeout(renderSubjectTiles, 10);
  }
  if (viewId === 'view-brancher') {
    setTimeout(renderBrancherView, 10);
  }
  if (viewId === 'view-bits') {
    setTimeout(renderBitsView, 10);
  }

  // Update persistent floating timer visibility across tabs
  updateTimerFloatingVisibility(viewId);

  // Update current view in session snapshot
  localStorage.setItem('omnistudy_active_view', viewId);
}

/**
 * Collect live snapshot of state for sudden close protection
 */
function collectCurrentLiveState() {
  return {
    activeView: activeViewId,
    activeNoteTitle: document.getElementById('note-edit-title')?.value || '',
    activeNoteContent: document.getElementById('note-edit-content')?.innerHTML || document.getElementById('note-edit-content')?.value || '',
    activeNoteCategory: document.getElementById('note-edit-category')?.value || '',
    passportWidth: document.getElementById('passport-width-input')?.value || '',
    passportHeight: document.getElementById('passport-height-input')?.value || '',
    passportKb: document.getElementById('passport-kb-input')?.value || '',
    timestamp: Date.now()
  };
}

/**
 * Rehydrate session after sudden browser close or refresh
 */
function restoreLastSession(showToast) {
  const snapshotObj = getLastLiveSnapshot();
  const savedActiveView = localStorage.getItem('omnistudy_active_view');

  if (snapshotObj && snapshotObj.data) {
    const d = snapshotObj.data;
    if (d.activeNoteTitle && document.getElementById('note-edit-title')) {
      document.getElementById('note-edit-title').value = d.activeNoteTitle;
    }
    if (d.activeNoteContent && document.getElementById('note-edit-content')) {
      const el = document.getElementById('note-edit-content');
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = d.activeNoteContent;
      else el.innerHTML = d.activeNoteContent;
    }
    if (d.passportWidth && document.getElementById('passport-width-input')) {
      document.getElementById('passport-width-input').value = d.passportWidth;
      document.getElementById('passport-height-input').value = d.passportHeight;
      document.getElementById('passport-kb-input').value = d.passportKb;
    }

    if (savedActiveView) {
      switchView(savedActiveView);
    } else if (d.activeView) {
      switchView(d.activeView);
    }

    showToast('✨ Welcome back! Your previous workspace state has been seamlessly restored.');
  } else if (savedActiveView) {
    switchView(savedActiveView);
  }
}

/**
 * Visual Auto-Save Status Indicator
 */
function triggerAutoSaveIndicator() {
  const elem = document.getElementById('save-status-text');
  if (elem) {
    elem.textContent = 'Auto-saved just now';
  }
}

/**
 * Theme Manager
 */
function initTheme() {
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const savedTheme = localStorage.getItem('omnistudy_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  themeToggleBtn?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('omnistudy_theme', next);
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
}

/**
 * Toast Notification System
 */
function createToastNotifier() {
  const container = document.getElementById('toast-container');
  return function showToast(message, duration = 4000) {
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  };
}

/**
 * Modal Handling (Group creation, Add creator, Chat)
 */
function setupModals() {
  document.querySelectorAll('.open-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal;
      document.getElementById(modalId)?.classList.add('open');
    });
  });

  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  });
}
