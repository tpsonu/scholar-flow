/**
 * OmniStudy Notes & Documentation Module
 * - Square Tile Subject Browser (Physics, Maths, CS, etc.) with Dynamic Subject Creation
 * - Scoped Notes Workspace & Rich Markdown Editor
 * - Right-Click Cursor Context Menu: "Add Voice Note"
 * - Floating Voice Recording Pill positioned exactly at the cursor position
 * - In-Note Playable Voice Note Chips
 */

import { saveState, loadState, storeBlob, getBlob } from './storage.js';
import { createSynthesizedAudioBlob } from './voice-notes.js';
import { getBranchesForSubject, openCreateBranchModal } from './brancher.js';

let subjects = [];
let notes = [];
let activeSubject = null;
let activeNoteId = null;
let activeBranchFilter = null;
let saveTimeout = null;

// Floating voice recorder state
let savedCursorPos = 0;
let lastMouseX = 100;
let lastMouseY = 100;
let isFloatingRecording = false;
let floatingMediaRecorder = null;
let floatingAudioChunks = [];
let floatingAudioContext = null;
let floatingAnalyser = null;
let floatingAnimId = null;
let floatingCurrentBlob = null;
let floatingCurrentUrl = null;
let floatingStartTime = 0;
let floatingTimerInterval = null;

// Audio player for in-editor voice notes
let activeMemoAudio = null;
let currentlyPlayingMemoId = null;
let currentPlaybackSpeed = 1.0;
let isNotePreviewMode = false;
let toastFn = null;
let noteChangeCallback = null;
let isTileSelectMode = false;
let selectedSubjectNames = new Set();
let draggedNoteId = null;
let isDraggingNote = false;
let draggedSubjectName = null;
let isDraggingSubject = false;

export function initNotesModule(onNoteChange, showToastFn) {
  toastFn = showToastFn;
  noteChangeCallback = onNoteChange;
  loadSubjectsAndNotes();

  // Elements in Subjects View
  const subjectSearchInput = document.getElementById('subject-search-input');
  const openNewSubjectBtn = document.getElementById('open-new-subject-btn');
  const createSubjectModal = document.getElementById('create-subject-modal');
  const createSubjectForm = document.getElementById('create-subject-form');

  // Elements in Workspace View
  const backToSubjectsBtn = document.getElementById('notes-back-to-subjects-btn');
  const notesSearchInput = document.getElementById('notes-search-input');
  const newNoteBtn = document.getElementById('notes-new-btn');
  const titleInput = document.getElementById('note-edit-title');
  const categoryInput = document.getElementById('note-edit-category');
  const contentInput = document.getElementById('note-edit-content');
  const tagsInput = document.getElementById('note-edit-tags');
  const deleteBtn = document.getElementById('note-delete-btn');
  const shareBtn = document.getElementById('note-share-btn');
  const exportPdfBtn = document.getElementById('note-export-pdf-btn');

  // Search subjects in real time as the user types
  subjectSearchInput?.addEventListener('input', () => {
    renderSubjectTiles();
  });

  // Handle Enter key on subject search for instant creation
  subjectSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = subjectSearchInput.value.trim();
      if (q) {
        const existing = subjects.find(s => s.name.toLowerCase() === q.toLowerCase());
        if (existing) {
          openSubjectWorkspace(existing.name);
        } else {
          createAndOpenSubject(q);
        }
      }
    }
  });

  // Open Add Subject Modal
  openNewSubjectBtn?.addEventListener('click', () => {
    createSubjectModal?.classList.add('open');
    document.getElementById('new-subject-name')?.focus();
  });

  // Form submit in Add Subject Modal
  createSubjectForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('new-subject-name');
    const emojiInput = document.getElementById('new-subject-emoji');
    const firstNoteInput = document.getElementById('new-subject-first-note');

    const name = nameInput.value.trim();
    if (!name) return;

    const emoji = emojiInput.value.trim() || getSubjectEmoji(name);
    const firstNoteTitle = firstNoteInput.value.trim() || `${name} Overview & Syllabus`;

    createAndOpenSubject(name, emoji, firstNoteTitle);

    createSubjectModal?.classList.remove('open');
    nameInput.value = '';
    firstNoteInput.value = '';
  });

  // Back to subjects grid button
  backToSubjectsBtn?.addEventListener('click', () => {
    activeSubject = null;
    localStorage.removeItem('omnistudy_active_subject');
    isTileSelectMode = false;
    selectedSubjectNames.clear();
    renderSubjectTiles();
    showSubjectsView();
  });

  // Search notes within active subject
  notesSearchInput?.addEventListener('input', () => {
    renderNotesList();
  });

  // New Note inside active subject
  newNoteBtn?.addEventListener('click', () => {
    if (!activeSubject) return;
    const currentBranch = (activeBranchFilter && activeBranchFilter !== 'all' && activeBranchFilter !== '__unbranched__')
      ? activeBranchFilter
      : '';
    const newNote = {
      id: `note_${Date.now()}`,
      title: currentBranch ? `Untitled ${currentBranch} Note` : `Untitled ${activeSubject} Note`,
      category: activeSubject,
      branch: currentBranch,
      content: currentBranch ? `# ${currentBranch} Study Notes\n\n- \n- ` : `# ${activeSubject} Notes\n\n- \n- `,
      tags: [
        activeSubject.toLowerCase().replace(/\s+/g, '-'),
        ...(currentBranch ? [currentBranch.toLowerCase().replace(/\s+/g, '-')] : []),
        'study'
      ],
      voice_memos: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    notes.unshift(newNote);
    activeNoteId = newNote.id;
    saveNotes();
    renderBranchBar();
    renderNotesList();
    loadNoteIntoEditor(newNote);
    document.getElementById('note-edit-title')?.focus();
  });

  // Branch Bar "+ Add Branch" button
  document.getElementById('notes-add-branch-btn')?.addEventListener('click', () => {
    openCreateBranchModal(activeSubject);
  });

  // Branch Selector dropdown in note editor
  const branchSelect = document.getElementById('note-edit-branch');
  branchSelect?.addEventListener('change', () => {
    if (branchSelect.value === '__new_branch__') {
      openCreateBranchModal(activeSubject);
      const cur = notes.find(n => n.id === activeNoteId);
      branchSelect.value = cur?.branch || '';
      return;
    }

    if (activeNoteId) {
      const cur = notes.find(n => n.id === activeNoteId);
      if (cur) {
        cur.branch = branchSelect.value;
        cur.updated_at = new Date().toISOString();
        saveNotes();
        renderBranchBar();
        renderNotesList();
      }
    }
  });

  // Listen to branch updates
  window.addEventListener('omnistudy:branches-updated', () => {
    if (activeSubject) {
      renderBranchBar();
      const cur = notes.find(n => n.id === activeNoteId);
      populateEditorBranchSelect(cur?.branch || '');
    }
  });

  // Listen to external note updates (e.g. from Brancher View)
  window.addEventListener('omnistudy:notes-updated', () => {
    const saved = localStorage.getItem('omnistudy_notes');
    if (saved) {
      try {
        notes = JSON.parse(saved);
        if (activeSubject) {
          renderBranchBar();
          renderNotesList();
        }
      } catch {}
    }
  });

  // Note editor instant auto-save
  [titleInput, categoryInput, contentInput, tagsInput].forEach(elem => {
    elem?.addEventListener('input', () => {
      triggerAutoSave(onNoteChange);
    });
  });

  // Delete note
  deleteBtn?.addEventListener('click', () => {
    if (!activeNoteId) return;
    if (confirm('Are you sure you want to delete this note?')) {
      notes = notes.filter(n => n.id !== activeNoteId);
      saveNotes();
      const subjectNotes = notes.filter(n => n.category.toLowerCase() === (activeSubject || '').toLowerCase());
      activeNoteId = subjectNotes.length > 0 ? subjectNotes[0].id : null;
      renderNotesList();
      if (activeNoteId) {
        loadNoteIntoEditor(subjectNotes[0]);
      } else {
        clearEditor();
      }
    }
  });

  // Share note link
  shareBtn?.addEventListener('click', () => {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    const shareUrl = `${window.location.origin}/#note=${note.id}`;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      alert(`Study Note Link copied to clipboard!\n\n${shareUrl}\n\nAnyone with this link can view your notes.`);
    }).catch(() => {
      prompt('Share this study note URL:', shareUrl);
    });
  });

  // Export / Download note directly to PDF
  exportPdfBtn?.addEventListener('click', () => {
    downloadCurrentNoteAsPdf();
  });

  // Note Action Toolbar buttons
  const toolbarVoiceBtn = document.getElementById('note-toolbar-voice-btn');
  const toolbarDownloadPdfBtn = document.getElementById('note-download-pdf-btn');

  toolbarVoiceBtn?.addEventListener('click', () => {
    const rect = toolbarVoiceBtn.getBoundingClientRect();
    openFloatingVoiceRecorderAt(rect.left, rect.bottom + 8);
  });
  toolbarDownloadPdfBtn?.addEventListener('click', () => {
    downloadCurrentNoteAsPdf();
  });

  // Setup Font Family, Font Size & Formatting Toolbar controls
  setupEditorFontAndFormattingControls(onNoteChange);

  // Setup Right-Click Context Menu & Floating Voice Recorder
  setupRightClickVoiceNoteFeature(onNoteChange);

  // Setup Notion-Style Slash ("/") Command Menu
  setupSlashCommandMenu(onNoteChange);

  // Setup In-Editor Mic Logo Click-to-Play & Preview Switcher
  setupNoteAreaVoicePlayback(onNoteChange);

  // Setup Subject Tile Management (Single Delete & Batch Select/Delete)
  setupTileManagementControls();

  // Rehydrate state: check if user left off inside a specific subject
  const savedActiveSubject = localStorage.getItem('omnistudy_active_subject');
  if (savedActiveSubject && subjects.some(s => s.name.toLowerCase() === savedActiveSubject.toLowerCase())) {
    openSubjectWorkspace(savedActiveSubject);
  } else {
    showSubjectsView();
    renderSubjectTiles();
  }
}

const FONT_FAMILIES = {
  sans: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, Helvetica, Arial, sans-serif",
  serif: "'Merriweather', 'Georgia', 'Cambria', 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
  handwriting: "'Caveat', 'Comic Sans MS', cursive, sans-serif",
  dyslexic: "'OpenDyslexic', 'Comic Sans MS', 'Trebuchet MS', sans-serif"
};

let savedRange = null;

function saveCurrentSelectionRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelectionRange() {
  if (savedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
}

function ensureEditorFocus() {
  const editor = document.getElementById('note-edit-content');
  if (!editor) return;
  if (document.activeElement !== editor) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function applyFontFamilyToSelection(familyCss) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
    const span = document.createElement('span');
    span.style.fontFamily = familyCss;
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
}

function setupEditorFontAndFormattingControls(onNoteChange) {
  const editorElem = document.getElementById('note-edit-content');
  const previewElem = document.getElementById('note-preview-content');
  const fontFamilySelect = document.getElementById('note-font-family-select');
  const fontSizeSelect = document.getElementById('note-font-size-select');

  // Load saved preferences
  const savedFont = localStorage.getItem('omnistudy_note_font_family') || 'sans';
  const savedSize = localStorage.getItem('omnistudy_note_font_size') || '15px';

  function applyBaseFontSettings(familyKey, sizeVal) {
    const familyCss = FONT_FAMILIES[familyKey] || FONT_FAMILIES.sans;
    if (editorElem) {
      editorElem.style.fontFamily = familyCss;
      editorElem.style.fontSize = sizeVal;
    }
    if (previewElem) {
      previewElem.style.fontFamily = familyCss;
      previewElem.style.fontSize = sizeVal;
    }
  }

  if (fontFamilySelect) {
    fontFamilySelect.value = savedFont;
    fontFamilySelect.addEventListener('change', () => {
      const val = fontFamilySelect.value;
      localStorage.setItem('omnistudy_note_font_family', val);
      const familyCss = FONT_FAMILIES[val] || FONT_FAMILIES.sans;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        applyFontFamilyToSelection(familyCss);
      } else {
        applyBaseFontSettings(val, fontSizeSelect ? fontSizeSelect.value : '15px');
      }
      triggerAutoSave(onNoteChange);
    });
  }

  if (fontSizeSelect) {
    fontSizeSelect.value = savedSize;
    fontSizeSelect.addEventListener('change', () => {
      const val = fontSizeSelect.value;
      localStorage.setItem('omnistudy_note_font_size', val);
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        applyFontSizeToSelection(val);
      } else {
        applyBaseFontSettings(fontFamilySelect ? fontFamilySelect.value : 'sans', val);
      }
      triggerAutoSave(onNoteChange);
    });
  }

  // Initial apply
  applyBaseFontSettings(savedFont, savedSize);

  // Prevent mousedown on all toolbar formatting buttons from blurring the editor
  // This allows formatting selected text or toggling typing style without losing focus
  const formatButtons = [
    'format-bold-btn',
    'format-italic-btn',
    'format-underline-btn',
    'format-highlight-btn',
    'format-strike-btn',
    'format-heading-btn'
  ];

  formatButtons.forEach(btnId => {
    const btn = document.getElementById(btnId);
    btn?.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevents button from stealing focus from contenteditable
    });
  });

  // Bold Button (execCommand bold: toggles for upcoming text OR wraps selection)
  document.getElementById('format-bold-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    document.execCommand('bold', false, null);
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Italic Button (execCommand italic: toggles for upcoming text OR wraps selection)
  document.getElementById('format-italic-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    document.execCommand('italic', false, null);
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Underline Button (execCommand underline: toggles for upcoming text OR wraps selection)
  document.getElementById('format-underline-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    document.execCommand('underline', false, null);
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Highlight Button (Yellow notebook highlight #fef08a)
  document.getElementById('format-highlight-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    toggleHighlight();
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Strikethrough Button
  document.getElementById('format-strike-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    document.execCommand('strikeThrough', false, null);
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Heading Toggle Button (Toggles H3 / Normal paragraph)
  document.getElementById('format-heading-btn')?.addEventListener('click', () => {
    ensureEditorFocus();
    const currentBlock = document.queryCommandValue('formatBlock');
    if (currentBlock === 'h3' || currentBlock === 'H3') {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<h3>');
    }
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
  });

  // Keyboard Shortcuts in contenteditable
  editorElem?.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        document.execCommand('bold', false, null);
        updateToolbarButtonStates();
        triggerAutoSave(onNoteChange);
      } else if (key === 'i') {
        e.preventDefault();
        document.execCommand('italic', false, null);
        updateToolbarButtonStates();
        triggerAutoSave(onNoteChange);
      } else if (key === 'u') {
        e.preventDefault();
        document.execCommand('underline', false, null);
        updateToolbarButtonStates();
        triggerAutoSave(onNoteChange);
      } else if (key === 'h' && e.shiftKey) {
        e.preventDefault();
        toggleHighlight();
        updateToolbarButtonStates();
        triggerAutoSave(onNoteChange);
      }
    }
  });

  // Sync toolbar active button states and auto-adjust page whenever cursor moves
  let isAdjustingScroll = false;
  function handleCaretScrollAdjustment(forceCenter = false) {
    if (isAdjustingScroll) return;
    isAdjustingScroll = true;
    requestAnimationFrame(() => {
      try {
        const editor = document.getElementById('note-edit-content');
        if (editor && (document.activeElement === editor || editor.contains(document.activeElement))) {
          autoAdjustPageToMiddle(editor, forceCenter);
        }
      } finally {
        isAdjustingScroll = false;
      }
    });
  }

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editorElem || editorElem?.contains(document.activeElement)) {
      updateToolbarButtonStates();
    }
  });

  // Auto-adjust page when typing or pressing navigation/Enter keys
  editorElem?.addEventListener('keydown', (e) => {
    if (['Enter', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Backspace', 'Delete'].includes(e.key)) {
      handleCaretScrollAdjustment();
    }
  });

  editorElem?.addEventListener('keyup', (e) => {
    updateToolbarButtonStates();
    if (['Enter', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Backspace', 'Delete', ' '].includes(e.key)) {
      handleCaretScrollAdjustment();
    }
  });

  editorElem?.addEventListener('mouseup', () => {
    updateToolbarButtonStates();
  });

  editorElem?.addEventListener('input', () => {
    updateToolbarButtonStates();
    triggerAutoSave(onNoteChange);
    handleCaretScrollAdjustment();
  });

  // Handle click on interactive voice chips and click in generous bottom space
  editorElem?.addEventListener('click', (e) => {
    const chipMic = e.target.closest('.note-voice-chip-mic, .note-voice-chip');
    if (chipMic) {
      e.preventDefault();
      e.stopPropagation();
      const memoId = chipMic.dataset.memoId;
      const dur = chipMic.dataset.dur || '00:08';
      const title = chipMic.dataset.title || 'Voice Note';
      togglePlayVoiceMemo(memoId, title, dur);
      return;
    }

    // If clicking in the bottom padding space below the last element, move cursor to the end
    const lastChild = editorElem.lastElementChild;
    if (lastChild) {
      const lastRect = lastChild.getBoundingClientRect();
      if (e.clientY > lastRect.bottom + 8) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(lastChild);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        editorElem.focus();
      }
    }
    handleCaretScrollAdjustment();
  });
}

function updateToolbarButtonStates() {
  const boldBtn = document.getElementById('format-bold-btn');
  const italicBtn = document.getElementById('format-italic-btn');
  const underlineBtn = document.getElementById('format-underline-btn');
  const strikeBtn = document.getElementById('format-strike-btn');
  const highlightBtn = document.getElementById('format-highlight-btn');
  const headingBtn = document.getElementById('format-heading-btn');

  try {
    const isBold = document.queryCommandState('bold');
    const isItalic = document.queryCommandState('italic');
    const isUnderline = document.queryCommandState('underline');
    const isStrike = document.queryCommandState('strikeThrough');

    if (boldBtn) boldBtn.classList.toggle('active', !!isBold);
    if (italicBtn) italicBtn.classList.toggle('active', !!isItalic);
    if (underlineBtn) underlineBtn.classList.toggle('active', !!isUnderline);
    if (strikeBtn) strikeBtn.classList.toggle('active', !!isStrike);

    const sel = window.getSelection();
    let isHilite = false;
    let isH3 = false;
    if (sel && sel.rangeCount > 0) {
      let node = sel.anchorNode;
      const editor = document.getElementById('note-edit-content');
      while (node && node !== editor) {
        if (node.nodeType === 1) {
          const tag = node.tagName.toUpperCase();
          if (tag === 'MARK' || node.classList?.contains('note-highlight') || node.style?.backgroundColor === 'rgb(254, 240, 138)' || node.style?.backgroundColor === '#fef08a') {
            isHilite = true;
          }
          if (tag === 'H3' || tag === 'H2' || tag === 'H1') {
            isH3 = true;
          }
        }
        node = node.parentNode;
      }
    }
    if (highlightBtn) highlightBtn.classList.toggle('active', isHilite);
    if (headingBtn) headingBtn.classList.toggle('active', isH3);
  } catch (err) {}
}

/**
 * 100% read-only caret coordinate detector for editor scrolling.
 * Safely inspects the bounding client rectangle of the caret without modifying the DOM or selection.
 */
function getCaretViewportRect(editor) {
  if (!editor) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;

  // 1. Try native getBoundingClientRect() if valid
  try {
    const rect = range.getBoundingClientRect();
    if (rect && rect.height > 0 && rect.bottom > 0) {
      return rect;
    }
  } catch (e) {}

  // 2. Try native getClientRects() if valid
  try {
    const rects = range.getClientRects();
    if (rects && rects.length > 0 && rects[0].height > 0 && rects[0].bottom > 0) {
      return rects[0];
    }
  } catch (e) {}

  // 3. If in a text node, use a 1-character sub-range around the cursor (non-destructive, read-only)
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node && node.nodeType === Node.TEXT_NODE) {
    if (offset > 0) {
      try {
        const charRange = document.createRange();
        charRange.setStart(node, offset - 1);
        charRange.setEnd(node, offset);
        const cr = charRange.getBoundingClientRect();
        if (cr && cr.height > 0 && cr.bottom > 0) return cr;
      } catch (e) {}
    }
    if (node.length > offset) {
      try {
        const charRange = document.createRange();
        charRange.setStart(node, offset);
        charRange.setEnd(node, offset + 1);
        const cr = charRange.getBoundingClientRect();
        if (cr && cr.height > 0 && cr.bottom > 0) return cr;
      } catch (e) {}
    }
  }

  // 4. If in an element node (e.g. at a <br> or block boundary)
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[offset] || node.childNodes[offset - 1];
    if (child) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const cr = child.getBoundingClientRect();
        if (cr && cr.height > 0 && cr.bottom > 0) return cr;
      } else if (child.nodeType === Node.TEXT_NODE && child.length > 0) {
        try {
          const charRange = document.createRange();
          charRange.setStart(child, 0);
          charRange.setEnd(child, Math.min(1, child.length));
          const cr = charRange.getBoundingClientRect();
          if (cr && cr.height > 0 && cr.bottom > 0) return cr;
        } catch (e) {}
      }
    }
    // Read-only element fallback
    if (node !== editor && editor.contains(node)) {
      const cr = node.getBoundingClientRect();
      if (cr && cr.height > 0 && cr.bottom > 0) return cr;
    }
  }

  // 5. Parent element fallback (strictly read-only)
  const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (parent && parent !== editor && editor.contains(parent)) {
    const cr = parent.getBoundingClientRect();
    if (cr && cr.height > 0 && cr.bottom > 0) return cr;
  }

  return null;
}

/**
 * Automatically adjust the page scroll position so that the cursor never reaches
 * the bottom of the page. Once the cursor reaches the vertical middle (~48% from top),
 * the editor scrolls itself so that typing stays centered comfortably at eye-level.
 */
function autoAdjustPageToMiddle(editor, forceCenter = false) {
  if (!editor) return;
  const caretRect = getCaretViewportRect(editor);
  if (!caretRect || caretRect.height === 0 || caretRect.bottom === 0) return;

  const editorRect = editor.getBoundingClientRect();
  // Vertical middle part: 48% down from the top of the editor pane
  const middleY = editorRect.top + (editorRect.height * 0.48);

  if (caretRect.bottom > middleY || forceCenter) {
    // Caret reached or passed the middle line:
    // Automatically adjust the scroll position so cursor stays at the middle part
    const delta = caretRect.bottom - middleY;
    if (delta > 0 || forceCenter) {
      editor.scrollTop += delta;
    }
  } else {
    // When editing or navigating near the very top of the editor, keep line comfortably visible
    const topLimit = editorRect.top + 28;
    if (caretRect.top < topLimit) {
      const scrollUp = topLimit - caretRect.top;
      editor.scrollTop -= scrollUp;
    }
  }
}

function toggleHighlight() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  let node = sel.anchorNode;
  const editor = document.getElementById('note-edit-content');
  let markParent = null;

  while (node && node !== editor) {
    if (node.nodeType === 1 && (node.tagName === 'MARK' || node.classList?.contains('note-highlight') || node.style?.backgroundColor)) {
      markParent = node;
      break;
    }
    node = node.parentNode;
  }

  if (markParent) {
    // Un-highlight: unwrap markParent
    const parent = markParent.parentNode;
    while (markParent.firstChild) {
      parent.insertBefore(markParent.firstChild, markParent);
    }
    parent.removeChild(markParent);
  } else {
    // Apply highlight
    if (!sel.isCollapsed) {
      try {
        if (!document.execCommand('hiliteColor', false, '#fef08a')) {
          document.execCommand('backColor', false, '#fef08a');
        }
      } catch (e) {
        const range = sel.getRangeAt(0);
        const mark = document.createElement('mark');
        mark.className = 'note-highlight';
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      }
    } else {
      // Empty cursor: insert highlighted mark ready for upcoming characters
      const mark = document.createElement('mark');
      mark.className = 'note-highlight';
      mark.innerHTML = '&#8203;';
      const range = sel.getRangeAt(0);
      range.insertNode(mark);
      range.selectNodeContents(mark);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function applyFontSizeToSelection(sizePx) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
    const span = document.createElement('span');
    span.style.fontSize = sizePx;
    span.appendChild(range.extractContents());
    range.insertNode(span);
  } else {
    const editor = document.getElementById('note-edit-content');
    if (editor) editor.style.fontSize = sizePx;
  }
}

/**
 * Right-Click Context Menu & Floating Voice Note Pill positioned at Cursor
 */
function setupRightClickVoiceNoteFeature(onNoteChange) {
  const contentTextarea = document.getElementById('note-edit-content');
  const contextMenu = document.getElementById('editor-context-menu');
  const ctxCopyBtn = document.getElementById('ctx-copy-text');
  const ctxPasteBtn = document.getElementById('ctx-paste-text');
  const ctxSelectAllBtn = document.getElementById('ctx-select-all');
  const ctxAddVoiceBtn = document.getElementById('ctx-add-voice-note');
  const ctxInsertDateBtn = document.getElementById('ctx-insert-date');
  const ctxInsertTodoBtn = document.getElementById('ctx-insert-todo');
  const ctxDownloadPdfBtn = document.getElementById('ctx-download-pdf');

  const floatingWidget = document.getElementById('floating-voice-widget');
  const floatingCloseBtn = document.getElementById('floating-voice-close');
  const floatingToggleBtn = document.getElementById('floating-record-toggle-btn');
  const floatingSaveBtn = document.getElementById('floating-save-insert-btn');
  const floatingRetryBtn = document.getElementById('floating-retry-btn');

  // Intercept Right Click on the note editor
  contentTextarea?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    saveCurrentSelectionRange();
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (contextMenu) {
      // Clamp within viewport
      const x = Math.min(lastMouseX, window.innerWidth - 255);
      const y = Math.min(lastMouseY, window.innerHeight - 310);
      contextMenu.style.left = `${Math.max(10, x)}px`;
      contextMenu.style.top = `${Math.max(10, y)}px`;
      contextMenu.style.display = 'block';
    }
  });

  // Dismiss context menu when clicking outside
  window.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      contextMenu.style.display = 'none';
    }
  });

  // Context Menu: Copy
  ctxCopyBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    copyCurrentNoteOrSelection();
  });

  // Context Menu: Paste
  ctxPasteBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    pasteIntoNote(onNoteChange);
  });

  // Context Menu: Select All
  ctxSelectAllBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    ensureEditorFocus();
    document.execCommand('selectAll');
  });

  // Context Menu: "Add Voice Note" clicked
  ctxAddVoiceBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    openFloatingVoiceRecorderAt(lastMouseX, lastMouseY);
  });

  // Context Menu: Insert Date
  ctxInsertDateBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    const dateStr = `<strong>[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</strong>&nbsp;`;
    insertHtmlAtSavedCursor(dateStr, onNoteChange);
  });

  // Context Menu: Insert Checklist Todo
  ctxInsertTodoBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    const todoStr = `<div class="note-todo-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" style="cursor: pointer;"> <span>Task item...</span></div><br>`;
    insertHtmlAtSavedCursor(todoStr, onNoteChange);
  });

  // Context Menu: Download Note as PDF
  ctxDownloadPdfBtn?.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    downloadCurrentNoteAsPdf();
  });

  // Floating Close Button
  floatingCloseBtn?.addEventListener('click', () => {
    stopFloatingRecording();
    if (floatingWidget) floatingWidget.style.display = 'none';
  });

  // Record Button in Floating Capsule
  floatingToggleBtn?.addEventListener('click', () => {
    if (!isFloatingRecording) {
      startFloatingRecording();
    } else {
      stopFloatingRecording();
    }
  });

  // Save & Insert Audio into Note
  floatingSaveBtn?.addEventListener('click', async () => {
    if (!floatingCurrentBlob || !activeNoteId) return;

    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    const timerElem = document.getElementById('floating-timer-display');
    const duration = timerElem?.textContent || '00:05';
    const memoId = `voice_${Date.now()}`;
    const titleInput = document.getElementById('floating-title-input');
    const userTitle = titleInput?.value.trim();
    const memoTitle = userTitle || `Voice Note (${duration})`;

    // 1. Store audio blob in IndexedDB
    await storeBlob(memoId, floatingCurrentBlob, { title: memoTitle, duration });

    // 2. Add to note's voice_memos list
    if (!note.voice_memos) note.voice_memos = [];
    note.voice_memos.push({
      id: memoId,
      title: memoTitle,
      duration,
      timestamp: Date.now()
    });

    // 3. Insert interactive voice chip into contenteditable
    const chipHtml = `<span class="note-voice-chip" contenteditable="false" data-memo-id="${memoId}" data-dur="${duration}" data-title="${escapeHtml(memoTitle)}"><button type="button" class="note-voice-chip-mic" data-memo-id="${memoId}" data-dur="${duration}" data-title="${escapeHtml(memoTitle)}" title="Play ${escapeHtml(memoTitle)} (${duration})">🎙️</button><span class="note-voice-chip-dur">${duration}</span></span>&nbsp;`;
    insertHtmlAtSavedCursor(chipHtml, onNoteChange);

    // 4. Also register into global voice memos library
    const globalMemos = JSON.parse(localStorage.getItem('omnistudy_voice_memos_meta') || '[]');
    globalMemos.unshift({
      id: memoId,
      title: userTitle ? `${note.title}: ${userTitle}` : `${note.title}: Voice Note (${duration})`,
      duration,
      created_at: 'Just now'
    });
    localStorage.setItem('omnistudy_voice_memos_meta', JSON.stringify(globalMemos));

    // 5. Hide floating recorder & persist
    if (titleInput) titleInput.value = '';
    if (floatingWidget) floatingWidget.style.display = 'none';
    saveNotes();

    if (isNotePreviewMode) {
      renderNotePreview();
    }
  });

  // Retry Recording
  floatingRetryBtn?.addEventListener('click', () => {
    resetFloatingRecorderUI();
  });
}

function insertHtmlAtSavedCursor(html, onNoteChange) {
  const editor = document.getElementById('note-edit-content');
  if (!editor) return;
  editor.focus();

  if (savedRange) {
    restoreSelectionRange();
  }

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const frag = document.createDocumentFragment();
    let node;
    let lastNode = null;
    while ((node = temp.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } else {
    editor.innerHTML += html;
  }

  triggerAutoSave(onNoteChange);
}

/**
 * Notion-Style Slash ("/") Command Menu
 */
let isSlashMenuOpen = false;
let slashTriggerNode = null;
let slashTriggerIdx = 0;
let savedCaretCoords = null;
let filteredSlashCommands = [];
let activeSlashIndex = 0;

const SLASH_COMMANDS = [
  {
    cmd: 'text',
    title: 'Text',
    desc: 'Just start writing with plain text.',
    icon: 'T',
    keywords: 'text normal paragraph plain body standard',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('formatBlock', false, '<div>');
    }
  },
  {
    cmd: 'h1',
    title: 'Heading 1',
    desc: 'Big section heading.',
    icon: 'H₁',
    isHBadge: true,
    keywords: 'h1 heading 1 big title primary',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('formatBlock', false, '<h1>');
    }
  },
  {
    cmd: 'h2',
    title: 'Heading 2',
    desc: 'Medium section heading.',
    icon: 'H₂',
    isHBadge: true,
    keywords: 'h2 heading 2 medium secondary section',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('formatBlock', false, '<h2>');
    }
  },
  {
    cmd: 'h3',
    title: 'Heading 3',
    desc: 'Small section heading.',
    icon: 'H₃',
    isHBadge: true,
    keywords: 'h3 heading 3 small subsection',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('formatBlock', false, '<h3>');
    }
  },
  {
    cmd: 'h4',
    title: 'Heading 4',
    desc: 'Subheading or minor section.',
    icon: 'H₄',
    isHBadge: true,
    keywords: 'h4 heading 4 sub minor',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('formatBlock', false, '<h4>');
    }
  },
  {
    cmd: 'bullet',
    title: 'Bulleted list',
    desc: 'Create a simple bulleted list.',
    icon: '•=',
    isListBadge: true,
    keywords: 'bullet list unordered bulleted points ul',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('insertUnorderedList');
    }
  },
  {
    cmd: 'number',
    title: 'Numbered list',
    desc: 'Create a list with numbering.',
    icon: '1=',
    isListBadge: true,
    keywords: 'number numbered list ordered 1 ol sequential',
    action: (editor) => {
      ensureEditorFocus();
      document.execCommand('insertOrderedList');
    }
  },
  {
    cmd: 'todo',
    title: 'To-do list',
    desc: 'Track tasks with a to-do list.',
    icon: '☑️',
    keywords: 'todo to-do list checkbox task check checkmark',
    action: (editor, onNoteChange) => {
      const todoStr = `<div class="note-todo-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" style="cursor: pointer;"> <span>Task item...</span></div><br>`;
      insertHtmlAtSavedCursor(todoStr, onNoteChange);
    }
  },
  {
    cmd: 'voice',
    title: 'Voice Note',
    desc: 'Record audio and insert chip at cursor.',
    icon: '🎙️',
    keywords: 'voice audio memo mic recording record sound dictate',
    action: (editor, onNoteChange, caretCoords) => {
      const x = caretCoords ? caretCoords.left : lastMouseX || 200;
      const y = caretCoords ? caretCoords.bottom + 8 : lastMouseY || 200;
      openFloatingVoiceRecorderAt(x, y);
    }
  },
  {
    cmd: 'callout',
    title: 'Callout / Quote',
    desc: 'Make writing stand out with an accent callout.',
    icon: '💡',
    keywords: 'callout quote blockquote highlight tip note alert info',
    action: (editor, onNoteChange) => {
      const calloutStr = `<blockquote style="border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; background: rgba(124, 58, 237, 0.08); border-radius: 4px; color: var(--text-primary);">💡 Note or quote...</blockquote><br>`;
      insertHtmlAtSavedCursor(calloutStr, onNoteChange);
    }
  },
  {
    cmd: 'divider',
    title: 'Divider',
    desc: 'Visually divide blocks with a line.',
    icon: '―',
    keywords: 'divider horizontal rule line hr break separator',
    action: (editor, onNoteChange) => {
      const divStr = `<hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;"><br>`;
      insertHtmlAtSavedCursor(divStr, onNoteChange);
    }
  },
  {
    cmd: 'timestamp',
    title: 'Timestamp',
    desc: 'Insert current date and time badge.',
    icon: '🕒',
    keywords: 'timestamp time date clock now current today',
    action: (editor, onNoteChange) => {
      const dateStr = `<strong>[${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</strong>&nbsp;`;
      insertHtmlAtSavedCursor(dateStr, onNoteChange);
    }
  },
  {
    cmd: 'pdf',
    title: 'PDF',
    desc: 'Download this note as a printable PDF.',
    icon: '📄',
    keywords: 'pdf download export print document file',
    action: () => {
      downloadCurrentNoteAsPdf();
    }
  },
  {
    cmd: 'center',
    title: 'Center View at Cursor',
    desc: 'Scroll the editor so the current cursor line is at the vertical middle.',
    icon: '📜',
    keywords: 'center typewriter scroll focus vertical middle eye-level breathing bottom',
    action: () => {
      const editor = document.getElementById('note-edit-content');
      if (editor) {
        autoAdjustPageToMiddle(editor, true);
        toastFn?.('Editor centered at cursor line', 'info');
      }
    }
  }
];

function detectCurrentBlockCommand() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 'text';
  let node = sel.anchorNode;
  const editor = document.getElementById('note-edit-content');
  while (node && node !== editor) {
    if (node.nodeType === 1) {
      const tag = node.tagName.toUpperCase();
      if (tag === 'H1') return 'h1';
      if (tag === 'H2') return 'h2';
      if (tag === 'H3') return 'h3';
      if (tag === 'H4') return 'h4';
      if (tag === 'UL') return 'bullet';
      if (tag === 'OL') return 'number';
      if (node.classList?.contains('note-todo-item')) return 'todo';
      if (tag === 'BLOCKQUOTE') return 'callout';
    }
    node = node.parentNode;
  }
  return 'text';
}

function getCaretCoordinates() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  let rect = range.getBoundingClientRect();
  if (rect && (rect.top !== 0 || rect.bottom !== 0)) {
    return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height };
  }
  const rects = range.getClientRects();
  if (rects.length > 0) {
    return { left: rects[0].left, top: rects[0].top, bottom: rects[0].bottom, height: rects[0].height };
  }
  try {
    const dummy = document.createElement('span');
    dummy.textContent = '\u200B';
    const clone = range.cloneRange();
    clone.insertNode(dummy);
    rect = dummy.getBoundingClientRect();
    dummy.remove();
    sel.removeAllRanges();
    sel.addRange(range);
    if (rect && (rect.top !== 0 || rect.bottom !== 0)) {
      return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height };
    }
  } catch (e) {}

  const editor = document.getElementById('note-edit-content');
  if (editor) {
    const b = editor.getBoundingClientRect();
    return { left: b.left + 24, top: b.top + 30, bottom: b.top + 50, height: 20 };
  }
  return { left: 100, top: 100, bottom: 130, height: 30 };
}

function openSlashMenu(query = '', onNoteChange) {
  const slashMenu = document.getElementById('editor-slash-menu');
  if (!slashMenu) return;

  savedCaretCoords = getCaretCoordinates();
  renderSlashMenuItems(query, onNoteChange);

  if (!isSlashMenuOpen) {
    isSlashMenuOpen = true;
    activeSlashIndex = 0;
  }

  highlightActiveSlashItem();

  const menuWidth = 295;
  const menuHeight = 350;
  let left = savedCaretCoords ? savedCaretCoords.left : 100;
  let top = savedCaretCoords ? savedCaretCoords.bottom + 6 : 100;

  if (left + menuWidth > window.innerWidth - 16) {
    left = window.innerWidth - menuWidth - 16;
  }
  if (left < 16) left = 16;

  if (top + menuHeight > window.innerHeight - 16) {
    top = (savedCaretCoords ? savedCaretCoords.top : 200) - menuHeight - 6;
  }
  if (top < 16) top = 16;

  slashMenu.style.left = `${left}px`;
  slashMenu.style.top = `${top}px`;
  slashMenu.style.display = 'flex';
}

function closeSlashMenu() {
  if (!isSlashMenuOpen) return;
  isSlashMenuOpen = false;
  const slashMenu = document.getElementById('editor-slash-menu');
  if (slashMenu) slashMenu.style.display = 'none';
  slashTriggerNode = null;
  slashTriggerIdx = 0;
}

function renderSlashMenuItems(query = '', onNoteChange) {
  const itemsContainer = document.getElementById('slash-menu-items');
  const preview = document.getElementById('slash-search-preview');
  if (!itemsContainer) return;

  const q = query.trim().toLowerCase();
  if (preview) {
    preview.textContent = q ? `/${q}` : 'Type to search';
  }

  const currentCmd = detectCurrentBlockCommand();

  if (!q) {
    filteredSlashCommands = [...SLASH_COMMANDS];
  } else {
    filteredSlashCommands = SLASH_COMMANDS.filter(item => {
      return (
        item.cmd.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
      );
    });
  }

  if (activeSlashIndex >= filteredSlashCommands.length) {
    activeSlashIndex = 0;
  }

  if (filteredSlashCommands.length === 0) {
    itemsContainer.innerHTML = `<div class="slash-no-results">No matching commands for "/${escapeHtml(query)}"</div>`;
    return;
  }

  itemsContainer.innerHTML = filteredSlashCommands.map((item, idx) => {
    const isActive = idx === activeSlashIndex;
    const isCurrentBlock = item.cmd === currentCmd;
    const iconClass = item.isHBadge ? 'h-badge' : (item.isListBadge ? 'list-badge' : '');
    return `
      <div class="slash-item ${isActive ? 'active' : ''}" data-idx="${idx}" data-cmd="${item.cmd}">
        <span class="slash-item-icon ${iconClass}">${item.icon}</span>
        <div class="slash-item-content">
          <div class="slash-item-title">${escapeHtml(item.title)}</div>
          <div class="slash-item-desc">${escapeHtml(item.desc)}</div>
        </div>
        ${isCurrentBlock ? '<span class="slash-item-check">✓</span>' : ''}
      </div>
    `;
  }).join('');

  itemsContainer.querySelectorAll('.slash-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const idx = parseInt(el.dataset.idx, 10);
      if (!isNaN(idx)) {
        activeSlashIndex = idx;
        highlightActiveSlashItem();
      }
    });

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt(el.dataset.idx, 10);
      if (!isNaN(idx) && filteredSlashCommands[idx]) {
        selectSlashCommand(filteredSlashCommands[idx], onNoteChange);
      }
    });
  });
}

function highlightActiveSlashItem() {
  const itemsContainer = document.getElementById('slash-menu-items');
  if (!itemsContainer) return;
  const items = itemsContainer.querySelectorAll('.slash-item');
  items.forEach((item, idx) => {
    if (idx === activeSlashIndex) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function selectSlashCommand(cmdItem, onNoteChange) {
  if (!cmdItem) return;

  const editorElem = document.getElementById('note-edit-content');

  // Delete the typed / and search query text
  try {
    if (slashTriggerNode && slashTriggerNode.parentNode) {
      const text = slashTriggerNode.textContent || '';
      const startPos = Math.max(0, Math.min(slashTriggerIdx, text.length));
      const sel = window.getSelection();
      let endPos = text.length;
      if (sel && sel.focusNode === slashTriggerNode) {
        endPos = Math.max(startPos, Math.min(sel.focusOffset, text.length));
      }

      const r = document.createRange();
      r.setStart(slashTriggerNode, startPos);
      r.setEnd(slashTriggerNode, endPos);
      r.deleteContents();
      sel.removeAllRanges();
      sel.addRange(r);
      saveCurrentSelectionRange();
    }
  } catch (err) {
    console.warn('Error clearing slash query:', err);
  }

  const caretCoords = savedCaretCoords;
  closeSlashMenu();

  // Execute the command action
  cmdItem.action(editorElem, onNoteChange, caretCoords);

  updateToolbarButtonStates();
  triggerAutoSave(onNoteChange);
}

function setupSlashCommandMenu(onNoteChange) {
  const editorElem = document.getElementById('note-edit-content');
  const slashMenu = document.getElementById('editor-slash-menu');
  if (!editorElem || !slashMenu) return;

  function checkSlashTrigger() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      closeSlashMenu();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
      closeSlashMenu();
      return;
    }

    let node = sel.focusNode;
    const offset = sel.focusOffset;

    if (!node) {
      closeSlashMenu();
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.childNodes && node.childNodes[offset - 1]) {
        node = node.childNodes[offset - 1];
      }
    }

    if (!node || node.nodeType !== Node.TEXT_NODE) {
      closeSlashMenu();
      return;
    }

    const text = node.textContent || '';
    const textBefore = text.substring(0, offset);
    const slashIdx = textBefore.lastIndexOf('/');

    if (slashIdx === -1) {
      closeSlashMenu();
      return;
    }

    const charBefore = slashIdx > 0 ? textBefore[slashIdx - 1] : ' ';
    if (charBefore !== ' ' && charBefore !== '\n' && charBefore !== '\u00A0' && slashIdx !== 0) {
      closeSlashMenu();
      return;
    }

    const query = textBefore.substring(slashIdx + 1);
    if (query.includes(' ') || query.includes('\n')) {
      closeSlashMenu();
      return;
    }

    slashTriggerNode = node;
    slashTriggerIdx = slashIdx;
    openSlashMenu(query, onNoteChange);
  }

  editorElem.addEventListener('keydown', (e) => {
    if (isSlashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredSlashCommands.length > 0) {
          activeSlashIndex = (activeSlashIndex + 1) % filteredSlashCommands.length;
          highlightActiveSlashItem();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredSlashCommands.length > 0) {
          activeSlashIndex = (activeSlashIndex - 1 + filteredSlashCommands.length) % filteredSlashCommands.length;
          highlightActiveSlashItem();
        }
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredSlashCommands.length > 0 && activeSlashIndex < filteredSlashCommands.length) {
          selectSlashCommand(filteredSlashCommands[activeSlashIndex], onNoteChange);
        } else {
          closeSlashMenu();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlashMenu();
        return;
      }
    }
  });

  editorElem.addEventListener('input', () => {
    checkSlashTrigger();
  });

  editorElem.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      return;
    }
    checkSlashTrigger();
  });

  editorElem.addEventListener('click', () => {
    closeSlashMenu();
  });

  // Close when clicking footer or outside
  slashMenu.querySelector('.slash-menu-footer')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeSlashMenu();
  });

  window.addEventListener('mousedown', (e) => {
    if (isSlashMenuOpen && slashMenu && !slashMenu.contains(e.target)) {
      closeSlashMenu();
    }
  });
}

const PAGE_DIMENSIONS = {
  A4: { width: 595.28, height: 841.89, label: 'A4' },
  Letter: { width: 612.0, height: 792.0, label: 'US Letter' },
  Legal: { width: 612.0, height: 1008.0, label: 'US Legal' },
  A5: { width: 419.53, height: 595.28, label: 'A5' },
  A3: { width: 841.89, height: 1190.55, label: 'A3' },
  Executive: { width: 522.0, height: 756.0, label: 'Executive' }
};

function openFloatingVoiceRecorderAt(x, y) {
  const floatingWidget = document.getElementById('floating-voice-widget');
  if (!floatingWidget) return;
  saveCurrentSelectionRange();
  const widgetW = 310;
  const widgetH = 170;
  const posX = Math.max(12, Math.min(x, window.innerWidth - widgetW - 16));
  const posY = Math.max(12, Math.min(y, window.innerHeight - widgetH - 16));
  floatingWidget.style.left = `${posX}px`;
  floatingWidget.style.top = `${posY}px`;
  floatingWidget.style.display = 'flex';
  resetFloatingRecorderUI();
}

async function copyCurrentNoteOrSelection() {
  const editor = document.getElementById('note-edit-content');
  const titleInput = document.getElementById('note-edit-title');
  if (!editor) return;

  let textToCopy = '';
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) {
    textToCopy = sel.toString();
  } else {
    const title = titleInput?.value.trim() || '';
    const body = editor.innerText || '';
    textToCopy = title ? `${title}\n\n${body}` : body;
  }

  if (!textToCopy) {
    if (toastFn) toastFn('Nothing to copy - note is empty.');
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textToCopy);
    } else {
      const tempArea = document.createElement('textarea');
      tempArea.value = textToCopy;
      document.body.appendChild(tempArea);
      tempArea.select();
      document.execCommand('copy');
      document.body.removeChild(tempArea);
    }
    if (toastFn) {
      toastFn('📋 Copied to clipboard! Ready to paste into any notepad or website.');
    } else {
      alert('Copied to clipboard! Ready to paste into any notepad or website.');
    }
  } catch (err) {
    console.warn('Clipboard write error:', err);
    prompt('Copy to clipboard (Ctrl+C, Enter):', textToCopy);
  }
}

async function pasteIntoNote(onNoteChange) {
  const editor = document.getElementById('note-edit-content');
  if (!editor) return;

  let textToPaste = '';
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      textToPaste = await navigator.clipboard.readText();
    }
  } catch (err) {
    console.warn('Clipboard read error (permission required):', err);
  }

  if (!textToPaste) {
    textToPaste = prompt('Paste your text here (Ctrl+V) from another website or notepad:');
  }

  if (textToPaste) {
    ensureEditorFocus();
    if (savedRange) restoreSelectionRange();
    document.execCommand('insertText', false, textToPaste);
    triggerAutoSave(onNoteChange);
    if (toastFn) {
      toastFn('📥 Pasted text into your workspace note!');
    }
  }
}

export function downloadCurrentNoteAsPdf(specifiedPageSize) {
  if (!activeNoteId) {
    if (toastFn) toastFn('Please select or create a note first before downloading.');
    return;
  }

  const note = notes.find(n => n.id === activeNoteId);
  const title = document.getElementById('note-edit-title')?.value.trim() || note?.title || 'Untitled Note';
  const content = document.getElementById('note-edit-content')?.innerHTML || note?.content || '';
  const category = document.getElementById('note-edit-category')?.value.trim() || note?.category || 'General';
  const pageSize = specifiedPageSize || document.getElementById('note-pdf-page-size')?.value || 'A4';

  const pdfBytes = generateNotePdfBuffer(title, content, category, pageSize);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  const safeFilename = title.replace(/[^a-zA-Z0-9_\-]/g, '_');
  link.download = `${safeFilename}_${pageSize}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (toastFn) {
    toastFn(`✓ Downloaded "${title}" as ${pageSize} PDF!`);
  }
}

function wrapPdfText(text, maxChars) {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!w) continue;
    if ((cur + ' ' + w).trim().length <= maxChars) {
      cur = (cur + ' ' + w).trim();
    } else {
      if (cur) lines.push(cur);
      if (w.length > maxChars) {
        for (let i = 0; i < w.length; i += maxChars) {
          lines.push(w.substring(i, i + maxChars));
        }
        cur = '';
      } else {
        cur = w;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

function sanitizePdfAscii(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/==(.*?)==/g, '$1')
    .replace(/🎙️|🎤|🔊/g, '[Voice Note]')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/•/g, '*')
    .replace(/\$/g, '');
}

function escapePdfText(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function extractPdfLinesFromContent(content) {
  if (!content) return [''];
  if (/<(p|div|h[1-6]|span|ul|ol|li)\b[^>]*>/i.test(content)) {
    const temp = document.createElement('div');
    temp.innerHTML = content;
    temp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    const lines = [];
    temp.childNodes.forEach(child => {
      if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        const text = child.innerText || child.textContent || '';
        if (tag === 'h1') lines.push('# ' + text.trim());
        else if (tag === 'h2') lines.push('## ' + text.trim());
        else if (tag === 'h3') lines.push('### ' + text.trim());
        else if (child.classList?.contains('note-todo-item')) {
          const chk = child.querySelector('input[type="checkbox"]')?.checked;
          lines.push(`[${chk ? 'X' : ' '}] ${text.trim()}`);
        } else if (child.classList?.contains('note-voice-chip')) {
          const dur = child.dataset.dur || '00:08';
          lines.push(`🎙️ ${dur}`);
        } else {
          text.split('\n').forEach(l => lines.push(l));
        }
      } else if (child.nodeType === 3) {
        if (child.textContent.trim()) lines.push(child.textContent.trim());
      }
    });
    return lines.length > 0 ? lines : [''];
  }
  return content.split('\n');
}

function generateNotePdfBuffer(title, content, category, pageSize = 'A4') {
  const dim = PAGE_DIMENSIONS[pageSize] || PAGE_DIMENSIONS.A4;
  const width = dim.width;
  const height = dim.height;
  const leftMargin = 45;
  const rightMargin = 45;
  const topMargin = 48;
  const bottomMargin = 48;
  const contentWidth = width - leftMargin - rightMargin;

  const pages = [];
  let currentPage = { textItems: [], drawLines: [] };
  pages.push(currentPage);

  let currentY = height - topMargin;

  function startNewPage() {
    currentPage = { textItems: [], drawLines: [] };
    pages.push(currentPage);
    currentY = height - topMargin;

    // Header on continuation pages
    currentPage.textItems.push({
      text: sanitizePdfAscii(`${title} (Continued)`),
      font: 'F1',
      size: 8,
      x: leftMargin,
      y: height - 30
    });
    currentPage.drawLines.push({
      x1: leftMargin,
      y1: height - 34,
      x2: width - rightMargin,
      y2: height - 34
    });
    currentY = height - 50;
  }

  function addLine(text, font, size, lineHeight, indent = 0) {
    if (currentY - lineHeight < bottomMargin) {
      startNewPage();
    }
    currentPage.textItems.push({
      text: sanitizePdfAscii(text),
      font,
      size,
      x: leftMargin + indent,
      y: currentY
    });
    currentY -= lineHeight;
  }

  // --- Title & Header on Page 1 ---
  const maxTitleChars = Math.max(20, Math.floor(contentWidth / (18 * 0.55)));
  const titleLines = wrapPdfText(title, maxTitleChars);
  titleLines.forEach((tl) => {
    addLine(tl, 'F2', 18, 24);
  });

  const subText = `Subject: ${category} | Exported: ${new Date().toLocaleDateString()} | OmniStudy Notes`;
  addLine(subText, 'F1', 9, 14);

  // Horizontal divider
  currentPage.drawLines.push({
    x1: leftMargin,
    y1: currentY + 4,
    x2: width - rightMargin,
    y2: currentY + 4
  });
  currentY -= 14;

  // --- Note Body ---
  const rawLines = extractPdfLinesFromContent(content);
  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      currentY -= 8;
      continue;
    }

    // Voice Note citation line
    if (trimmed.includes('🎙️') || trimmed.includes('<!-- id:voice_')) {
      let dur = '00:05';
      const durMatch = trimmed.match(/(?:🎙️|🔊|🎤)\s*\(?(\d{1,2}:\d{2})\)?/) || trimmed.match(/\((\d{1,2}:\d{2})\)/) || trimmed.match(/(\d{1,2}:\d{2})/);
      if (durMatch) dur = durMatch[1];

      let memoTitle = '';
      const note = notes.find(n => n.id === activeNoteId);
      const idMatch = trimmed.match(/<!--\s*id:([a-zA-Z0-9_-]+)\s*-->/) || trimmed.match(/id:([a-zA-Z0-9_-]+)/);
      if (idMatch && note?.voice_memos) {
        const found = note.voice_memos.find(m => m.id === idMatch[1]);
        if (found?.title) memoTitle = ` - ${found.title}`;
      }
      if (!memoTitle) {
        const titleMatch = trimmed.match(/—\s*\*([^*]+)\*/);
        if (titleMatch) memoTitle = ` - ${titleMatch[1]}`;
      }

      if (currentY - 20 < bottomMargin) startNewPage();
      currentY -= 4;
      addLine(`[Audio Memo: ${dur}${memoTitle} | Playable in OmniStudy]`, 'F2', 9, 14, 8);
      currentY -= 4;
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      currentY -= 6;
      const hText = trimmed.substring(4).trim();
      const maxH3 = Math.max(20, Math.floor(contentWidth / (11 * 0.55)));
      wrapPdfText(hText, maxH3).forEach(wl => addLine(wl, 'F2', 11, 16));
      currentY -= 2;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      currentY -= 8;
      const hText = trimmed.substring(3).trim();
      const maxH2 = Math.max(20, Math.floor(contentWidth / (13 * 0.55)));
      wrapPdfText(hText, maxH2).forEach(wl => addLine(wl, 'F2', 13, 18));
      currentY -= 3;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      currentY -= 10;
      const hText = trimmed.substring(2).trim();
      const maxH1 = Math.max(20, Math.floor(contentWidth / (15 * 0.55)));
      wrapPdfText(hText, maxH1).forEach(wl => addLine(wl, 'F2', 15, 20));
      currentY -= 4;
      continue;
    }

    // Checkboxes
    if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
      const isChecked = trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ');
      const checkText = `${isChecked ? '[X]' : '[ ]'} ${trimmed.substring(6).trim()}`;
      const maxP = Math.max(20, Math.floor(contentWidth / (10 * 0.52)));
      wrapPdfText(checkText, maxP - 4).forEach((wl, idx) => {
        addLine(wl, 'F1', 10, 14, idx === 0 ? 6 : 20);
      });
      continue;
    }

    // Bullets
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletText = `* ${trimmed.substring(2).trim()}`;
      const maxP = Math.max(20, Math.floor(contentWidth / (10 * 0.52)));
      wrapPdfText(bulletText, maxP - 4).forEach((wl, idx) => {
        addLine(wl, 'F1', 10, 14, idx === 0 ? 6 : 16);
      });
      continue;
    }

    // Quotes
    if (trimmed.startsWith('> ')) {
      const quoteText = `|  ${trimmed.substring(2).trim()}`;
      const maxP = Math.max(20, Math.floor(contentWidth / (9.5 * 0.52)));
      wrapPdfText(quoteText, maxP - 6).forEach((wl) => {
        addLine(wl, 'F1', 9.5, 13, 10);
      });
      continue;
    }

    // Regular paragraph text
    const maxP = Math.max(20, Math.floor(contentWidth / (10 * 0.52)));
    wrapPdfText(trimmed, maxP).forEach(wl => {
      addLine(wl, 'F1', 10, 14);
    });
  }

  // --- Footers on Every Page ---
  const totalPages = pages.length;
  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const p = pages[pIdx];
    p.drawLines.push({
      x1: leftMargin,
      y1: 36,
      x2: width - rightMargin,
      y2: 36
    });
    p.textItems.push({
      text: `OmniStudy - ScholarFlow Notes`,
      font: 'F1',
      size: 8,
      x: leftMargin,
      y: 24
    });
    p.textItems.push({
      text: `Page ${pIdx + 1} of ${totalPages} (${pageSize})`,
      font: 'F1',
      size: 8,
      x: width - rightMargin - 90,
      y: 24
    });
  }

  // --- Serialize Content Streams ---
  for (const p of pages) {
    let stream = 'q\n';
    for (const l of p.drawLines) {
      stream += `${l.x1.toFixed(2)} ${l.y1.toFixed(2)} m ${l.x2.toFixed(2)} ${l.y2.toFixed(2)} l S\n`;
    }
    for (const item of p.textItems) {
      stream += `BT\n`;
      stream += `/${item.font} ${item.size} Tf\n`;
      stream += `${item.x.toFixed(2)} ${item.y.toFixed(2)} Td\n`;
      stream += `(${escapePdfText(item.text)}) Tj\n`;
      stream += `ET\n`;
    }
    stream += 'Q\n';
    p.stream = stream;
  }

  // --- Assemble Standard PDF 1.4 Binary ---
  const objects = [];
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  const f1Id = 3 + pages.length * 2;
  const f2Id = f1Id + 1;

  pages.forEach((p, i) => {
    const pageObjId = 3 + i * 2;
    const streamObjId = 4 + i * 2;
    const stream = p.stream;
    objects.push(`${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Contents ${streamObjId} 0 R /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R >> >> >>\nendobj\n`);
    objects.push(`${streamObjId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  objects.push(`${f1Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  objects.push(`${f2Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`);

  let output = `%PDF-1.4\n`;
  const offsets = [];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(output.length);
    output += objects[i];
  }

  const xrefStart = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    output += String(offsets[i]).padStart(10, '0') + ` 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  const buffer = new Uint8Array(output.length);
  for (let i = 0; i < output.length; i++) {
    buffer[i] = output.charCodeAt(i) & 0xff;
  }

  return buffer;
}

async function startFloatingRecording() {
  floatingAudioChunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    handleFloatingStream(stream);
  } catch (err) {
    console.warn('Microphone permission blocked. Using audio synthesizer for note recording.', err);
    startFloatingSimulatedRecording();
  }
}

function handleFloatingStream(stream) {
  floatingAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = floatingAudioContext.createMediaStreamSource(stream);
  floatingAnalyser = floatingAudioContext.createAnalyser();
  floatingAnalyser.fftSize = 128;
  source.connect(floatingAnalyser);

  floatingMediaRecorder = new MediaRecorder(stream);
  floatingMediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) floatingAudioChunks.push(e.data);
  };

  floatingMediaRecorder.onstop = () => {
    const blob = new Blob(floatingAudioChunks, { type: 'audio/webm' });
    floatingCurrentBlob = blob;
    setFloatingAudioPreview(blob);
    stream.getTracks().forEach(t => t.stop());
  };

  floatingMediaRecorder.start();
  setFloatingRecordingActiveUI();
  drawFloatingWaveform();
}

function startFloatingSimulatedRecording() {
  floatingAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  const osc = floatingAudioContext.createOscillator();
  const gain = floatingAudioContext.createGain();
  gain.gain.value = 0.05;
  floatingAnalyser = floatingAudioContext.createAnalyser();
  floatingAnalyser.fftSize = 128;
  osc.connect(gain);
  gain.connect(floatingAnalyser);
  osc.start();

  setFloatingRecordingActiveUI();
  drawFloatingWaveform();

  setTimeout(() => {
    if (isFloatingRecording) {
      floatingCurrentBlob = createSynthesizedAudioBlob();
    }
  }, 1500);
}

function setFloatingRecordingActiveUI() {
  isFloatingRecording = true;
  floatingStartTime = Date.now();

  const toggleBtn = document.getElementById('floating-record-toggle-btn');
  const icon = document.getElementById('floating-rec-btn-icon');
  const label = document.getElementById('floating-rec-btn-label');
  const status = document.getElementById('floating-voice-status');
  const dot = document.getElementById('floating-rec-dot');
  const actions = document.getElementById('floating-post-record-actions');

  if (toggleBtn) toggleBtn.classList.add('recording');
  if (icon) icon.textContent = '⏹';
  if (label) label.textContent = 'Stop';
  if (status) status.textContent = 'Recording Audio...';
  if (dot) dot.classList.add('active');
  if (actions) actions.style.display = 'none';

  const timerDisplay = document.getElementById('floating-timer-display');
  floatingTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - floatingStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    if (timerDisplay) timerDisplay.textContent = `${m}:${s}`;
  }, 500);
}

function stopFloatingRecording() {
  if (!isFloatingRecording) return;
  isFloatingRecording = false;
  clearInterval(floatingTimerInterval);
  if (floatingAnimId) cancelAnimationFrame(floatingAnimId);

  const toggleBtn = document.getElementById('floating-record-toggle-btn');
  const icon = document.getElementById('floating-rec-btn-icon');
  const label = document.getElementById('floating-rec-btn-label');
  const status = document.getElementById('floating-voice-status');
  const dot = document.getElementById('floating-rec-dot');
  const actions = document.getElementById('floating-post-record-actions');

  if (toggleBtn) toggleBtn.classList.remove('recording');
  if (icon) icon.textContent = '🎙️';
  if (label) label.textContent = 'Recorded';
  if (status) status.textContent = 'Review & Insert';
  if (dot) dot.classList.remove('active');
  if (actions) actions.style.display = 'flex';

  if (floatingMediaRecorder && floatingMediaRecorder.state !== 'inactive') {
    floatingMediaRecorder.stop();
  } else {
    if (!floatingCurrentBlob) {
      floatingCurrentBlob = createSynthesizedAudioBlob();
    }
    setFloatingAudioPreview(floatingCurrentBlob);
  }
}

function setFloatingAudioPreview(blob) {
  const audioElem = document.getElementById('floating-mini-audio');
  if (floatingCurrentUrl) URL.revokeObjectURL(floatingCurrentUrl);
  floatingCurrentUrl = URL.createObjectURL(blob);
  if (audioElem) {
    audioElem.src = floatingCurrentUrl;
    audioElem.load();
  }
}

function resetFloatingRecorderUI() {
  isFloatingRecording = false;
  clearInterval(floatingTimerInterval);
  floatingCurrentBlob = null;

  const toggleBtn = document.getElementById('floating-record-toggle-btn');
  const icon = document.getElementById('floating-rec-btn-icon');
  const label = document.getElementById('floating-rec-btn-label');
  const status = document.getElementById('floating-voice-status');
  const dot = document.getElementById('floating-rec-dot');
  const actions = document.getElementById('floating-post-record-actions');
  const timer = document.getElementById('floating-timer-display');

  if (toggleBtn) toggleBtn.classList.remove('recording');
  if (icon) icon.textContent = '🔴';
  if (label) label.textContent = 'Record';
  if (status) status.textContent = '🎙️ Record Voice Note';
  if (dot) dot.classList.remove('active');
  if (actions) actions.style.display = 'none';
  if (timer) timer.textContent = '00:00';
  const titleInput = document.getElementById('floating-title-input');
  if (titleInput) titleInput.value = '';

  const canvas = document.getElementById('floating-mini-waveform');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawFloatingWaveform() {
  const canvas = document.getElementById('floating-mini-waveform');
  if (!canvas || !floatingAnalyser) return;

  const ctx = canvas.getContext('2d');
  const bufferLength = floatingAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    if (!isFloatingRecording) return;
    floatingAnimId = requestAnimationFrame(draw);

    floatingAnalyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = '#121215';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#7c3aed';
    ctx.beginPath();

    const sliceWidth = canvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  };

  draw();
}

/**
 * In-Editor Voice Note Playback & Reading View Preview Switcher
 */
function setupNoteAreaVoicePlayback(onNoteChange) {
  const contentEditor = document.getElementById('note-edit-content');
  const previewElem = document.getElementById('note-preview-content');
  const editModeBtn = document.getElementById('note-mode-edit-btn');
  const previewModeBtn = document.getElementById('note-mode-preview-btn');

  // Mode Switchers
  editModeBtn?.addEventListener('click', () => {
    isNotePreviewMode = false;
    editModeBtn.classList.add('active');
    previewModeBtn?.classList.remove('active');
    if (contentEditor) contentEditor.style.display = 'block';
    if (previewElem) previewElem.style.display = 'none';
    contentEditor?.focus();
  });

  previewModeBtn?.addEventListener('click', () => {
    isNotePreviewMode = true;
    previewModeBtn.classList.add('active');
    editModeBtn?.classList.remove('active');
    if (contentEditor) contentEditor.style.display = 'none';
    if (previewElem) previewElem.style.display = 'block';
    renderNotePreview();
  });

  // Setup HUD controls
  setupHUDControls();
}

function setupHUDControls() {
  const hudMicBtn = document.getElementById('hud-mic-play-btn');
  const hudSpeedBtn = document.getElementById('hud-speed-btn');
  const hudCloseBtn = document.getElementById('hud-close-btn');
  const hudProgressWrap = document.getElementById('hud-progress-wrap');

  hudMicBtn?.addEventListener('click', () => {
    if (!activeMemoAudio) return;
    if (activeMemoAudio.paused) {
      activeMemoAudio.play();
      hudMicBtn.classList.remove('paused');
    } else {
      activeMemoAudio.pause();
      hudMicBtn.classList.add('paused');
    }
    if (isNotePreviewMode) renderNotePreview();
  });

  const speeds = [1, 1.25, 1.5, 2];
  let speedIdx = 0;
  hudSpeedBtn?.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    currentPlaybackSpeed = speeds[speedIdx];
    if (hudSpeedBtn) hudSpeedBtn.textContent = `${currentPlaybackSpeed}x`;
    if (activeMemoAudio) activeMemoAudio.playbackRate = currentPlaybackSpeed;
  });

  hudCloseBtn?.addEventListener('click', () => {
    if (activeMemoAudio) {
      activeMemoAudio.pause();
      activeMemoAudio = null;
    }
    currentlyPlayingMemoId = null;
    hideInEditorAudioHUD();
    if (isNotePreviewMode) renderNotePreview();
  });

  hudProgressWrap?.addEventListener('click', (e) => {
    if (!activeMemoAudio || !activeMemoAudio.duration) return;
    const rect = hudProgressWrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    activeMemoAudio.currentTime = ratio * activeMemoAudio.duration;
  });
}

async function togglePlayVoiceMemo(memoId, title = 'Voice Note', duration = '00:05') {
  // If already playing this memo, toggle pause
  if (currentlyPlayingMemoId === memoId && activeMemoAudio) {
    if (!activeMemoAudio.paused) {
      activeMemoAudio.pause();
      document.getElementById('hud-mic-play-btn')?.classList.add('paused');
      if (isNotePreviewMode) renderNotePreview();
      return;
    } else {
      activeMemoAudio.play();
      document.getElementById('hud-mic-play-btn')?.classList.remove('paused');
      if (isNotePreviewMode) renderNotePreview();
      return;
    }
  }

  // Stop any previous audio
  if (activeMemoAudio) {
    activeMemoAudio.pause();
    activeMemoAudio = null;
  }

  // Retrieve audio blob
  let blob = await getBlob(memoId);
  if (!blob) {
    blob = createSynthesizedAudioBlob();
  }

  activeMemoAudio = new Audio(URL.createObjectURL(blob));
  activeMemoAudio.playbackRate = currentPlaybackSpeed;
  currentlyPlayingMemoId = memoId;

  const note = notes.find(n => n.id === activeNoteId);
  const memoMeta = note?.voice_memos?.find(m => m.id === memoId);
  const displayTitle = memoMeta?.title || title || 'Voice Note';
  const displayDuration = memoMeta?.duration || duration || '00:05';

  showInEditorAudioHUD(memoId, displayTitle, displayDuration);
  if (isNotePreviewMode) renderNotePreview();

  activeMemoAudio.addEventListener('timeupdate', () => {
    if (!activeMemoAudio) return;
    const cur = activeMemoAudio.currentTime;
    const dur = activeMemoAudio.duration || 1;
    const pct = Math.min(100, (cur / dur) * 100);

    const fill = document.getElementById('hud-progress-fill');
    if (fill) fill.style.width = `${pct}%`;

    const timer = document.getElementById('hud-memo-timer');
    if (timer) {
      const curM = String(Math.floor(cur / 60)).padStart(2, '0');
      const curS = String(Math.floor(cur % 60)).padStart(2, '0');
      timer.textContent = `${curM}:${curS} / ${displayDuration}`;
    }
  });

  activeMemoAudio.addEventListener('ended', () => {
    currentlyPlayingMemoId = null;
    hideInEditorAudioHUD();
    if (isNotePreviewMode) renderNotePreview();
  });

  try {
    await activeMemoAudio.play();
    document.getElementById('hud-mic-play-btn')?.classList.remove('paused');
  } catch (err) {
    console.warn('Audio play error:', err);
  }
}

function showInEditorAudioHUD(memoId, title, duration) {
  const hud = document.getElementById('note-inline-audio-hud');
  const titleElem = document.getElementById('hud-memo-title');
  const timerElem = document.getElementById('hud-memo-timer');
  const micBtn = document.getElementById('hud-mic-play-btn');
  const fill = document.getElementById('hud-progress-fill');

  if (titleElem) titleElem.textContent = title;
  if (timerElem) timerElem.textContent = `00:00 / ${duration}`;
  if (fill) fill.style.width = '0%';
  if (micBtn) micBtn.classList.remove('paused');
  if (hud) hud.style.display = 'flex';
}

function hideInEditorAudioHUD() {
  const hud = document.getElementById('note-inline-audio-hud');
  if (hud) hud.style.display = 'none';
}

function renderNotePreview() {
  const contentElem = document.getElementById('note-edit-content');
  const previewElem = document.getElementById('note-preview-content');
  if (!contentElem || !previewElem) return;

  const html = contentElem.innerHTML || '';
  previewElem.innerHTML = html;

  previewElem.querySelectorAll('.note-voice-chip, .note-voice-chip-mic, .note-rendered-voice-card, .note-rendered-voice-minimal, .note-voice-mic-btn').forEach(elem => {
    elem.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const memoId = elem.dataset.memoId;
      const title = elem.dataset.title || 'Voice Note';
      const dur = elem.dataset.dur || '00:05';
      togglePlayVoiceMemo(memoId, title, dur);
    });
  });
}

function parseMarkdownInline(text) {
  let s = escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/==(.*?)==/g, '<mark class="note-highlight">$1</mark>')
    .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, '<span style="text-decoration: underline;">$1</span>')
    .replace(/&lt;mark&gt;(.*?)&lt;\/mark&gt;/gi, '<mark class="note-highlight">$1</mark>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/`(.*?)`/g, '<code style="background: var(--primary-light); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.88em;">$1</code>')
    .replace(/\$(.*?)\$/g, '<span style="font-family: var(--font-mono); color: var(--accent); background: rgba(124, 58, 237, 0.1); padding: 1px 4px; border-radius: 3px;">$1</span>');
  return s;
}

function loadSubjectsAndNotes() {
  const savedSubjects = localStorage.getItem('omnistudy_subjects');
  if (savedSubjects) {
    subjects = JSON.parse(savedSubjects);
  } else {
    subjects = [
      { id: 'subj_physics', name: 'Physics', icon: '⚛️', description: 'Quantum mechanics, thermodynamics & electromagnetism' },
      { id: 'subj_maths', name: 'Mathematics', icon: '📐', description: 'Calculus, linear algebra, discrete math & probability' },
      { id: 'subj_cs', name: 'Computer Science', icon: '💻', description: 'Algorithms, data structures & distributed systems' },
      { id: 'subj_medicine', name: 'Medicine', icon: '🩺', description: 'Pathology, pharmacology, anatomy & clinical vignettes' },
      { id: 'subj_law', name: 'Law', icon: '⚖️', description: 'Tort law, constitutional law, contracts & jurisprudence' },
      { id: 'subj_general', name: 'General Notes', icon: '📚', description: 'Interdisciplinary papers, study strategies & summaries' }
    ];
    localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));
  }

  const savedNotes = localStorage.getItem('omnistudy_notes');
  if (savedNotes) {
    notes = JSON.parse(savedNotes);
    const physNote = notes.find(n => n.id === 'note_phys_1');
    if (physNote) {
      if (!physNote.content.includes('🎙️')) {
        physNote.content = physNote.content.replace(
          '## 2. Time-Dependent Schrödinger Equation',
          '🎙️ 00:08 <!-- id:voice_phys_sample -->\n\n## 2. Time-Dependent Schrödinger Equation'
        );
      } else {
        physNote.content = physNote.content.replace(/🎙️\s*\*\*Voice Note\*\*\s*\([^)]+\)\s*—\s*\*[^<*]+\*\s*<!-- id:([a-zA-Z0-9_-]+) -->/g, '🎙️ 00:08 <!-- id:$1 -->');
      }
      if (!physNote.voice_memos || physNote.voice_memos.length === 0) {
        physNote.voice_memos = [{ id: 'voice_phys_sample', title: 'Lecture Voice Summary', duration: '00:08', timestamp: Date.now() }];
      }
      localStorage.setItem('omnistudy_notes', JSON.stringify(notes));
    }
  } else {
    notes = [
      {
        id: 'note_phys_1',
        title: 'Quantum Mechanics: Wave-Particle Duality & Schrödinger Equation',
        category: 'Physics',
        content: `# Quantum Mechanics Foundations\n\n## 1. Wave-Particle Duality\n- De Broglie Wavelength: $\\lambda = \\frac{h}{p}$\n- Matter exhibits both wave-like interference and localized particle collision behavior.\n\n🎙️ 00:08 <!-- id:voice_phys_sample -->\n\n## 2. Time-Dependent Schrödinger Equation\n$$i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r}, t) = \\hat{H} \\Psi(\\mathbf{r}, t)$$\n- $\\Psi(\\mathbf{r}, t)$: Complex probability amplitude.\n- Born Rule: $P(\\mathbf{r}) = |\\Psi(\\mathbf{r}, t)|^2$.\n\n## Key Exercises\n1. Calculate the ground state energy for a particle in a 1D infinite square well.\n2. Verify the normalization condition for Gaussian wave packets.`,
        tags: ['quantum', 'physics', 'schrodinger', 'formulas'],
        voice_memos: [
          { id: 'voice_phys_sample', title: 'Lecture Voice Summary', duration: '00:08', timestamp: Date.now() }
        ],
        created_at: new Date(Date.now() - 36000000).toISOString(),
        updated_at: new Date(Date.now() - 3600000).toISOString()
      },
      {
        id: 'note_phys_2',
        title: 'Electrodynamics: Maxwell’s Equations & Electromagnetic Waves',
        category: 'Physics',
        content: `# Maxwell's Equations in Differential Form\n\n1. **Gauss's Law for Electricity**: $\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}$\n2. **Gauss's Law for Magnetism**: $\\nabla \\cdot \\mathbf{B} = 0$\n3. **Faraday's Law of Induction**: $\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}$\n4. **Ampere-Maxwell Law**: $\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}$\n\n### Wave Propagation Speed\nIn vacuum, $c = \\frac{1}{\\sqrt{\\mu_0 \\varepsilon_0}} \\approx 3 \\times 10^8$ m/s.`,
        tags: ['electrodynamics', 'maxwell', 'physics'],
        voice_memos: [],
        created_at: new Date(Date.now() - 72000000).toISOString(),
        updated_at: new Date(Date.now() - 7200000).toISOString()
      },
      {
        id: 'note_math_1',
        title: 'Linear Algebra: Eigenvalues, Diagonalization & SVD',
        category: 'Mathematics',
        content: `# Eigenvalues and Matrix Decomposition\n\n## 1. Characteristic Equation\nFor square matrix $A \\in \\mathbb{R}^{n \\times n}$:\n$$\\det(A - \\lambda I) = 0$$\n\n## 2. Diagonalization\nIf $A$ has $n$ linearly independent eigenvectors:\n$$A = P D P^{-1}$$\n\n## 3. Singular Value Decomposition (SVD)\nFor any real matrix $A \\in \\mathbb{R}^{m \\times n}$:\n$$A = U \\Sigma V^T$$`,
        tags: ['linear-algebra', 'math', 'svd'],
        voice_memos: [],
        created_at: new Date(Date.now() - 108000000).toISOString(),
        updated_at: new Date(Date.now() - 10800000).toISOString()
      },
      {
        id: 'note_cs_1',
        title: 'Distributed Systems & Consensus: Raft vs Paxos',
        category: 'Computer Science',
        content: `# Distributed Consensus Protocols\n\n- **Raft**: Designed for understandability.\n  - Key roles: Leader, Follower, Candidate.\n  - Leader Election: Heartbeat timeout triggers election; majority vote required.\n  - Log Replication: Strong leader invariant guarantees committed entries are permanent.\n- **Paxos**: Classic multi-decree protocol; complex edge cases.`,
        tags: ['distributed-systems', 'cs', 'exam-prep'],
        voice_memos: [],
        created_at: new Date(Date.now() - 180000000).toISOString(),
        updated_at: new Date(Date.now() - 18000000).toISOString()
      },
      {
        id: 'note_med_1',
        title: 'Cardiovascular Pathology: Arrhythmias & ECG Markers',
        category: 'Medicine',
        content: `# High-Yield Cardiovascular Findings\n\n1. **Atrial Fibrillation**: Irregularly irregular rhythm, absence of distinct P waves.\n2. **Ventricular Tachycardia**: Broad QRS complexes (> 120ms), rapid rate 140-250 bpm.\n3. **Hyperkalemia Signs**: Tall peaked T-waves, PR interval prolongation.`,
        tags: ['usmle', 'cardiology', 'pathology'],
        voice_memos: [],
        created_at: new Date(Date.now() - 216000000).toISOString(),
        updated_at: new Date(Date.now() - 21600000).toISOString()
      },
      {
        id: 'note_law_1',
        title: 'Tort Law: Negligence & Duty of Care Principles',
        category: 'Law',
        content: `# Four Core Elements of Negligence\n\n1. **Duty of Care**: Established neighbor principle (*Donoghue v Stevenson*).\n2. **Breach**: Failure to meet the standard of the reasonable prudent person.\n3. **Causation**: 'But-for' factual test + legal remoteness.\n4. **Damages**: Actionable injury or compensable loss.`,
        tags: ['law', 'bar-exam', 'torts'],
        voice_memos: [],
        created_at: new Date(Date.now() - 252000000).toISOString(),
        updated_at: new Date(Date.now() - 25200000).toISOString()
      }
    ];
    saveNotes();
  }

  populateNoteImportDropdown();
}

/**
 * Fluid FLIP Animation Helper for smooth space-adjusting drag & drop
 */
function animateFLIP(container, domMutationFn) {
  const children = Array.from(container.children).filter(el => 
    el.style.display !== 'none' && 
    !el.classList.contains('note-drag-placeholder') && 
    !el.classList.contains('subject-drag-placeholder')
  );

  const firstPositions = new Map();
  children.forEach(child => {
    firstPositions.set(child, child.getBoundingClientRect());
  });

  domMutationFn();

  children.forEach(child => {
    const first = firstPositions.get(child);
    if (!first) return;
    const last = child.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;

    if (deltaX !== 0 || deltaY !== 0) {
      child.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      child.style.transition = 'none';

      requestAnimationFrame(() => {
        child.style.transform = '';
        child.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0, 1)';
      });
    }
  });
}

/**
 * Render Subject Square Tiles Grid
 */
export function renderSubjectTiles() {
  const container = document.getElementById('subjects-tiles-grid');
  const countBadge = document.getElementById('subject-count-badge');
  const query = (document.getElementById('subject-search-input')?.value || '').trim().toLowerCase();

  if (!container) return;

  const filtered = subjects.filter(s => s.name.toLowerCase().includes(query) || (s.description && s.description.toLowerCase().includes(query)));

  if (countBadge) {
    countBadge.textContent = query 
      ? `${filtered.length} of ${subjects.length} Subjects` 
      : `${subjects.length} Subjects`;
  }

  // Update batch bar state
  updateBatchBarUI();

  let html = '';

  filtered.forEach(subj => {
    const subjectNotes = notes.filter(n => n.category.toLowerCase() === subj.name.toLowerCase());
    const noteCount = subjectNotes.length;
    const previews = subjectNotes.slice(0, 2).map(n => escapeHtml(n.title)).join(' • ');

    html += `
      <div class="subject-square-tile" data-subject="${escapeHtml(subj.name)}">
        <div>
          <div class="subject-tile-header">
            <div class="subject-tile-icon">${subj.icon || '📚'}</div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="subject-tile-count">${noteCount} ${noteCount === 1 ? 'note' : 'notes'}</span>
              <button type="button" class="tile-delete-btn" data-subject="${escapeHtml(subj.name)}" title="Delete ${escapeHtml(subj.name)} tile">
                🗑️
              </button>
            </div>
          </div>
          <div class="subject-tile-title">${escapeHtml(subj.name)}</div>
          <div class="subject-tile-preview">${previews || escapeHtml(subj.description || 'No notes added yet.')}</div>
        </div>

        <div class="subject-tile-footer">
          <span>Open Notes ➔</span>
          <span style="font-family: var(--font-mono); opacity: 0.8;">${noteCount > 0 ? 'Active' : 'Empty'}</span>
        </div>
      </div>
    `;
  });

  // Dynamic creation tile as user types (only in normal view)
  if (query.length > 0 && !subjects.some(s => s.name.toLowerCase() === query)) {
    const suggestedEmoji = getSubjectEmoji(query);
    const capitalized = query.charAt(0).toUpperCase() + query.slice(1);

    html += `
      <div class="subject-square-tile" id="dynamic-create-subject-tile" style="border: 2px dashed var(--primary); background: var(--primary-light);">
        <div>
          <div class="subject-tile-header">
            <div class="subject-tile-icon" style="background: var(--bg-card);">${suggestedEmoji}</div>
            <span class="status-pill" style="background: var(--primary); color: white; border: none;">+ Create New</span>
          </div>
          <div class="subject-tile-title">Create "${escapeHtml(capitalized)}"</div>
          <div class="subject-tile-preview">Press Enter or click to create this subject and launch its workspace.</div>
        </div>

        <div class="subject-tile-footer" style="color: var(--primary); font-weight: 600;">
          <span>+ Create & Open ➔</span>
        </div>
      </div>
    `;
  }

  // "+ Add Subject" tile (only in normal view)
  html += `
    <div class="add-subject-tile" id="grid-add-subject-tile">
      <div class="add-subject-icon">+</div>
      <div style="font-weight: 600; font-size: 0.95rem;">New Subject Tile</div>
      <div style="font-size: 0.75rem; color: var(--text-muted);">Organize your study tracks</div>
    </div>
  `;

  container.innerHTML = html;

  // Bind clicks and fluid space-adjusting drag-drop on each subject tile
  container.querySelectorAll('.subject-square-tile[data-subject]').forEach(tile => {
    const subjectName = tile.dataset.subject;

    // Direct delete button click handler
    const deleteBtn = tile.querySelector('.tile-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSubjectWithConfirm(subjectName);
      });
    }

    // Pointer-based fluid drag-and-drop & click handler
    tile.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.tile-delete-btn')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const tileRect = tile.getBoundingClientRect();
      const grabOffsetX = startX - tileRect.left;
      const grabOffsetY = startY - tileRect.top;

      let isDragging = false;
      let avatar = null;
      let placeholder = null;

      function onPointerMove(moveEvent) {
        const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!isDragging && dist > 6) {
          isDragging = true;

          // Placeholder element occupies space in the grid
          placeholder = document.createElement('div');
          placeholder.className = 'subject-drag-placeholder';
          placeholder.style.width = `${tileRect.width}px`;
          placeholder.style.height = `${tileRect.height}px`;

          // Elevated avatar element following pointer
          avatar = tile.cloneNode(true);
          avatar.className = `${tile.className} tile-drag-avatar`;
          avatar.style.width = `${tileRect.width}px`;
          avatar.style.height = `${tileRect.height}px`;
          avatar.style.left = `${moveEvent.clientX - grabOffsetX}px`;
          avatar.style.top = `${moveEvent.clientY - grabOffsetY}px`;
          document.body.appendChild(avatar);

          tile.parentNode.insertBefore(placeholder, tile);
          tile.style.display = 'none';
          document.body.style.userSelect = 'none';
        }

        if (isDragging && avatar && placeholder) {
          avatar.style.left = `${moveEvent.clientX - grabOffsetX}px`;
          avatar.style.top = `${moveEvent.clientY - grabOffsetY}px`;

          // Find hovered sibling tile in grid
          const siblings = Array.from(container.querySelectorAll('.subject-square-tile[data-subject]')).filter(t => t !== tile && t.style.display !== 'none');

          for (const sibling of siblings) {
            const rect = sibling.getBoundingClientRect();
            if (
              moveEvent.clientX >= rect.left && 
              moveEvent.clientX <= rect.right && 
              moveEvent.clientY >= rect.top && 
              moveEvent.clientY <= rect.bottom
            ) {
              const isBefore = moveEvent.clientX < rect.left + rect.width / 2;
              const targetNode = isBefore ? sibling : sibling.nextSibling;

              if (placeholder.nextSibling !== targetNode && placeholder !== targetNode) {
                animateFLIP(container, () => {
                  container.insertBefore(placeholder, targetNode);
                });
              }
              break;
            }
          }
        }
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.body.style.userSelect = '';

        if (isDragging) {
          if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(tile, placeholder);
            placeholder.remove();
          }
          tile.style.display = '';
          if (avatar) avatar.remove();

          const reorderedNames = Array.from(container.querySelectorAll('.subject-square-tile[data-subject]'))
            .map(el => el.dataset.subject)
            .filter(Boolean);

          applyNewSubjectOrder(reorderedNames);
        } else {
          // Normal click without drag opens workspace
          openSubjectWorkspace(subjectName);
        }
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  });

  const dynamicTile = document.getElementById('dynamic-create-subject-tile');
  dynamicTile?.addEventListener('click', () => {
    const rawName = document.getElementById('subject-search-input')?.value.trim();
    if (rawName) {
      createAndOpenSubject(rawName);
    }
  });

  document.getElementById('grid-add-subject-tile')?.addEventListener('click', () => {
    document.getElementById('create-subject-modal')?.classList.add('open');
    document.getElementById('new-subject-name')?.focus();
  });
}

function updateBatchBarUI() {
  const batchBar = document.getElementById('subject-batch-bar');
  const manageBtn = document.getElementById('manage-subjects-btn');
  const countBadge = document.getElementById('selected-tiles-count-badge');
  const deleteSelectedBtn = document.getElementById('delete-selected-tiles-btn');

  if (batchBar) {
    batchBar.style.display = isTileSelectMode ? 'flex' : 'none';
  }
  if (manageBtn) {
    if (isTileSelectMode) {
      manageBtn.classList.add('active');
      manageBtn.textContent = '✕ Exit Selection';
    } else {
      manageBtn.classList.remove('active');
      manageBtn.textContent = '☑️ Select Tiles';
    }
  }
  if (countBadge) {
    countBadge.textContent = `${selectedSubjectNames.size} selected`;
  }
  if (deleteSelectedBtn) {
    deleteSelectedBtn.disabled = selectedSubjectNames.size === 0;
  }
}

function toggleSubjectSelection(subjectName) {
  if (selectedSubjectNames.has(subjectName)) {
    selectedSubjectNames.delete(subjectName);
  } else {
    selectedSubjectNames.add(subjectName);
  }
  renderSubjectTiles();
}

export function deleteSubjectWithConfirm(subjectName) {
  const norm = subjectName.toLowerCase();
  const associatedNotes = notes.filter(n => n.category.toLowerCase() === norm);
  const noteCountMsg = associatedNotes.length > 0 
    ? ` and its ${associatedNotes.length} associated note${associatedNotes.length === 1 ? '' : 's'}`
    : '';

  if (!confirm(`Are you sure you want to delete the "${subjectName}" subject${noteCountMsg}? This action cannot be undone.`)) {
    return;
  }

  deleteSubject(subjectName);
  if (toastFn) {
    toastFn(`Deleted subject "${subjectName}"`, 'info');
  }
}

export function deleteSubject(subjectName) {
  const norm = subjectName.toLowerCase();
  subjects = subjects.filter(s => s.name.toLowerCase() !== norm);
  localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));

  const removedNotes = notes.filter(n => n.category.toLowerCase() === norm);
  notes = notes.filter(n => n.category.toLowerCase() !== norm);

  removedNotes.forEach(n => {
    fetch(`/api/notes/${n.id}`, { method: 'DELETE' }).catch(() => {});
  });

  if (activeSubject && activeSubject.toLowerCase() === norm) {
    activeSubject = null;
    localStorage.removeItem('omnistudy_active_subject');
  }
  if (removedNotes.some(n => n.id === activeNoteId)) {
    activeNoteId = null;
  }

  selectedSubjectNames.delete(subjectName);
  saveNotes();
  if (noteChangeCallback) noteChangeCallback();
  renderSubjectTiles();
  window.dispatchEvent(new CustomEvent('omnistudy:subjects-updated'));
}

function deleteSelectedSubjects() {
  const count = selectedSubjectNames.size;
  if (count === 0) return;

  const names = Array.from(selectedSubjectNames);
  const namesSummary = names.length <= 4 
    ? names.join(', ') 
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} others`;

  const totalNotes = notes.filter(n => names.some(name => name.toLowerCase() === n.category.toLowerCase())).length;
  const noteCountMsg = totalNotes > 0 ? ` (and ${totalNotes} note${totalNotes === 1 ? '' : 's'})` : '';

  if (!confirm(`Are you sure you want to delete ${count} subject tile${count === 1 ? '' : 's'}: ${namesSummary}${noteCountMsg}? This action cannot be undone.`)) {
    return;
  }

  const normNames = new Set(names.map(n => n.toLowerCase()));

  // Remove subjects
  subjects = subjects.filter(s => !normNames.has(s.name.toLowerCase()));
  localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));

  // Remove notes
  const removedNotes = notes.filter(n => normNames.has(n.category.toLowerCase()));
  notes = notes.filter(n => !normNames.has(n.category.toLowerCase()));

  removedNotes.forEach(n => {
    fetch(`/api/notes/${n.id}`, { method: 'DELETE' }).catch(() => {});
  });

  if (activeSubject && normNames.has(activeSubject.toLowerCase())) {
    activeSubject = null;
    localStorage.removeItem('omnistudy_active_subject');
  }
  if (removedNotes.some(n => n.id === activeNoteId)) {
    activeNoteId = null;
  }

  selectedSubjectNames.clear();
  isTileSelectMode = false;

  saveNotes();
  if (noteChangeCallback) noteChangeCallback();
  renderSubjectTiles();

  if (toastFn) {
    toastFn(`Successfully deleted ${count} subject tile${count === 1 ? '' : 's'}`, 'success');
  }
}

function applyNewSubjectOrder(reorderedNames) {
  if (!reorderedNames || reorderedNames.length === 0) return;

  const subjectMap = new Map();
  subjects.forEach(s => subjectMap.set(s.name.toLowerCase(), s));

  const reordered = reorderedNames
    .map(name => subjectMap.get(name.toLowerCase()))
    .filter(Boolean);

  // Preserve any subjects not in the DOM
  subjects.forEach(s => {
    if (!reordered.some(r => r.name.toLowerCase() === s.name.toLowerCase())) {
      reordered.push(s);
    }
  });

  subjects = reordered;
  localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));
  renderSubjectTiles();
  if (toastFn) {
    toastFn('Subject tile order updated', 'info');
  }
}

function setupTileManagementControls() {
  const manageBtn = document.getElementById('manage-subjects-btn');
  const selectAllBtn = document.getElementById('select-all-tiles-btn');
  const deselectAllBtn = document.getElementById('deselect-all-tiles-btn');
  const deleteSelectedBtn = document.getElementById('delete-selected-tiles-btn');
  const cancelBtn = document.getElementById('cancel-select-tiles-btn');

  manageBtn?.addEventListener('click', () => {
    isTileSelectMode = !isTileSelectMode;
    if (!isTileSelectMode) {
      selectedSubjectNames.clear();
    }
    renderSubjectTiles();
  });

  selectAllBtn?.addEventListener('click', () => {
    const query = (document.getElementById('subject-search-input')?.value || '').trim().toLowerCase();
    const filtered = subjects.filter(s => s.name.toLowerCase().includes(query) || (s.description && s.description.toLowerCase().includes(query)));
    filtered.forEach(s => selectedSubjectNames.add(s.name));
    renderSubjectTiles();
  });

  deselectAllBtn?.addEventListener('click', () => {
    selectedSubjectNames.clear();
    renderSubjectTiles();
  });

  deleteSelectedBtn?.addEventListener('click', () => {
    deleteSelectedSubjects();
  });

  cancelBtn?.addEventListener('click', () => {
    isTileSelectMode = false;
    selectedSubjectNames.clear();
    renderSubjectTiles();
  });
}

/**
 * Switch view to Subject Workspace
 */
export function openSubjectWorkspace(subjectName) {
  activeSubject = subjectName;
  activeBranchFilter = null;
  localStorage.setItem('omnistudy_active_subject', subjectName);

  const subjObj = subjects.find(s => s.name.toLowerCase() === subjectName.toLowerCase());
  const icon = subjObj?.icon || getSubjectEmoji(subjectName);

  const headerElem = document.getElementById('active-subject-header-title');
  if (headerElem) {
    headerElem.innerHTML = `<span style="font-size: 1.2rem; margin-right: 4px;">${icon}</span> ${escapeHtml(subjectName)}`;
  }

  showWorkspaceView();
  renderBranchBar();

  const subjectNotes = notes.filter(n => n.category.toLowerCase() === subjectName.toLowerCase());

  if (subjectNotes.length > 0) {
    activeNoteId = subjectNotes[0].id;
    loadNoteIntoEditor(subjectNotes[0]);
  } else {
    const initialNote = {
      id: `note_${Date.now()}`,
      title: `${subjectName} Overview & Syllabus`,
      category: subjectName,
      branch: '',
      content: `# ${subjectName} Study Documentation\n\nWelcome to your ${subjectName} documentation hub.\n\n### Key Topics\n1. \n2. \n\n### Formula & Concept Bank\n- `,
      tags: [subjectName.toLowerCase().replace(/\s+/g, '-'), 'overview'],
      voice_memos: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    notes.unshift(initialNote);
    saveNotes();
    activeNoteId = initialNote.id;
    loadNoteIntoEditor(initialNote);
  }

  renderNotesList();
}

/**
 * Open specific note inside subject workspace (called from Brancher View)
 */
export function openNoteInWorkspace(subjectName, noteId = null) {
  if (!subjectName) return;

  const saved = localStorage.getItem('omnistudy_notes');
  if (saved) {
    try { notes = JSON.parse(saved); } catch {}
  }

  openSubjectWorkspace(subjectName);

  if (noteId) {
    const targetNote = notes.find(n => n.id === noteId);
    if (targetNote) {
      activeNoteId = noteId;
      loadNoteIntoEditor(targetNote);
      renderBranchBar();
      renderNotesList();
    }
  }
}

/**
 * Render Topic Branch Filter Bar inside Subject Workspace
 */
export function renderBranchBar() {
  const container = document.getElementById('subject-branch-pills');
  if (!container || !activeSubject) return;

  const subjectBranches = getBranchesForSubject(activeSubject);
  const subjectNotes = notes.filter(n => n.category.toLowerCase() === activeSubject.toLowerCase());

  const allCount = subjectNotes.length;
  const unbranchedCount = subjectNotes.filter(n => !n.branch).length;

  let html = `
    <button type="button" class="branch-pill-btn ${(!activeBranchFilter || activeBranchFilter === 'all') ? 'active' : ''}" data-branch="all">
      All <span class="pill-badge">${allCount}</span>
    </button>
  `;

  subjectBranches.forEach(b => {
    const count = subjectNotes.filter(n => (n.branch || '').toLowerCase() === b.name.toLowerCase()).length;
    const isAct = activeBranchFilter && activeBranchFilter.toLowerCase() === b.name.toLowerCase();
    html += `
      <button type="button" class="branch-pill-btn ${isAct ? 'active' : ''}" data-branch="${escapeHtml(b.name)}">
        <span class="pill-icon">${b.icon || '🌿'}</span>
        <span>${escapeHtml(b.name)}</span>
        <span class="pill-badge">${count}</span>
      </button>
    `;
  });

  if (unbranchedCount > 0 && subjectBranches.length > 0) {
    const isAct = activeBranchFilter === '__unbranched__';
    html += `
      <button type="button" class="branch-pill-btn ${isAct ? 'active' : ''}" data-branch="__unbranched__" title="Notes not assigned to a branch">
        <span>General</span>
        <span class="pill-badge">${unbranchedCount}</span>
      </button>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll('.branch-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = btn.dataset.branch;
      activeBranchFilter = (b === 'all') ? null : b;
      renderBranchBar();
      renderNotesList();
    });
  });
}

/**
 * Populate Branch dropdown selector in note editor
 */
function populateEditorBranchSelect(selectedBranchName = '') {
  const branchSelect = document.getElementById('note-edit-branch');
  if (!branchSelect || !activeSubject) return;

  const subjectBranches = getBranchesForSubject(activeSubject);
  let html = `<option value="">General (No Branch)</option>`;
  subjectBranches.forEach(b => {
    const isSelected = selectedBranchName && selectedBranchName.toLowerCase() === b.name.toLowerCase();
    html += `<option value="${escapeHtml(b.name)}" ${isSelected ? 'selected' : ''}>${b.icon || '🌿'} ${escapeHtml(b.name)}</option>`;
  });
  html += `<option value="__new_branch__">+ Add new branch...</option>`;
  branchSelect.innerHTML = html;
}

function showSubjectsView() {
  const subjectsContainer = document.getElementById('notes-subjects-container');
  const workspaceContainer = document.getElementById('notes-workspace-container');
  if (subjectsContainer) subjectsContainer.style.display = 'block';
  if (workspaceContainer) workspaceContainer.style.display = 'none';
}

function showWorkspaceView() {
  const subjectsContainer = document.getElementById('notes-subjects-container');
  const workspaceContainer = document.getElementById('notes-workspace-container');
  if (subjectsContainer) subjectsContainer.style.display = 'none';
  if (workspaceContainer) workspaceContainer.style.display = 'block';
}

function createAndOpenSubject(name, customEmoji = '', firstNoteTitle = '') {
  const cleanName = name.trim();
  if (!cleanName) return;

  let existing = subjects.find(s => s.name.toLowerCase() === cleanName.toLowerCase());
  if (!existing) {
    existing = {
      id: `subj_${Date.now()}`,
      name: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
      icon: customEmoji || getSubjectEmoji(cleanName),
      description: `Study documentation for ${cleanName}`,
      created_at: new Date().toISOString()
    };
    subjects.push(existing);
    localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));
  }

  const searchInput = document.getElementById('subject-search-input');
  if (searchInput) searchInput.value = '';

  if (firstNoteTitle) {
    const note = {
      id: `note_${Date.now()}`,
      title: firstNoteTitle,
      category: existing.name,
      content: `# ${firstNoteTitle}\n\n- \n- `,
      tags: [existing.name.toLowerCase().replace(/\s+/g, '-')],
      voice_memos: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    notes.unshift(note);
    saveNotes();
  }

  openSubjectWorkspace(existing.name);
}

function stripHtmlTags(str) {
  if (!str) return '';
  return str
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function renderVoiceChipHtml(memoId, dur = '00:08', title = 'Voice Note') {
  return `<span class="note-voice-chip" contenteditable="false" data-memo-id="${memoId}" data-dur="${dur}" data-title="${escapeHtml(title)}"><button type="button" class="note-voice-chip-mic" data-memo-id="${memoId}" data-dur="${dur}" data-title="${escapeHtml(title)}" title="Play ${escapeHtml(title)} (${dur})">🎙️</button><span class="note-voice-chip-dur">${dur}</span></span>&nbsp;`;
}

function formatToRichHtml(raw) {
  if (!raw) return '';

  let transformed = raw;
  // Convert legacy/plain voice memo lines to interactive chips if not already present
  if (!transformed.includes('note-voice-chip') && (transformed.includes('🎙️') || transformed.includes('<!-- id:voice_'))) {
    transformed = transformed.replace(/(?:🎙️|🔊|🎤)[^\n<]*(?:<!--\s*id:([a-zA-Z0-9_-]+)\s*-->)?/g, (match, memoId) => {
      let dur = '00:08';
      const durMatch = match.match(/\(?(\d{1,2}:\d{2})\)?/);
      if (durMatch) dur = durMatch[1];

      let title = 'Voice Note';
      const titleMatch = match.match(/—\s*\*([^*]+)\*/);
      if (titleMatch) title = titleMatch[1];
      else {
        const titleMatch2 = match.match(/—\s*([^\s<]+)/);
        if (titleMatch2) title = titleMatch2[1];
      }

      const id = memoId || `voice_${Date.now()}`;
      return renderVoiceChipHtml(id, dur, title);
    });
  }

  // If already contains HTML block tags, return as is
  if (/<(div|p|h[1-6]|ul|ol|li|br|b|i|u|mark)\b/i.test(transformed)) {
    return transformed;
  }

  // Otherwise, transform lines into rich HTML blocks
  const lines = transformed.split('\n');
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('### ')) {
      blocks.push(`<h3>${parseMarkdownInline(line.substring(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      blocks.push(`<h2>${parseMarkdownInline(line.substring(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      blocks.push(`<h1>${parseMarkdownInline(line.substring(2))}</h1>`);
    } else if (line.startsWith('- [ ] ')) {
      blocks.push(`<div class="note-todo-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" style="cursor: pointer;"> <span>${parseMarkdownInline(line.substring(6))}</span></div>`);
    } else if (line.startsWith('- [x] ')) {
      blocks.push(`<div class="note-todo-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0;"><input type="checkbox" checked style="cursor: pointer;"> <span>${parseMarkdownInline(line.substring(6))}</span></div>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push(`<div>• ${parseMarkdownInline(line.substring(2))}</div>`);
    } else if (line.startsWith('> ')) {
      blocks.push(`<blockquote style="border-left: 3px solid var(--accent); padding-left: 12px; margin: 6px 0; color: var(--text-muted);">${parseMarkdownInline(line.substring(2))}</blockquote>`);
    } else if (line.trim() === '') {
      blocks.push(`<div><br></div>`);
    } else {
      blocks.push(`<div>${parseMarkdownInline(line)}</div>`);
    }
  }

  return blocks.join('');
}

function renderNotesList() {
  const container = document.getElementById('notes-list-items');
  const search = document.getElementById('notes-search-input')?.value.toLowerCase() || '';

  if (!container || !activeSubject) return;

  const filtered = notes.filter(n => {
    const matchesSubject = n.category.toLowerCase() === activeSubject.toLowerCase();
    const matchesSearch = !search || 
      n.title.toLowerCase().includes(search) || 
      n.content.toLowerCase().includes(search) ||
      (n.branch && n.branch.toLowerCase().includes(search)) ||
      n.tags.some(t => t.toLowerCase().includes(search));

    let matchesBranch = true;
    if (activeBranchFilter && activeBranchFilter !== 'all') {
      if (activeBranchFilter === '__unbranched__') {
        matchesBranch = !n.branch;
      } else {
        matchesBranch = (n.branch || '').toLowerCase() === activeBranchFilter.toLowerCase();
      }
    }
    return matchesSubject && matchesSearch && matchesBranch;
  });

  if (filtered.length === 0) {
    const filterMsg = activeBranchFilter && activeBranchFilter !== 'all'
      ? ` in branch "${activeBranchFilter === '__unbranched__' ? 'General' : activeBranchFilter}"`
      : '';
    container.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.82rem; padding: 18px 12px; text-align: center;">
        No notes found${filterMsg} in ${escapeHtml(activeSubject)}. Click <strong>+ New Note</strong> to create one.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(n => `
    <div class="note-item-card ${n.id === activeNoteId ? 'active' : ''}" data-id="${n.id}">
      <div class="note-item-header">
        <div class="note-item-title">${escapeHtml(n.title)}</div>
        <span class="note-drag-handle" title="Drag to reposition">⠿</span>
      </div>
      <div class="note-item-snippet">${escapeHtml(stripHtmlTags(n.content).substring(0, 80))}</div>
      <div class="note-item-meta">
        <span class="note-tag-badge">${escapeHtml(n.category)}</span>
        ${n.branch ? `<span class="note-branch-badge" title="Topic Branch: ${escapeHtml(n.branch)}">🌿 ${escapeHtml(n.branch)}</span>` : ''}
        <span>${new Date(n.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.note-item-card').forEach(card => {
    const id = card.dataset.id;

    // Pointer-based fluid drag-and-drop & click handler
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, textarea, a')) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const cardRect = card.getBoundingClientRect();
      const grabOffsetX = startX - cardRect.left;
      const grabOffsetY = startY - cardRect.top;

      let isDragging = false;
      let avatar = null;
      let placeholder = null;

      function onPointerMove(moveEvent) {
        const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!isDragging && dist > 5) {
          isDragging = true;

          // Placeholder element occupies space in the list
          placeholder = document.createElement('div');
          placeholder.className = 'note-drag-placeholder';
          placeholder.style.width = `${cardRect.width}px`;
          placeholder.style.height = `${cardRect.height}px`;

          // Avatar follows pointer
          avatar = card.cloneNode(true);
          avatar.className = `${card.className} tile-drag-avatar`;
          avatar.style.width = `${cardRect.width}px`;
          avatar.style.height = `${cardRect.height}px`;
          avatar.style.left = `${moveEvent.clientX - grabOffsetX}px`;
          avatar.style.top = `${moveEvent.clientY - grabOffsetY}px`;
          document.body.appendChild(avatar);

          card.parentNode.insertBefore(placeholder, card);
          card.style.display = 'none';
          document.body.style.userSelect = 'none';
        }

        if (isDragging && avatar && placeholder) {
          avatar.style.left = `${moveEvent.clientX - grabOffsetX}px`;
          avatar.style.top = `${moveEvent.clientY - grabOffsetY}px`;

          // Find hovered sibling note item card
          const siblings = Array.from(container.querySelectorAll('.note-item-card')).filter(c => c !== card && c.style.display !== 'none');

          for (const sibling of siblings) {
            const rect = sibling.getBoundingClientRect();
            if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
              const isAbove = moveEvent.clientY < rect.top + rect.height / 2;
              const targetNode = isAbove ? sibling : sibling.nextSibling;

              if (placeholder.nextSibling !== targetNode && placeholder !== targetNode) {
                animateFLIP(container, () => {
                  container.insertBefore(placeholder, targetNode);
                });
              }
              break;
            }
          }
        }
      }

      function onPointerUp() {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        document.body.style.userSelect = '';

        if (isDragging) {
          if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(card, placeholder);
            placeholder.remove();
          }
          card.style.display = '';
          if (avatar) avatar.remove();

          const reorderedIds = Array.from(container.querySelectorAll('.note-item-card'))
            .map(el => el.dataset.id)
            .filter(Boolean);

          applyNewNoteOrder(reorderedIds);
        } else {
          // Normal click without drag opens note
          activeNoteId = id;
          renderNotesList();
          const note = notes.find(n => n.id === id);
          if (note) loadNoteIntoEditor(note);
        }
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });
  });
}

function applyNewNoteOrder(reorderedIds) {
  if (!reorderedIds || reorderedIds.length === 0 || !activeSubject) return;

  const subjectNotesMap = new Map();
  notes.forEach(n => {
    if (n.category.toLowerCase() === activeSubject.toLowerCase()) {
      subjectNotesMap.set(n.id, n);
    }
  });

  const orderedSubjectNotes = reorderedIds
    .map(id => subjectNotesMap.get(id))
    .filter(Boolean);

  let subjIdx = 0;
  notes = notes.map(n => {
    if (n.category.toLowerCase() === activeSubject.toLowerCase()) {
      const repl = orderedSubjectNotes[subjIdx] || n;
      subjIdx++;
      return repl;
    }
    return n;
  });

  saveNotes();
  renderNotesList();
  if (toastFn) {
    toastFn('Note order updated', 'info');
  }
}

function loadNoteIntoEditor(note) {
  activeNoteId = note.id;
  closeSlashMenu();

  // Stop any previous playing audio when switching notes
  if (activeMemoAudio) {
    activeMemoAudio.pause();
    activeMemoAudio = null;
    currentlyPlayingMemoId = null;
    hideInEditorAudioHUD();
  }

  const title = document.getElementById('note-edit-title');
  const category = document.getElementById('note-edit-category');
  const content = document.getElementById('note-edit-content');
  const tags = document.getElementById('note-edit-tags');

  if (title) title.value = note.title;
  if (category) category.value = note.category;
  if (content) {
    content.innerHTML = formatToRichHtml(note.content);
    content.scrollTop = 0;
    document.querySelector('.workspace-content')?.scrollTo({ top: 0 });
    updateToolbarButtonStates();
  }
  if (tags) tags.value = (note.tags || []).join(', ');

  populateEditorBranchSelect(note.branch || '');

  if (isNotePreviewMode) {
    renderNotePreview();
  }
}

function clearEditor() {
  closeSlashMenu();
  if (activeMemoAudio) {
    activeMemoAudio.pause();
    activeMemoAudio = null;
    currentlyPlayingMemoId = null;
    hideInEditorAudioHUD();
  }
  const title = document.getElementById('note-edit-title');
  const content = document.getElementById('note-edit-content');
  const tags = document.getElementById('note-edit-tags');
  const branchSelect = document.getElementById('note-edit-branch');
  if (title) title.value = '';
  if (content) content.innerHTML = '';
  if (tags) tags.value = '';
  if (branchSelect) branchSelect.value = '';

  const preview = document.getElementById('note-preview-content');
  if (preview) preview.innerHTML = '';
  updateToolbarButtonStates();
}

function triggerAutoSave(onNoteChange) {
  clearTimeout(saveTimeout);
  
  const statusElem = document.getElementById('save-status-text');
  if (statusElem) statusElem.textContent = 'Saving draft...';

  saveTimeout = setTimeout(() => {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    note.title = document.getElementById('note-edit-title')?.value || 'Untitled Note';
    
    const newCategory = document.getElementById('note-edit-category')?.value || activeSubject || 'General';
    if (newCategory && !subjects.some(s => s.name.toLowerCase() === newCategory.toLowerCase())) {
      subjects.push({
        id: `subj_${Date.now()}`,
        name: newCategory.trim(),
        icon: getSubjectEmoji(newCategory),
        description: `Notes for ${newCategory}`
      });
      localStorage.setItem('omnistudy_subjects', JSON.stringify(subjects));
    }
    note.category = newCategory;

    const branchVal = document.getElementById('note-edit-branch')?.value || '';
    if (branchVal !== '__new_branch__') {
      note.branch = branchVal;
    }

    const editor = document.getElementById('note-edit-content');
    note.content = editor ? editor.innerHTML : '';
    
    const tagsStr = document.getElementById('note-edit-tags')?.value || '';
    note.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    note.updated_at = new Date().toISOString();

    saveNotes();
    renderNotesList();

    if (statusElem) statusElem.textContent = 'Auto-saved just now';
    if (onNoteChange) onNoteChange();
  }, 350);
}

function saveNotes() {
  localStorage.setItem('omnistudy_notes', JSON.stringify(notes));
  saveState('notes_meta', { count: notes.length, lastUpdated: Date.now() });

  if (activeNoteId) {
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
      fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note)
      }).catch(() => {});
    }
  }

  populateNoteImportDropdown();
  window.dispatchEvent(new CustomEvent('omnistudy:notes-updated'));
}

function populateNoteImportDropdown() {
  const select = document.getElementById('pdf-note-import-select');
  if (!select) return;

  select.innerHTML = '<option value="">-- Choose Note to Import --</option>' +
    notes.map(n => `<option value="${n.id}">${escapeHtml(n.title)} (${n.category})</option>`).join('');
}

export function createNoteFromCreatorPost(creatorName, title, url) {
  const cat = 'General Notes';
  const newNote = {
    id: `note_${Date.now()}`,
    title: `Insights from ${creatorName}: ${title.substring(0, 45)}...`,
    category: cat,
    content: `# Key Insights from ${creatorName}\n\n**Source**: [${title}](${url})\n**Date Captured**: ${new Date().toLocaleDateString()}\n\n### Summary & Action Items\n- \n- \n\n### Study Questions\n1. \n2. `,
    tags: ['creator-insights', creatorName.toLowerCase().replace(/\s+/g, '-')],
    voice_memos: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  notes.unshift(newNote);
  saveNotes();
  openSubjectWorkspace(cat);
  activeNoteId = newNote.id;
  renderNotesList();
  loadNoteIntoEditor(newNote);
}

function getSubjectEmoji(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('phys')) return '⚛️';
  if (n.includes('math') || n.includes('calc') || n.includes('algebra') || n.includes('geom')) return '📐';
  if (n.includes('comp') || n.includes('code') || n.includes('cs') || n.includes('software') || n.includes('algo')) return '💻';
  if (n.includes('med') || n.includes('bio') || n.includes('path') || n.includes('anat') || n.includes('pharma')) return '🩺';
  if (n.includes('chem')) return '🧪';
  if (n.includes('law') || n.includes('legal') || n.includes('tort') || n.includes('court')) return '⚖️';
  if (n.includes('hist') || n.includes('lit') || n.includes('philosophy')) return '📜';
  if (n.includes('econ') || n.includes('finan') || n.includes('business') || n.includes('market')) return '📊';
  if (n.includes('lang') || n.includes('ling') || n.includes('french') || n.includes('spanish') || n.includes('german')) return '🗣️';
  if (n.includes('art') || n.includes('design') || n.includes('music')) return '🎨';
  if (n.includes('psych') || n.includes('neuro') || n.includes('cog')) return '🧠';
  if (n.includes('astro') || n.includes('space') || n.includes('cosmo')) return '🔭';
  if (n.includes('eng') || n.includes('mech') || n.includes('civil') || n.includes('robot')) return '⚙️';
  return '📚';
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
