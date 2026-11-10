/**
 * OmniStudy (ScholarFlow) Brancher Module
 * Obsidian-Style Multi-Mode Knowledge Hierarchy System
 * 
 * Supported Branching Modes:
 * 1. 🌿 Mind Map Tree: Horizontal organic tree with smooth cubic Bézier curve branches
 *    connecting Subjects ➔ Topic Branches ➔ Notes, with expand/collapse and inline fast adders.
 * 2. 🗂️ Column Flow: 4-column spatial hierarchy (Subjects ➔ Branches ➔ Notes ➔ Live Inspector).
 * 3. 🕸️ Force Graph: Interactive 60 FPS physics constellation with camera zoom/pan and node glowing.
 * 
 * High Reliability & Efficiency:
 * - Dual persistence (localStorage + SQLite /api/state)
 * - Two-Pass DOM layout with guaranteed non-overlapping tier columns
 * - Direct DOM element references preventing ID collisions
 * - Fast inline branch/note creation without full-screen modal friction
 * - Quick hover delete/rename actions on nodes
 * - Direct Subject ➔ Notes connection when no sub-branches exist (no dummy "General Notes")
 * - 100% Bidirectional Synchronization with Notes & Docs.
 */

import { saveState, loadState } from './storage.js';
import { switchView } from '../app.js';
import { openNoteInWorkspace, deleteSubjectWithConfirm } from './notes.js';

// Module State
let activeBranchStyle = localStorage.getItem('omnistudy_branch_style') || 'tree'; // 'tree' | 'columns' | 'graph'
let branches = [];
let subjects = [];
let notes = [];
let selectedSubjectFilter = 'all';
let searchQuery = '';
let toastFn = null;
let isModuleInitialized = false;
let renderTimer = null;

// Subject Theme Colors
const SUBJECT_COLORS = {
  physics: '#8b5cf6',           // Violet
  mathematics: '#3b82f6',       // Blue
  maths: '#3b82f6',
  'computer science': '#10b981',// Emerald
  cs: '#10b981',
  medicine: '#ef4444',          // Coral / Red
  law: '#f59e0b',               // Amber
  'general notes': '#a78bfa',
  default: '#8b5cf6'
};

// ============================================================================
// MIND MAP TREE STATE
// ============================================================================
let mmZoom = 1.0;
let mmPan = { x: 40, y: 40 };
let mmIsPanning = false;
let mmPanStart = { x: 0, y: 0 };
let mmCollapsed = new Set(); // Set of collapsed node keys/IDs

// ============================================================================
// COLUMN FLOW STATE
// ============================================================================
let colSelectedSubject = null;
let colSelectedBranchId = null;
let colSelectedNoteId = null;

// ============================================================================
// FORCE GRAPH STATE & SIMULATION PARAMETERS
// ============================================================================
let graphNodes = [];
let graphLinks = [];
let graphNodeMap = new Map();
let canvas = null;
let ctx = null;
let animFrameId = null;

let simParams = {
  linkDistance: 110,
  repulsion: 650,
  gravity: 0.04,
  friction: 0.88,
  alpha: 1.0,
  minAlpha: 0.002
};

let camera = {
  x: 0,
  y: 0,
  scale: 1.0,
  targetScale: 1.0
};

let isDraggingNode = null;
let isGraphPanning = false;
let graphPanStart = { x: 0, y: 0 };
let hoveredNode = null;
let showGraphSubjects = true;
let showGraphBranches = true;
let showGraphNotes = true;

/**
 * Debounced render scheduler to avoid redundant layout calculations
 */
function scheduleRender(resetFocus = false) {
  if (renderTimer) cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => {
    renderCurrentView(resetFocus);
  });
}

/**
 * Initialize the Brancher Module
 */
export function initBrancherModule(showToast) {
  toastFn = showToast;
  loadBranches();
  loadData();

  // Bind Top Header Controls (Style Switcher, Search, Subject Filter, Actions)
  bindHeaderControls();

  // Bind Mind Map Toolbar & Viewport Navigation
  bindMindMapEvents();

  // Bind Column Flow Actions
  bindColumnFlowEvents();

  // Bind Force Graph Canvas & HUD Controls
  bindForceGraphEvents();

  // Window resize handler
  window.addEventListener('resize', () => {
    if (activeBranchStyle === 'graph') {
      setupCanvasResize();
    } else if (activeBranchStyle === 'tree') {
      scheduleRender(false);
    }
  });

  // Listen to external workspace updates (Notes & Docs changes, Subject creation)
  window.addEventListener('omnistudy:notes-updated', () => {
    loadData();
    scheduleRender(false);
  });
  window.addEventListener('omnistudy:subjects-updated', () => {
    loadData();
    populateSubjectDropdown();
    scheduleRender(false);
  });
  window.addEventListener('omnistudy:branches-updated', () => {
    loadBranches();
    loadData();
    scheduleRender(false);
  });

  isModuleInitialized = true;
  switchBranchStyle(activeBranchStyle, false);
}

/**
 * Called when switching to view-brancher tab
 */
export function renderBrancherView() {
  if (!isModuleInitialized) {
    initBrancherModule(toastFn);
  }
  loadBranches();
  loadData();
  populateSubjectDropdown();
  renderCurrentView(true);
}

/**
 * Render the currently selected branching style
 */
function renderCurrentView(resetFocus = false) {
  if (activeBranchStyle === 'tree') {
    renderMindMapTree();
  } else if (activeBranchStyle === 'columns') {
    renderColumnBranching();
  } else if (activeBranchStyle === 'graph') {
    setupCanvasResize();
    rebuildGraph(resetFocus);
    wakePhysics();
  }
}

/**
 * Load subjects and notes with case-insensitive deduplication and normalization
 */
function loadData() {
  try {
    const s = localStorage.getItem('omnistudy_subjects');
    const raw = s ? JSON.parse(s) : [];

    // Deduplicate case-insensitively and filter empty entries
    const seen = new Set();
    subjects = [];
    raw.forEach(item => {
      const name = (item.name || '').trim();
      if (!name) return;
      const lower = name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        subjects.push({
          ...item,
          name: name
        });
      }
    });
  } catch {
    subjects = [];
  }

  if (!subjects || subjects.length === 0) {
    subjects = [
      { name: 'Physics', icon: '⚛️' },
      { name: 'Mathematics', icon: '📐' },
      { name: 'Computer Science', icon: '💻' },
      { name: 'Medicine', icon: '🩺' },
      { name: 'Law', icon: '⚖️' },
      { name: 'General Notes', icon: '📚' }
    ];
  }

  try {
    const n = localStorage.getItem('omnistudy_notes');
    notes = n ? JSON.parse(n) : [];
  } catch {
    notes = [];
  }
}

/**
 * Switch Active Branching Style
 */
export function switchBranchStyle(style, shouldReRender = true) {
  activeBranchStyle = style;
  localStorage.setItem('omnistudy_branch_style', style);

  // Update switcher button active state
  document.querySelectorAll('.branch-style-btn').forEach(btn => {
    if (btn.dataset.style === style) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle subview containers
  const treeView = document.getElementById('brancher-mindmap-view');
  const colsView = document.getElementById('brancher-columns-view');
  const graphView = document.getElementById('brancher-graph-view');

  if (treeView) treeView.style.display = style === 'tree' ? 'flex' : 'none';
  if (colsView) colsView.style.display = style === 'columns' ? 'flex' : 'none';
  if (graphView) graphView.style.display = style === 'graph' ? 'flex' : 'none';

  if (shouldReRender) {
    renderCurrentView(true);
  }
}

/**
 * Bind Header Controls (Top Bar)
 */
function bindHeaderControls() {
  // Style Switcher Buttons
  document.querySelectorAll('.branch-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.style;
      if (style) switchBranchStyle(style, true);
    });
  });

  // Global Subject Filter Dropdown
  const subjectSelect = document.getElementById('brancher-subject-filter');
  subjectSelect?.addEventListener('change', (e) => {
    selectedSubjectFilter = e.target.value;
    if (activeBranchStyle === 'columns') {
      if (selectedSubjectFilter !== 'all') {
        colSelectedSubject = selectedSubjectFilter;
        colSelectedBranchId = null;
        colSelectedNoteId = null;
      }
    }
    scheduleRender(false);
  });

  // Global Search Input
  const searchInput = document.getElementById('brancher-global-search');
  const clearBtn = document.getElementById('brancher-global-search-clear');

  searchInput?.addEventListener('input', (e) => {
    searchQuery = (e.target.value || '').trim();
    if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
    scheduleRender(false);
  });

  clearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    clearBtn.style.display = 'none';
    scheduleRender(false);
  });

  // Global Header "+ Add Branch" Button
  document.getElementById('brancher-global-add-branch-btn')?.addEventListener('click', () => {
    const subj = selectedSubjectFilter === 'all' ? (colSelectedSubject || subjects[0]?.name || 'Physics') : selectedSubjectFilter;
    openCreateBranchModal(subj);
  });

  // Global Header "+ Add Note" Button
  document.getElementById('brancher-global-add-note-btn')?.addEventListener('click', () => {
    const subj = selectedSubjectFilter === 'all' ? (colSelectedSubject || subjects[0]?.name || 'Physics') : selectedSubjectFilter;
    let brName = '';
    if (activeBranchStyle === 'columns' && colSelectedBranchId) {
      const b = branches.find(item => item.id === colSelectedBranchId);
      if (b) brName = b.name;
    }
    createNoteUnderBranch(subj, brName, '', true);
  });

  // Create Branch Form Submit in Modal
  const createBranchForm = document.getElementById('create-branch-form');
  createBranchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const subSel = document.getElementById('new-branch-subject');
    const nameInp = document.getElementById('new-branch-name');
    const descInp = document.getElementById('new-branch-description');
    const iconInp = document.getElementById('new-branch-icon');

    const subject = subSel?.value.trim();
    const name = nameInp?.value.trim();
    const desc = descInp?.value.trim() || '';
    const icon = iconInp?.value.trim() || '🌿';

    if (!subject || !name) return;

    const newBranch = addBranch(subject, name, desc, icon);
    if (newBranch) {
      if (toastFn) toastFn(`🌿 Created branch "${name}" under ${subject}!`);
      document.getElementById('create-branch-modal')?.classList.remove('open');
      createBranchForm.reset();
    }
  });

  // Close modals
  document.getElementById('create-branch-modal-close')?.addEventListener('click', () => {
    document.getElementById('create-branch-modal')?.classList.remove('open');
  });
  document.getElementById('brancher-note-preview-modal-close')?.addEventListener('click', () => {
    document.getElementById('brancher-note-preview-modal')?.classList.remove('open');
  });
}

/**
 * Populate Subject Filter Dropdown
 */
function populateSubjectDropdown() {
  const select = document.getElementById('brancher-subject-filter');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = `<option value="all">📚 All Subjects</option>` + subjects.map(s => `
    <option value="${escapeHtml(s.name)}" ${currentVal === s.name ? 'selected' : ''}>
      ${s.icon || '📚'} ${escapeHtml(s.name)}
    </option>
  `).join('');

  if (selectedSubjectFilter && selectedSubjectFilter !== 'all') {
    select.value = selectedSubjectFilter;
  }
}

// ============================================================================
// 1. MIND MAP TREE IMPLEMENTATION (Obsidian Markmind / Mindmap Style)
// ============================================================================

/**
 * Bind Mind Map Toolbar & Viewport Navigation
 */
function bindMindMapEvents() {
  const viewport = document.getElementById('mindmap-viewport');
  const plane = document.getElementById('mindmap-canvas-plane');

  // Zoom Buttons
  document.getElementById('mm-zoom-in-btn')?.addEventListener('click', () => {
    mmZoom = Math.min(2.5, mmZoom + 0.15);
    updateMindMapTransform();
  });
  document.getElementById('mm-zoom-out-btn')?.addEventListener('click', () => {
    mmZoom = Math.max(0.4, mmZoom - 0.15);
    updateMindMapTransform();
  });
  document.getElementById('mm-zoom-reset-btn')?.addEventListener('click', () => {
    mmZoom = 1.0;
    mmPan = { x: 40, y: 40 };
    updateMindMapTransform();
  });
  document.getElementById('mm-fit-btn')?.addEventListener('click', () => {
    fitMindMapToView();
  });

  // Expand / Collapse All
  document.getElementById('mm-expand-all-btn')?.addEventListener('click', () => {
    mmCollapsed.clear();
    scheduleRender(false);
  });
  document.getElementById('mm-collapse-all-btn')?.addEventListener('click', () => {
    branches.forEach(b => mmCollapsed.add(b.id));
    scheduleRender(false);
  });

  if (!viewport) return;

  // Viewport Panning
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mm-node') || e.target.closest('.mm-inline-creator') || e.target.closest('button') || e.target.closest('input')) return;
    // Dismiss any open inline creators
    document.querySelectorAll('.mm-inline-creator').forEach(c => c.remove());

    mmIsPanning = true;
    mmPanStart = { x: e.clientX - mmPan.x, y: e.clientY - mmPan.y };
    viewport.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!mmIsPanning) return;
    mmPan.x = e.clientX - mmPanStart.x;
    mmPan.y = e.clientY - mmPanStart.y;
    updateMindMapTransform();
  });

  window.addEventListener('mouseup', () => {
    if (mmIsPanning) {
      mmIsPanning = false;
      if (viewport) viewport.style.cursor = 'grab';
    }
  });

  // Wheel Zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const newZoom = Math.min(2.5, Math.max(0.35, mmZoom * zoomFactor));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom centered at mouse position
    mmPan.x = mouseX - (mouseX - mmPan.x) * (newZoom / mmZoom);
    mmPan.y = mouseY - (mouseY - mmPan.y) * (newZoom / mmZoom);
    mmZoom = newZoom;

    updateMindMapTransform();
  }, { passive: false });
}

function updateMindMapTransform() {
  const plane = document.getElementById('mindmap-canvas-plane');
  if (plane) {
    plane.style.transform = `translate(${mmPan.x}px, ${mmPan.y}px) scale(${mmZoom})`;
  }
}

function fitMindMapToView() {
  const viewport = document.getElementById('mindmap-viewport');
  const nodes = document.querySelectorAll('.mm-node');
  if (!viewport || nodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(node => {
    const x = parseFloat(node.style.left) || 0;
    const y = parseFloat(node.style.top) || 0;
    const w = node.offsetWidth || 180;
    const h = node.offsetHeight || 40;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  const totalW = maxX - minX + 140;
  const totalH = maxY - minY + 140;
  const viewW = viewport.clientWidth || 800;
  const viewH = viewport.clientHeight || 600;

  const scale = Math.min(1.2, Math.max(0.4, Math.min(viewW / totalW, viewH / totalH)));
  mmZoom = scale;
  mmPan.x = Math.max(20, (viewW - totalW * scale) / 2) - minX * scale;
  mmPan.y = Math.max(20, (viewH - totalH * scale) / 2) - minY * scale;
  updateMindMapTransform();
}

/**
 * Render Mind Map Tree (Robust Direct-Element Two-Pass Layout)
 */
export function renderMindMapTree() {
  const svg = document.getElementById('mindmap-svg');
  const container = document.getElementById('mindmap-nodes-container');
  if (!svg || !container) return;

  // Clear previous SVG and HTML nodes
  svg.innerHTML = '';
  container.innerHTML = '';

  // Filter subjects based on selection
  let displaySubjects = subjects;
  if (selectedSubjectFilter !== 'all') {
    displaySubjects = subjects.filter(s => s.name.toLowerCase() === selectedSubjectFilter.toLowerCase());
  }

  // Deduplicate displaySubjects case-insensitively
  const seenSub = new Set();
  displaySubjects = displaySubjects.filter(s => {
    const k = (s.name || '').trim().toLowerCase();
    if (!k || seenSub.has(k)) return false;
    seenSub.add(k);
    return true;
  });

  if (displaySubjects.length === 0) {
    container.innerHTML = `
      <div style="padding: 60px 40px; color: var(--text-muted); font-size: 0.95rem;">
        No subjects available. Create a subject in Notes & Docs or click "+ Add Branch" to begin!
      </div>
    `;
    return;
  }

  const query = searchQuery.toLowerCase();
  function doesMatch(text) {
    if (!query) return false;
    return (text || '').toLowerCase().includes(query);
  }

  // Vertical Layout Parameters
  const NOTE_ROW_HEIGHT = 44;
  const BRANCH_MIN_HEIGHT = 54;
  const BRANCH_GAP = 20;     // vertical clearance between sibling branches
  const SUBJECT_GAP = 55;    // vertical clearance between sibling subjects
  const TIER_CLEARANCE = 90; // minimum horizontal clearance between tiers

  let currentY = 40;
  let renderedSubjects = [];
  let renderedBranches = [];
  let renderedNotes = [];
  let allCurveDefs = [];
  let nodeMap = new Map();

  // Step 1: Compute hierarchy layout & vertical positions
  displaySubjects.forEach((sub, sIdx) => {
    const subKey = `sub_${sIdx}_${sub.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const subColor = getSubjectColor(sub.name);
    const isSubCollapsed = mmCollapsed.has(subKey);

    // Get branches belonging to this subject
    const subBranches = branches.filter(b => b.subject.toLowerCase() === sub.name.toLowerCase());

    // Also collect notes belonging to this subject
    const subNotes = notes.filter(n => n.category.toLowerCase() === sub.name.toLowerCase());

    // Notes with no branch or an unlisted branch
    const unbranchedNotes = subNotes.filter(n => {
      if (!n.branch) return true;
      return !subBranches.some(b => b.name.toLowerCase() === n.branch.toLowerCase());
    });

    const hasBranches = subBranches.length > 0;

    // Direct Subject ➔ Notes mode if subject has NO topic branches
    if (!hasBranches) {
      const directNotes = subNotes;
      const noteCount = isSubCollapsed ? 0 : directNotes.length;
      const height = isSubCollapsed ? 54 : Math.max(54, noteCount * NOTE_ROW_HEIGHT);

      const subjectY = currentY + (height / 2) - 22;

      const subNode = {
        type: 'subject',
        key: subKey,
        rawId: sub.id || subKey,
        name: sub.name,
        icon: sub.icon || '📚',
        color: subColor,
        y: Math.max(currentY, subjectY),
        branchCount: 0,
        noteCount: directNotes.length,
        isCollapsed: isSubCollapsed,
        isMatch: doesMatch(sub.name)
      };
      renderedSubjects.push(subNode);
      nodeMap.set(subKey, subNode);

      if (!isSubCollapsed && directNotes.length > 0) {
        const noteStartY = currentY + (height - directNotes.length * NOTE_ROW_HEIGHT) / 2;
        directNotes.forEach((note, nIdx) => {
          const noteKey = `note_${sIdx}_${note.id}`;
          const noteY = noteStartY + nIdx * NOTE_ROW_HEIGHT + 6;

          const noteNode = {
            type: 'note',
            key: noteKey,
            rawId: note.id,
            subject: sub.name,
            branchName: '',
            title: note.title || 'Untitled Note',
            tags: note.tags || [],
            y: noteY,
            isMatch: doesMatch(note.title) || doesMatch(note.content) || (note.tags || []).some(t => doesMatch(t))
          };
          renderedNotes.push(noteNode);
          nodeMap.set(noteKey, noteNode);

          allCurveDefs.push({
            fromKey: subKey,
            toKey: noteKey,
            color: subColor
          });
        });
      }

      currentY += height + SUBJECT_GAP;
      return;
    }

    // Has branches mode
    let branchList = [...subBranches];
    if (unbranchedNotes.length > 0) {
      branchList.push({
        id: `virtual_${sIdx}_unbranched`,
        subject: sub.name,
        name: 'General Notes',
        description: 'Uncategorized notes in this subject',
        icon: '📚',
        color: subColor,
        isVirtual: true
      });
    }

    if (isSubCollapsed) {
      const subNode = {
        type: 'subject',
        key: subKey,
        rawId: sub.id || subKey,
        name: sub.name,
        icon: sub.icon || '📚',
        color: subColor,
        y: currentY,
        branchCount: branchList.length,
        noteCount: subNotes.length,
        isCollapsed: true,
        isMatch: doesMatch(sub.name)
      };
      renderedSubjects.push(subNode);
      nodeMap.set(subKey, subNode);
      currentY += 80;
      return;
    }

    let branchLayouts = [];
    let subjectTotalHeight = 0;

    branchList.forEach((branch, bIdx) => {
      const branchKey = `branch_${sIdx}_${bIdx}_${branch.id}`;
      const isBranchCollapsed = mmCollapsed.has(branchKey) || mmCollapsed.has(branch.id);
      const branchNotes = branch.isVirtual 
        ? unbranchedNotes 
        : subNotes.filter(n => (n.branch || '').toLowerCase() === branch.name.toLowerCase());

      let branchHeight = BRANCH_MIN_HEIGHT;
      if (!isBranchCollapsed && branchNotes.length > 0) {
        branchHeight = Math.max(BRANCH_MIN_HEIGHT, branchNotes.length * NOTE_ROW_HEIGHT);
      }

      branchLayouts.push({
        branch,
        branchKey,
        notes: branchNotes,
        isCollapsed: isBranchCollapsed,
        height: branchHeight
      });

      subjectTotalHeight += branchHeight + BRANCH_GAP;
    });

    if (branchLayouts.length > 0) {
      subjectTotalHeight -= BRANCH_GAP;
    }

    const subjectY = currentY + (subjectTotalHeight / 2) - 22;

    const subNode = {
      type: 'subject',
      key: subKey,
      rawId: sub.id || subKey,
      name: sub.name,
      icon: sub.icon || '📚',
      color: subColor,
      y: Math.max(currentY, subjectY),
      branchCount: branchList.length,
      noteCount: subNotes.length,
      isCollapsed: false,
      isMatch: doesMatch(sub.name)
    };
    renderedSubjects.push(subNode);
    nodeMap.set(subKey, subNode);

    let branchCursorY = currentY;

    branchLayouts.forEach(layout => {
      const branch = layout.branch;
      const branchColor = branch.color || subColor;
      const branchY = branchCursorY + (layout.height / 2) - 19;

      const branchNode = {
        type: 'branch',
        key: layout.branchKey,
        rawId: branch.id,
        subject: sub.name,
        name: branch.name,
        icon: branch.icon || '🌿',
        color: branchColor,
        isVirtual: !!branch.isVirtual,
        y: branchY,
        noteCount: layout.notes.length,
        isCollapsed: layout.isCollapsed,
        isMatch: doesMatch(branch.name) || doesMatch(branch.description)
      };
      renderedBranches.push(branchNode);
      nodeMap.set(layout.branchKey, branchNode);

      allCurveDefs.push({
        fromKey: subKey,
        toKey: layout.branchKey,
        color: subColor
      });

      // Notes under this branch
      if (!layout.isCollapsed && layout.notes.length > 0) {
        const noteStartY = branchCursorY + (layout.height - layout.notes.length * NOTE_ROW_HEIGHT) / 2;

        layout.notes.forEach((note, nIdx) => {
          const noteKey = `note_${layout.branchKey}_${note.id}`;
          const noteY = noteStartY + nIdx * NOTE_ROW_HEIGHT + 6;

          const noteNode = {
            type: 'note',
            key: noteKey,
            rawId: note.id,
            subject: sub.name,
            branchName: branch.isVirtual ? '' : branch.name,
            title: note.title || 'Untitled Note',
            tags: note.tags || [],
            y: noteY,
            isMatch: doesMatch(note.title) || doesMatch(note.content) || (note.tags || []).some(t => doesMatch(t))
          };
          renderedNotes.push(noteNode);
          nodeMap.set(noteKey, noteNode);

          allCurveDefs.push({
            fromKey: layout.branchKey,
            toKey: noteKey,
            color: branchColor
          });
        });
      }

      branchCursorY += layout.height + BRANCH_GAP;
    });

    currentY = branchCursorY + SUBJECT_GAP;
  });

  // Step 2: Create DOM elements programmatically and attach to container
  const allNodes = [...renderedSubjects, ...renderedBranches, ...renderedNotes];

  allNodes.forEach(node => {
    const isDim = query && !node.isMatch;
    const matchClass = node.isMatch ? 'search-match' : '';
    const dimClass = isDim ? 'dimmed' : '';

    const el = document.createElement('div');
    el.className = `mm-node mm-node-${node.type} ${matchClass} ${dimClass}`;
    el.id = `mm-${node.key}`;
    el.style.top = `${node.y}px`;
    el.style.left = `0px`; // preliminary

    if (node.type === 'subject') {
      el.style.setProperty('--node-color', node.color);
      el.innerHTML = `
        <span class="mm-node-icon">${node.icon}</span>
        <span class="mm-node-title" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>
        <span class="mm-node-badge">${node.branchCount} br • ${node.noteCount} notes</span>
        <button type="button" class="mm-node-toggle" title="${node.isCollapsed ? 'Expand' : 'Collapse'}">${node.isCollapsed ? '+' : '−'}</button>
        <button type="button" class="mm-node-add" title="Add Branch under ${escapeHtml(node.name)}">+</button>
        <div class="mm-node-actions">
          <button type="button" class="mm-node-action-btn delete" title="Delete Subject" data-action="delete-subject">🗑️</button>
        </div>
      `;
    } else if (node.type === 'branch') {
      el.style.setProperty('--node-color', node.color);
      const isVirtual = node.isVirtual;
      el.innerHTML = `
        <span class="mm-node-icon">${node.icon}</span>
        <span class="mm-node-title" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>
        <span class="mm-node-badge">${node.noteCount}</span>
        <button type="button" class="mm-node-toggle" title="${node.isCollapsed ? 'Expand notes' : 'Collapse notes'}">${node.isCollapsed ? '+' : '−'}</button>
        <button type="button" class="mm-node-add" title="Add Note in ${escapeHtml(node.name)}">+</button>
        ${!isVirtual ? `
          <div class="mm-node-actions">
            <button type="button" class="mm-node-action-btn" title="Rename Branch" data-action="rename-branch">✏️</button>
            <button type="button" class="mm-node-action-btn delete" title="Delete Branch" data-action="delete-branch">🗑️</button>
          </div>
        ` : ''}
      `;
    } else if (node.type === 'note') {
      const tagChip = node.tags.length > 0 ? `<span class="col-note-tag-chip">#${escapeHtml(node.tags[0])}</span>` : '';
      el.innerHTML = `
        <span class="mm-node-icon">📝</span>
        <span class="mm-node-title" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</span>
        ${tagChip}
      `;
    }

    container.appendChild(el);
    node.el = el; // Direct reference!
  });

  // Step 3: Two-Pass DOM Measurement: Get true rendered dimensions directly from node.el
  let maxSubWidth = 260;
  renderedSubjects.forEach(s => {
    s.width = s.el.offsetWidth || 280;
    s.height = s.el.offsetHeight || 44;
    if (s.width > maxSubWidth) maxSubWidth = s.width;
  });

  let maxBranchWidth = 220;
  renderedBranches.forEach(b => {
    b.width = b.el.offsetWidth || 230;
    b.height = b.el.offsetHeight || 38;
    if (b.width > maxBranchWidth) maxBranchWidth = b.width;
  });

  let maxNoteWidth = 220;
  renderedNotes.forEach(n => {
    n.width = n.el.offsetWidth || 200;
    n.height = n.el.offsetHeight || 34;
    if (n.width > maxNoteWidth) maxNoteWidth = n.width;
  });

  // Step 4: Calculate Guaranteed Non-Overlapping Tier Columns
  const ROOT_X = 60;
  const hasAnyBranches = renderedBranches.length > 0;
  const BRANCH_X = ROOT_X + maxSubWidth + TIER_CLEARANCE;
  const NOTE_X = hasAnyBranches 
    ? BRANCH_X + maxBranchWidth + TIER_CLEARANCE 
    : ROOT_X + maxSubWidth + TIER_CLEARANCE;

  renderedSubjects.forEach(s => {
    s.x = ROOT_X;
    s.el.style.left = `${ROOT_X}px`;
  });

  renderedBranches.forEach(b => {
    b.x = BRANCH_X;
    b.el.style.left = `${BRANCH_X}px`;
  });

  renderedNotes.forEach(n => {
    n.x = NOTE_X;
    n.el.style.left = `${NOTE_X}px`;
  });

  // Step 5: Draw SVG Bézier Curves connecting exact node borders
  let svgPaths = '';
  allCurveDefs.forEach(c => {
    const sourceNode = nodeMap.get(c.fromKey);
    const targetNode = nodeMap.get(c.toKey);
    if (!sourceNode || !targetNode || !sourceNode.el || !targetNode.el) return;

    // x1 = exact right border of the source pill
    const x1 = sourceNode.x + sourceNode.width;
    // y1 = exact vertical middle of the source pill
    const y1 = sourceNode.y + sourceNode.height / 2;

    // x2 = exact left border of the target pill
    const x2 = targetNode.x;
    // y2 = exact vertical middle of the target pill
    const y2 = targetNode.y + targetNode.height / 2;

    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;

    const dx = Math.max(30, x2 - x1);
    const cp1x = x1 + dx * 0.45;
    const cp1y = y1;
    const cp2x = x1 + dx * 0.55;
    const cp2y = y2;

    const pathD = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    svgPaths += `
      <path d="${pathD}" class="mindmap-curve" 
            style="--curve-color: ${c.color}77" 
            data-from="${c.fromKey}" data-to="${c.toKey}" />
    `;
  });

  svg.innerHTML = svgPaths;

  // Set SVG canvas plane size
  const maxW = NOTE_X + maxNoteWidth + 140;
  const maxH = Math.max(currentY + 140, 1000);
  svg.setAttribute('width', maxW);
  svg.setAttribute('height', maxH);
  svg.style.width = `${maxW}px`;
  svg.style.height = `${maxH}px`;

  updateMindMapTransform();
  bindMindMapNodeEvents(renderedSubjects, renderedBranches, renderedNotes);
}

/**
 * Bind Click & Hover Events on Mind Map Node Cards
 */
function bindMindMapNodeEvents(renderedSubjects, renderedBranches, renderedNotes) {
  // 1. Note Cards
  renderedNotes.forEach(node => {
    node.el.addEventListener('click', (e) => {
      e.stopPropagation();
      switchView('view-notes');
      openNoteInWorkspace(node.subject, node.rawId);
    });

    node.el.addEventListener('mouseenter', () => {
      document.querySelectorAll(`path[data-to="${node.key}"]`).forEach(p => p.classList.add('highlighted'));
    });
    node.el.addEventListener('mouseleave', () => {
      document.querySelectorAll('.mindmap-curve.highlighted').forEach(p => p.classList.remove('highlighted'));
    });
  });

  // 2. Branch Cards
  renderedBranches.forEach(node => {
    // Toggle expand/collapse
    node.el.querySelector('.mm-node-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mmCollapsed.has(node.key) || mmCollapsed.has(node.rawId)) {
        mmCollapsed.delete(node.key);
        mmCollapsed.delete(node.rawId);
      } else {
        mmCollapsed.add(node.key);
        mmCollapsed.add(node.rawId);
      }
      scheduleRender(false);
    });

    // Quick Inline Add Note (+)
    node.el.querySelector('.mm-node-add')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showInlineNoteCreator(node.subject, node.name, node.el);
    });

    // Rename Branch
    node.el.querySelector('[data-action="rename-branch"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const newName = prompt(`Rename branch "${node.name}":`, node.name);
      if (newName && newName.trim() && newName.trim() !== node.name) {
        renameBranch(node.rawId, newName.trim());
      }
    });

    // Delete Branch
    node.el.querySelector('[data-action="delete-branch"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete branch "${node.name}"? Notes under it will remain in ${node.subject}.`)) {
        deleteBranch(node.rawId);
      }
    });

    node.el.addEventListener('mouseenter', () => {
      document.querySelectorAll(`path[data-to="${node.key}"], path[data-from="${node.key}"]`).forEach(p => p.classList.add('highlighted'));
    });
    node.el.addEventListener('mouseleave', () => {
      document.querySelectorAll('.mindmap-curve.highlighted').forEach(p => p.classList.remove('highlighted'));
    });
  });

  // 3. Subject Cards
  renderedSubjects.forEach(node => {
    // Toggle expand/collapse
    node.el.querySelector('.mm-node-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (mmCollapsed.has(node.key)) {
        mmCollapsed.delete(node.key);
      } else {
        mmCollapsed.add(node.key);
      }
      scheduleRender(false);
    });

    // Quick Inline Add Branch (+)
    node.el.querySelector('.mm-node-add')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showInlineBranchCreator(node.name, node.el);
    });

    // Delete Subject (Clean up test subjects like "C", "Cha", "Chap", "dsadf")
    node.el.querySelector('[data-action="delete-subject"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSubjectWithConfirm(node.name);
    });

    node.el.addEventListener('mouseenter', () => {
      document.querySelectorAll(`path[data-from="${node.key}"]`).forEach(p => p.classList.add('highlighted'));
    });
    node.el.addEventListener('mouseleave', () => {
      document.querySelectorAll('.mindmap-curve.highlighted').forEach(p => p.classList.remove('highlighted'));
    });
  });
}

/**
 * Fast Inline Branch Creator right on the Mind Map canvas
 */
function showInlineBranchCreator(subjectName, parentEl) {
  document.querySelectorAll('.mm-inline-creator').forEach(el => el.remove());

  const creator = document.createElement('div');
  creator.className = 'mm-inline-creator';
  const parentLeft = parseFloat(parentEl.style.left) || 60;
  const parentTop = parseFloat(parentEl.style.top) || 40;
  const parentWidth = parentEl.offsetWidth || 220;

  creator.style.left = `${parentLeft + parentWidth + 12}px`;
  creator.style.top = `${parentTop + 4}px`;

  creator.innerHTML = `
    <span style="font-size: 0.85rem;">🌿</span>
    <input type="text" class="mm-inline-input" placeholder="Branch name... (Enter to add)" autocomplete="off">
    <button type="button" class="mm-inline-btn" data-action="submit">Add</button>
    <button type="button" class="mm-inline-btn cancel" data-action="cancel">✕</button>
  `;

  parentEl.parentElement.appendChild(creator);
  const input = creator.querySelector('input');
  input?.focus();

  const submitBranch = () => {
    const val = input.value.trim();
    if (!val) {
      creator.remove();
      return;
    }
    addBranch(subjectName, val);
    creator.remove();
    if (toastFn) toastFn(`🌿 Added branch "${val}" to ${subjectName}!`);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitBranch();
    } else if (e.key === 'Escape') {
      creator.remove();
    }
  });

  creator.querySelector('[data-action="submit"]')?.addEventListener('click', submitBranch);
  creator.querySelector('[data-action="cancel"]')?.addEventListener('click', () => creator.remove());
}

/**
 * Fast Inline Note Creator right on the Mind Map canvas
 */
function showInlineNoteCreator(subjectName, branchName, parentEl) {
  document.querySelectorAll('.mm-inline-creator').forEach(el => el.remove());

  const creator = document.createElement('div');
  creator.className = 'mm-inline-creator';
  const parentLeft = parseFloat(parentEl.style.left) || 300;
  const parentTop = parseFloat(parentEl.style.top) || 40;
  const parentWidth = parentEl.offsetWidth || 200;

  creator.style.left = `${parentLeft + parentWidth + 12}px`;
  creator.style.top = `${parentTop + 4}px`;

  creator.innerHTML = `
    <span style="font-size: 0.85rem;">📝</span>
    <input type="text" class="mm-inline-input" placeholder="Note title... (Enter to add)" autocomplete="off">
    <button type="button" class="mm-inline-btn" data-action="submit">Add</button>
    <button type="button" class="mm-inline-btn cancel" data-action="cancel">✕</button>
  `;

  parentEl.parentElement.appendChild(creator);
  const input = creator.querySelector('input');
  input?.focus();

  const submitNote = () => {
    const val = input.value.trim();
    if (!val) {
      creator.remove();
      return;
    }
    // autoOpen: false -> stays in Brancher View!
    createNoteUnderBranch(subjectName, branchName, val, false);
    creator.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitNote();
    } else if (e.key === 'Escape') {
      creator.remove();
    }
  });

  creator.querySelector('[data-action="submit"]')?.addEventListener('click', submitNote);
  creator.querySelector('[data-action="cancel"]')?.addEventListener('click', () => creator.remove());
}

// ============================================================================
// 2. COLUMN FLOW IMPLEMENTATION (Obsidian Arbor / Gingko Style)
// ============================================================================

/**
 * Bind Column Flow Event Listeners
 */
function bindColumnFlowEvents() {
  // Column 2 Header: Add Branch
  document.getElementById('col-add-branch-btn')?.addEventListener('click', () => {
    const subj = colSelectedSubject || subjects[0]?.name || 'Physics';
    openCreateBranchModal(subj);
  });

  // Column 3 Header: Add Note
  document.getElementById('col-add-note-btn')?.addEventListener('click', () => {
    const subj = colSelectedSubject || subjects[0]?.name || 'Physics';
    let brName = '';
    if (colSelectedBranchId) {
      const b = branches.find(item => item.id === colSelectedBranchId);
      if (b) brName = b.name;
    }
    createNoteUnderBranch(subj, brName, '', false);
  });

  // Column 4 Inspector: Open in Editor
  document.getElementById('col-inspector-open-editor-btn')?.addEventListener('click', () => {
    if (!colSelectedNoteId) return;
    const note = notes.find(n => n.id === colSelectedNoteId);
    if (note) {
      switchView('view-notes');
      openNoteInWorkspace(note.category, note.id);
    }
  });
}

/**
 * Render Column Flow (4 Columns: Subjects ➔ Branches ➔ Notes ➔ Inspector)
 */
export function renderColumnBranching() {
  const colSubList = document.getElementById('col-subjects-list');
  const colBrList = document.getElementById('col-branches-list');
  const colNotesList = document.getElementById('col-notes-list');
  const colSubCount = document.getElementById('col-subjects-count');
  const colBrSublabel = document.getElementById('col-branches-sublabel');
  const colNotesSublabel = document.getElementById('col-notes-sublabel');

  if (!colSubList) return;

  // Ensure an active subject is selected
  if (!colSelectedSubject || !subjects.some(s => s.name.toLowerCase() === colSelectedSubject.toLowerCase())) {
    colSelectedSubject = subjects[0]?.name || 'Physics';
  }

  // --------------------------------------------------------------------------
  // COLUMN 1: SUBJECTS
  // --------------------------------------------------------------------------
  if (colSubCount) colSubCount.textContent = subjects.length;

  colSubList.innerHTML = subjects.map(s => {
    const isActive = s.name.toLowerCase() === colSelectedSubject.toLowerCase();
    const subBranches = branches.filter(b => b.subject.toLowerCase() === s.name.toLowerCase());
    const subNotes = notes.filter(n => n.category.toLowerCase() === s.name.toLowerCase());

    return `
      <div class="col-subject-card ${isActive ? 'active' : ''}" data-subject="${escapeHtml(s.name)}">
        <div class="col-subject-left">
          <span>${s.icon || '📚'}</span>
          <span>${escapeHtml(s.name)}</span>
        </div>
        <div class="col-subject-counts">
          <span>${subBranches.length} br</span> • <span>${subNotes.length} notes</span>
        </div>
      </div>
    `;
  }).join('');

  // Bind Column 1 Subject card clicks
  colSubList.querySelectorAll('.col-subject-card').forEach(card => {
    card.addEventListener('click', () => {
      colSelectedSubject = card.dataset.subject;
      colSelectedBranchId = null;
      colSelectedNoteId = null;
      renderColumnBranching();
    });
  });

  // --------------------------------------------------------------------------
  // COLUMN 2: BRANCHES under active subject
  // --------------------------------------------------------------------------
  if (colBrSublabel) colBrSublabel.textContent = `Under ${colSelectedSubject}`;

  const currentBranches = branches.filter(b => b.subject.toLowerCase() === colSelectedSubject.toLowerCase());
  const currentSubNotes = notes.filter(n => n.category.toLowerCase() === colSelectedSubject.toLowerCase());

  // Check if we should select the first branch
  if (!colSelectedBranchId && currentBranches.length > 0) {
    colSelectedBranchId = currentBranches[0].id;
  }

  if (currentBranches.length === 0) {
    colBrList.innerHTML = `
      <div style="padding: 30px 14px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
        <div style="font-size: 1.6rem; margin-bottom: 6px;">🌿</div>
        <div>No branches yet under <strong>${escapeHtml(colSelectedSubject)}</strong>.</div>
        <button type="button" class="btn-primary btn-xs" id="col-empty-add-branch-btn" style="margin-top: 10px;">+ Create First Branch</button>
      </div>
    `;
    document.getElementById('col-empty-add-branch-btn')?.addEventListener('click', () => {
      openCreateBranchModal(colSelectedSubject);
    });
  } else {
    colBrList.innerHTML = currentBranches.map(b => {
      const isActive = b.id === colSelectedBranchId;
      const bNotes = currentSubNotes.filter(n => (n.branch || '').toLowerCase() === b.name.toLowerCase());

      return `
        <div class="col-branch-card ${isActive ? 'active' : ''}" data-id="${b.id}" data-name="${escapeHtml(b.name)}">
          <div class="col-branch-card-header">
            <div class="col-branch-card-title">
              <span>${b.icon || '🌿'}</span>
              <span>${escapeHtml(b.name)}</span>
            </div>
            <div class="col-branch-actions">
              <button type="button" class="btn-icon col-branch-del-btn" title="Delete Branch" data-id="${b.id}" style="font-size: 0.72rem; padding: 2px;">🗑️</button>
            </div>
          </div>
          ${b.description ? `<div class="col-branch-desc">${escapeHtml(b.description)}</div>` : ''}
          <div class="col-branch-footer">
            <span>${bNotes.length} note${bNotes.length === 1 ? '' : 's'}</span>
            <span style="font-size: 0.68rem; color: var(--accent);">Active ➔</span>
          </div>
        </div>
      `;
    }).join('');

    // Bind Column 2 Branch clicks
    colBrList.querySelectorAll('.col-branch-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.col-branch-del-btn')) return;
        colSelectedBranchId = card.dataset.id;
        colSelectedNoteId = null;
        renderColumnBranching();
      });
    });

    // Bind Branch Delete buttons
    colBrList.querySelectorAll('.col-branch-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const branchId = btn.dataset.id;
        const b = branches.find(item => item.id === branchId);
        if (b && confirm(`Are you sure you want to delete branch "${b.name}"? Notes under this branch will be moved to General notes.`)) {
          deleteBranch(branchId);
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // COLUMN 3: NOTES under active branch
  // --------------------------------------------------------------------------
  const selectedBranch = branches.find(b => b.id === colSelectedBranchId);
  const activeBranchName = selectedBranch ? selectedBranch.name : '';

  if (colNotesSublabel) {
    colNotesSublabel.textContent = selectedBranch ? `In ${selectedBranch.name}` : 'All Subject Notes';
  }

  let branchNotes = [];
  if (selectedBranch) {
    branchNotes = currentSubNotes.filter(n => (n.branch || '').toLowerCase() === selectedBranch.name.toLowerCase());
  } else {
    branchNotes = currentSubNotes;
  }

  // If query is present, filter notes
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    branchNotes = branchNotes.filter(n => 
      (n.title || '').toLowerCase().includes(q) || 
      (n.content || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  // Auto-select first note if none selected
  if (!colSelectedNoteId && branchNotes.length > 0) {
    colSelectedNoteId = branchNotes[0].id;
  }

  if (branchNotes.length === 0) {
    colNotesList.innerHTML = `
      <div style="padding: 30px 14px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
        <div style="font-size: 1.6rem; margin-bottom: 6px;">📝</div>
        <div>No notes yet in ${selectedBranch ? `<strong>${escapeHtml(selectedBranch.name)}</strong>` : 'this branch'}.</div>
        <button type="button" class="btn-secondary btn-xs" id="col-empty-add-note-btn" style="margin-top: 10px;">+ Add Note</button>
      </div>
    `;
    document.getElementById('col-empty-add-note-btn')?.addEventListener('click', () => {
      createNoteUnderBranch(colSelectedSubject, activeBranchName, '', false);
    });
  } else {
    colNotesList.innerHTML = branchNotes.map(n => {
      const isActive = n.id === colSelectedNoteId;
      const snippet = (n.content || '').replace(/^[#\s\-*]+/gm, '').slice(0, 95);
      const firstTag = (n.tags && n.tags[0]) ? n.tags[0] : '';
      const dateStr = n.updated_at ? new Date(n.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

      return `
        <div class="col-note-card ${isActive ? 'active' : ''}" data-id="${n.id}">
          <div class="col-note-card-title">
            <span>📝</span>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.title || 'Untitled Note')}</span>
          </div>
          ${snippet ? `<div class="col-note-card-snippet">${escapeHtml(snippet)}...</div>` : ''}
          <div class="col-note-card-meta">
            <div class="col-note-tags">
              ${firstTag ? `<span class="col-note-tag-chip">#${escapeHtml(firstTag)}</span>` : ''}
            </div>
            <span>${dateStr}</span>
          </div>
        </div>
      `;
    }).join('');

    // Bind Column 3 Note clicks
    colNotesList.querySelectorAll('.col-note-card').forEach(card => {
      card.addEventListener('click', () => {
        colSelectedNoteId = card.dataset.id;
        renderColumnBranching();
      });
      // Double click opens directly in Notes & Docs workspace
      card.addEventListener('dblclick', () => {
        const nId = card.dataset.id;
        const note = notes.find(item => item.id === nId);
        if (note) {
          switchView('view-notes');
          openNoteInWorkspace(note.category, note.id);
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // COLUMN 4: NOTE INSPECTOR / QUICK PREVIEW
  // --------------------------------------------------------------------------
  renderInspector();
}

/**
 * Render Column 4: Note Inspector
 */
function renderInspector() {
  const container = document.getElementById('col-inspector-body');
  const openEditorBtn = document.getElementById('col-inspector-open-editor-btn');
  if (!container) return;

  const targetNote = notes.find(n => n.id === colSelectedNoteId);

  if (!targetNote) {
    if (openEditorBtn) openEditorBtn.style.display = 'none';
    container.innerHTML = `
      <div class="inspector-placeholder">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">📝</div>
        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">No note selected</div>
        <div style="font-size: 0.78rem; color: var(--text-secondary); max-width: 220px; line-height: 1.4;">
          Select any note from Column 3 to preview its contents and tags here.
        </div>
      </div>
    `;
    return;
  }

  if (openEditorBtn) openEditorBtn.style.display = 'inline-flex';

  const dateStr = targetNote.updated_at 
    ? new Date(targetNote.updated_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Recently';

  const tagsHtml = (targetNote.tags || []).map(t => `<span class="col-note-tag-chip">#${escapeHtml(t)}</span>`).join(' ');

  container.innerHTML = `
    <div class="inspector-view-container">
      <div class="inspector-title-row">
        <div class="inspector-meta-row">
          <span class="status-pill">${escapeHtml(targetNote.category)}</span>
          ${targetNote.branch ? `<span class="status-pill" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🌿 ${escapeHtml(targetNote.branch)}</span>` : ''}
          <span style="font-size: 0.7rem; color: var(--text-muted); margin-left: auto;">Updated ${dateStr}</span>
        </div>
        <h2 class="inspector-note-title">${escapeHtml(targetNote.title || 'Untitled Note')}</h2>
        ${tagsHtml ? `<div style="display: flex; gap: 4px; margin-top: 4px;">${tagsHtml}</div>` : ''}
      </div>

      <div class="inspector-content-box">${escapeHtml(targetNote.content || 'No text content in this note.')}</div>

      <button type="button" class="btn-primary" id="inspector-action-open-editor" style="width: 100%; margin-top: 6px;">
        ✏️ Open in Full Notes & Docs Editor
      </button>
    </div>
  `;

  document.getElementById('inspector-action-open-editor')?.addEventListener('click', () => {
    switchView('view-notes');
    openNoteInWorkspace(targetNote.category, targetNote.id);
  });
}

// ============================================================================
// 3. FORCE GRAPH VIEW IMPLEMENTATION (Obsidian Constellation)
// ============================================================================

function bindForceGraphEvents() {
  canvas = document.getElementById('brancher-graph-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  setupCanvasResize();
  bindGraphHUDControls();
  bindGraphCanvasEvents();
  startAnimationLoop();
}

function setupCanvasResize() {
  if (!canvas) return;
  const wrapper = document.getElementById('brancher-graph-wrapper');
  if (!wrapper) return;

  const rect = wrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || window.innerWidth - 260;
  const h = rect.height || window.innerHeight - 130;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  if (camera.x === 0 && camera.y === 0) {
    camera.x = w / 2;
    camera.y = h / 2;
  }
}

function bindGraphHUDControls() {
  // Zoom In / Out / Reset View
  document.getElementById('graph-zoom-in-btn')?.addEventListener('click', () => {
    camera.targetScale = Math.min(3.5, camera.targetScale * 1.3);
    wakePhysics();
  });
  document.getElementById('graph-zoom-out-btn')?.addEventListener('click', () => {
    camera.targetScale = Math.max(0.2, camera.targetScale / 1.3);
    wakePhysics();
  });
  document.getElementById('graph-center-btn')?.addEventListener('click', () => {
    fitGraphToView();
  });

  // Settings Drawer Toggle
  const drawer = document.getElementById('graph-settings-drawer');
  document.getElementById('graph-settings-toggle-btn')?.addEventListener('click', () => {
    if (!drawer) return;
    drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('graph-drawer-close-btn')?.addEventListener('click', () => {
    if (drawer) drawer.style.display = 'none';
  });

  // Checkbox filters
  document.getElementById('graph-show-subjects')?.addEventListener('change', (e) => {
    showGraphSubjects = e.target.checked;
    rebuildGraph(false);
  });
  document.getElementById('graph-show-branches')?.addEventListener('change', (e) => {
    showGraphBranches = e.target.checked;
    rebuildGraph(false);
  });
  document.getElementById('graph-show-notes')?.addEventListener('change', (e) => {
    showGraphNotes = e.target.checked;
    rebuildGraph(false);
  });

  // Physics Sliders
  document.getElementById('graph-link-dist-slider')?.addEventListener('input', (e) => {
    simParams.linkDistance = parseFloat(e.target.value) || 110;
    wakePhysics();
  });
  document.getElementById('graph-repulsion-slider')?.addEventListener('input', (e) => {
    simParams.repulsion = parseFloat(e.target.value) || 650;
    wakePhysics();
  });
  document.getElementById('graph-reset-physics-btn')?.addEventListener('click', () => {
    wakePhysics();
  });
}

function bindGraphCanvasEvents() {
  if (!canvas) return;

  canvas.addEventListener('mousedown', (e) => {
    const mousePos = getGraphMouseWorldPos(e);
    const clickedNode = findNodeAtPos(mousePos.x, mousePos.y);

    if (clickedNode) {
      isDraggingNode = clickedNode;
      clickedNode.isFixed = true;
      wakePhysics();
    } else {
      isGraphPanning = true;
      graphPanStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
      canvas.style.cursor = 'grabbing';
      hideNodeTooltip();
      hideBranchPopover();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (activeBranchStyle !== 'graph') return;
    const mousePos = getGraphMouseWorldPos(e);

    if (isDraggingNode) {
      isDraggingNode.x = mousePos.x;
      isDraggingNode.y = mousePos.y;
      isDraggingNode.vx = 0;
      isDraggingNode.vy = 0;
      wakePhysics();
      return;
    }

    if (isGraphPanning) {
      camera.x = e.clientX - graphPanStart.x;
      camera.y = e.clientY - graphPanStart.y;
      return;
    }

    // Hover detection
    const found = findNodeAtPos(mousePos.x, mousePos.y);
    if (found !== hoveredNode) {
      hoveredNode = found;
      if (hoveredNode) {
        showNodeTooltip(hoveredNode, e.clientX, e.clientY);
        canvas.style.cursor = 'pointer';
      } else {
        hideNodeTooltip();
        canvas.style.cursor = 'grab';
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingNode) {
      isDraggingNode.isFixed = false;
      isDraggingNode = null;
    }
    if (isGraphPanning) {
      isGraphPanning = false;
      if (canvas) canvas.style.cursor = 'grab';
    }
  });

  // Canvas Click
  canvas.addEventListener('click', (e) => {
    const mousePos = getGraphMouseWorldPos(e);
    const clicked = findNodeAtPos(mousePos.x, mousePos.y);

    if (clicked) {
      handleGraphNodeClick(clicked, e.clientX, e.clientY);
    }
  });

  // Wheel Zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const rect = canvas.getBoundingClientRect();
    const mouseScreenX = e.clientX - rect.left;
    const mouseScreenY = e.clientY - rect.top;

    const prevScale = camera.scale;
    const newScale = Math.min(3.5, Math.max(0.2, prevScale * zoomFactor));

    camera.x = mouseScreenX - (mouseScreenX - camera.x) * (newScale / prevScale);
    camera.y = mouseScreenY - (mouseScreenY - camera.y) * (newScale / prevScale);
    camera.scale = newScale;
    camera.targetScale = newScale;

    wakePhysics();
  }, { passive: false });
}

function handleGraphNodeClick(node, clientX, clientY) {
  if (node.type === 'note') {
    switchView('view-notes');
    openNoteInWorkspace(node.subject, node.noteId);
  } else if (node.type === 'branch') {
    showBranchPopover(node, clientX, clientY);
  } else if (node.type === 'subject') {
    switchView('view-notes');
    openNoteInWorkspace(node.name);
  }
}

function showNodeTooltip(node, clientX, clientY) {
  const tooltip = document.getElementById('graph-node-tooltip');
  const badge = document.getElementById('graph-tooltip-badge');
  const title = document.getElementById('graph-tooltip-title');
  const subtitle = document.getElementById('graph-tooltip-subtitle');
  const hint = document.getElementById('graph-tooltip-hint');
  if (!tooltip) return;

  if (node.type === 'subject') {
    badge.className = 'tooltip-badge badge-subject';
    badge.textContent = 'Subject Hub';
    title.textContent = `${node.icon || '📚'} ${node.name}`;
    subtitle.textContent = `${node.branchCount || 0} branches • ${node.noteCount || 0} notes`;
    hint.textContent = 'Click to open in Notes & Docs ➔';
  } else if (node.type === 'branch') {
    badge.className = 'tooltip-badge badge-branch';
    badge.textContent = 'Topic Branch';
    title.textContent = `${node.icon || '🌿'} ${node.name}`;
    subtitle.textContent = `Subject: ${node.subject} • ${node.noteCount || 0} notes`;
    hint.textContent = 'Click to manage branch or add notes ➔';
  } else if (node.type === 'note') {
    badge.className = 'tooltip-badge badge-note';
    badge.textContent = 'Note';
    title.textContent = `📝 ${node.name}`;
    subtitle.textContent = `${node.subject}${node.branchName ? ` • ${node.branchName}` : ''}`;
    hint.textContent = 'Click to open note in editor ➔';
  }

  tooltip.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  tooltip.style.left = `${Math.min(window.innerWidth - 300, clientX - rect.left + 15)}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 150, clientY - rect.top + 15)}px`;
}

function hideNodeTooltip() {
  const tooltip = document.getElementById('graph-node-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function showBranchPopover(node, clientX, clientY) {
  const popover = document.getElementById('graph-branch-popover');
  const title = document.getElementById('popover-branch-title');
  const icon = document.getElementById('popover-branch-icon');
  const addBtn = document.getElementById('popover-add-note-btn');
  const renameBtn = document.getElementById('popover-rename-branch-btn');
  const deleteBtn = document.getElementById('popover-delete-branch-btn');

  if (!popover) return;

  title.textContent = node.name;
  icon.textContent = node.icon || '🌿';

  addBtn.onclick = () => {
    createNoteUnderBranch(node.subject, node.name, '', true);
    popover.style.display = 'none';
  };

  renameBtn.onclick = () => {
    const newName = prompt(`Enter new name for branch "${node.name}":`, node.name);
    if (newName && newName.trim() && newName.trim() !== node.name) {
      renameBranch(node.branchId, newName.trim());
    }
    popover.style.display = 'none';
  };

  deleteBtn.onclick = () => {
    if (confirm(`Delete branch "${node.name}"? Notes under it will remain in ${node.subject}.`)) {
      deleteBranch(node.branchId);
    }
    popover.style.display = 'none';
  };

  popover.style.display = 'block';
  const rect = canvas.getBoundingClientRect();
  popover.style.left = `${Math.min(window.innerWidth - 260, clientX - rect.left + 15)}px`;
  popover.style.top = `${Math.min(window.innerHeight - 150, clientY - rect.top + 15)}px`;
}

function hideBranchPopover() {
  const popover = document.getElementById('graph-branch-popover');
  if (popover) popover.style.display = 'none';
}

function getGraphMouseWorldPos(e) {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  return {
    x: (screenX - camera.x) / camera.scale,
    y: (screenY - camera.y) / camera.scale
  };
}

function findNodeAtPos(worldX, worldY) {
  for (let i = graphNodes.length - 1; i >= 0; i--) {
    const node = graphNodes[i];
    const dx = node.x - worldX;
    const dy = node.y - worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= node.radius + 6) {
      return node;
    }
  }
  return null;
}

function wakePhysics() {
  simParams.alpha = 0.8;
}

/**
 * Rebuild Force Graph Nodes and Links
 */
function rebuildGraph(resetPositions = false) {
  graphNodes = [];
  graphLinks = [];
  graphNodeMap = new Map();

  const query = searchQuery.toLowerCase();

  // 1. Subject Hub Nodes
  subjects.forEach((sub, idx) => {
    if (!showGraphSubjects) return;
    if (selectedSubjectFilter !== 'all' && sub.name.toLowerCase() !== selectedSubjectFilter.toLowerCase()) {
      return;
    }

    const subId = `subject_${sub.name.toLowerCase()}`;
    const subBranches = branches.filter(b => b.subject.toLowerCase() === sub.name.toLowerCase());
    const subNotes = notes.filter(n => n.category.toLowerCase() === sub.name.toLowerCase());

    const angle = (idx / Math.max(1, subjects.length)) * Math.PI * 2;
    const radius = 180;

    const node = {
      id: subId,
      type: 'subject',
      name: sub.name,
      icon: sub.icon || '📚',
      color: getSubjectColor(sub.name),
      radius: 24,
      branchCount: subBranches.length,
      noteCount: subNotes.length,
      x: resetPositions ? Math.cos(angle) * radius : (graphNodeMap.get(subId)?.x || Math.cos(angle) * radius),
      y: resetPositions ? Math.sin(angle) * radius : (graphNodeMap.get(subId)?.y || Math.sin(angle) * radius),
      vx: 0,
      vy: 0,
      isMatch: query ? sub.name.toLowerCase().includes(query) : false
    };

    graphNodes.push(node);
    graphNodeMap.set(subId, node);
  });

  // 2. Topic Branch Nodes
  branches.forEach((branch, idx) => {
    if (!showGraphBranches) return;
    if (selectedSubjectFilter !== 'all' && branch.subject.toLowerCase() !== selectedSubjectFilter.toLowerCase()) {
      return;
    }

    const branchId = `branch_${branch.id}`;
    const subId = `subject_${branch.subject.toLowerCase()}`;
    const parentSubject = graphNodeMap.get(subId);

    const bNotes = notes.filter(n => 
      n.category.toLowerCase() === branch.subject.toLowerCase() &&
      (n.branch || '').toLowerCase() === branch.name.toLowerCase()
    );

    const angle = (idx / Math.max(1, branches.length)) * Math.PI * 2 + 0.3;
    const dist = 110;
    const parentX = parentSubject ? parentSubject.x : 0;
    const parentY = parentSubject ? parentSubject.y : 0;

    const node = {
      id: branchId,
      branchId: branch.id,
      type: 'branch',
      subject: branch.subject,
      name: branch.name,
      icon: branch.icon || '🌿',
      color: branch.color || getSubjectColor(branch.subject),
      radius: 17,
      noteCount: bNotes.length,
      x: resetPositions ? parentX + Math.cos(angle) * dist : (graphNodeMap.get(branchId)?.x || parentX + Math.cos(angle) * dist),
      y: resetPositions ? parentY + Math.sin(angle) * dist : (graphNodeMap.get(branchId)?.y || parentY + Math.sin(angle) * dist),
      vx: 0,
      vy: 0,
      isMatch: query ? (branch.name.toLowerCase().includes(query) || (branch.description || '').toLowerCase().includes(query)) : false
    };

    graphNodes.push(node);
    graphNodeMap.set(branchId, node);

    // Link Subject ➔ Branch
    if (parentSubject) {
      graphLinks.push({
        source: parentSubject,
        target: node,
        color: branch.color || parentSubject.color,
        length: simParams.linkDistance
      });
    }
  });

  // 3. Note Leaf Nodes
  notes.forEach((note, idx) => {
    if (!showGraphNotes) return;
    if (selectedSubjectFilter !== 'all' && note.category.toLowerCase() !== selectedSubjectFilter.toLowerCase()) {
      return;
    }

    const noteNodeId = `note_${note.id}`;
    const subId = `subject_${note.category.toLowerCase()}`;
    const parentSub = graphNodeMap.get(subId);

    let parentBranchNode = null;
    if (note.branch) {
      const bObj = branches.find(b => 
        b.subject.toLowerCase() === note.category.toLowerCase() && 
        b.name.toLowerCase() === note.branch.toLowerCase()
      );
      if (bObj) {
        parentBranchNode = graphNodeMap.get(`branch_${bObj.id}`);
      }
    }

    const parentNode = parentBranchNode || parentSub;
    if (!parentNode) return;

    const angle = (idx / Math.max(1, notes.length)) * Math.PI * 2;
    const dist = 70;

    const node = {
      id: noteNodeId,
      noteId: note.id,
      type: 'note',
      subject: note.category,
      branchName: note.branch || '',
      name: note.title || 'Untitled Note',
      radius: 9,
      x: resetPositions ? parentNode.x + Math.cos(angle) * dist : (graphNodeMap.get(noteNodeId)?.x || parentNode.x + Math.cos(angle) * dist),
      y: resetPositions ? parentNode.y + Math.sin(angle) * dist : (graphNodeMap.get(noteNodeId)?.y || parentNode.y + Math.sin(angle) * dist),
      vx: 0,
      vy: 0,
      isMatch: query ? (
        (note.title || '').toLowerCase().includes(query) ||
        (note.content || '').toLowerCase().includes(query) ||
        (note.tags || []).some(t => t.toLowerCase().includes(query))
      ) : false
    };

    graphNodes.push(node);
    graphNodeMap.set(noteNodeId, node);

    // Link Branch/Subject ➔ Note
    graphLinks.push({
      source: parentNode,
      target: node,
      color: parentNode.color,
      length: simParams.linkDistance * 0.75
    });
  });

  const badge = document.getElementById('graph-stats-badge');
  if (badge) badge.textContent = `${graphNodes.length} nodes`;

  wakePhysics();
}

/**
 * 60 FPS Physics Loop for Force Graph
 */
function startAnimationLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  function loop() {
    if (activeBranchStyle === 'graph') {
      stepPhysics();
      renderGraphCanvas();
    }
    animFrameId = requestAnimationFrame(loop);
  }

  animFrameId = requestAnimationFrame(loop);
}

function stepPhysics() {
  if (simParams.alpha < simParams.minAlpha) return;

  const alpha = simParams.alpha;

  // 1. Center gravity
  for (let i = 0; i < graphNodes.length; i++) {
    const n = graphNodes[i];
    if (n.isFixed) continue;
    n.vx -= n.x * simParams.gravity * alpha;
    n.vy -= n.y * simParams.gravity * alpha;
  }

  // 2. Node Repulsion (Coulomb force)
  for (let i = 0; i < graphNodes.length; i++) {
    const n1 = graphNodes[i];
    for (let j = i + 1; j < graphNodes.length; j++) {
      const n2 = graphNodes[j];
      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const distSq = dx * dx + dy * dy || 1;
      const dist = Math.sqrt(distSq);

      const force = (simParams.repulsion / distSq) * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!n1.isFixed) {
        n1.vx -= fx;
        n1.vy -= fy;
      }
      if (!n2.isFixed) {
        n2.vx += fx;
        n2.vy += fy;
      }
    }
  }

  // 3. Link Spring Attraction (Hooke's law)
  for (let i = 0; i < graphLinks.length; i++) {
    const link = graphLinks[i];
    const n1 = link.source;
    const n2 = link.target;

    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const targetDist = link.length;

    const delta = dist - targetDist;
    const force = delta * 0.05 * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    if (!n1.isFixed) {
      n1.vx += fx;
      n1.vy += fy;
    }
    if (!n2.isFixed) {
      n2.vx -= fx;
      n2.vy -= fy;
    }
  }

  // 4. Velocity integration & friction damping
  for (let i = 0; i < graphNodes.length; i++) {
    const n = graphNodes[i];
    if (!n.isFixed) {
      n.vx *= simParams.friction;
      n.vy *= simParams.friction;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  simParams.alpha *= 0.985;
}

function renderGraphCanvas() {
  if (!ctx || !canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Apply Camera transform
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.scale, camera.scale);

  // Draw Links
  for (let i = 0; i < graphLinks.length; i++) {
    const link = graphLinks[i];
    const isConn = hoveredNode && (link.source === hoveredNode || link.target === hoveredNode);

    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);

    if (isConn) {
      ctx.strokeStyle = link.color || '#a78bfa';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = link.color || '#a78bfa';
      ctx.shadowBlur = 10;
    } else {
      ctx.strokeStyle = hoveredNode ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.0;
      ctx.shadowBlur = 0;
    }

    ctx.stroke();
  }

  ctx.shadowBlur = 0;

  // Draw Nodes
  for (let i = 0; i < graphNodes.length; i++) {
    const node = graphNodes[i];
    const isHovered = node === hoveredNode;
    const isConn = hoveredNode && isNodeConnectedTo(node, hoveredNode);
    const isDimmed = hoveredNode && !isHovered && !isConn;

    ctx.save();
    ctx.translate(node.x, node.y);

    // Alpha / Dimming
    if (isDimmed) {
      ctx.globalAlpha = 0.2;
    } else {
      ctx.globalAlpha = 1.0;
    }

    // Node Circle
    ctx.beginPath();
    ctx.arc(0, 0, node.radius, 0, Math.PI * 2);

    if (node.type === 'subject') {
      ctx.fillStyle = node.color || '#8b5cf6';
      if (isHovered) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 24;
      }
    } else if (node.type === 'branch') {
      ctx.fillStyle = node.color || '#10b981';
      if (isHovered) {
        ctx.shadowColor = node.color;
        ctx.shadowBlur = 20;
      }
    } else {
      ctx.fillStyle = isHovered ? '#8b5cf6' : '#ececf1';
      if (isHovered) {
        ctx.shadowColor = '#8b5cf6';
        ctx.shadowBlur = 14;
      }
    }

    ctx.fill();

    // Node border stroke
    ctx.lineWidth = isHovered ? 2.5 : 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Node Label
    ctx.font = `${node.type === 'subject' ? 'bold 12px' : node.type === 'branch' ? '600 11px' : '500 10px'} system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const label = node.name.length > 20 ? node.name.slice(0, 18) + '...' : node.name;
    const labelY = node.radius + 5;

    // Label shadow for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(label, 0, labelY + 1);

    ctx.fillStyle = isHovered ? '#a78bfa' : '#ffffff';
    ctx.fillText(label, 0, labelY);

    ctx.restore();
  }

  ctx.restore();
}

function isNodeConnectedTo(n1, n2) {
  if (n1 === n2) return true;
  return graphLinks.some(l => 
    (l.source === n1 && l.target === n2) || 
    (l.source === n2 && l.target === n1)
  );
}

export function fitGraphToView() {
  if (graphNodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < graphNodes.length; i++) {
    const n = graphNodes[i];
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }

  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width / dpr) || 800;
  const h = (canvas.height / dpr) || 600;

  const totalW = maxX - minX + 200;
  const totalH = maxY - minY + 200;

  const scale = Math.min(1.5, Math.max(0.3, Math.min(w / totalW, h / totalH)));
  camera.scale = scale;
  camera.targetScale = scale;
  camera.x = w / 2 - ((minX + maxX) / 2) * scale;
  camera.y = h / 2 - ((minY + maxY) / 2) * scale;

  wakePhysics();
}

// ============================================================================
// SHARED CRUD & DATA SYNCHRONIZATION HELPERS
// ============================================================================

/**
 * Load branches from storage or seed initial default branches with dual-persistence
 */
export function loadBranches() {
  const saved = loadState('branches');
  if (saved && Array.isArray(saved) && saved.length > 0) {
    branches = saved;
  } else {
    try {
      const ls = localStorage.getItem('omnistudy_branches');
      if (ls) branches = JSON.parse(ls);
    } catch {
      branches = [];
    }
  }

  if (!branches || branches.length === 0) {
    branches = [
      {
        id: 'branch_phys_quantum',
        subject: 'Physics',
        name: 'Quantum Mechanics',
        description: 'Wave-particle duality, Schrödinger equation, observables & states',
        icon: '⚛️',
        color: '#8b5cf6',
        created_at: new Date().toISOString()
      },
      {
        id: 'branch_phys_em',
        subject: 'Physics',
        name: 'Electrodynamics',
        description: 'Maxwell equations, vector potentials, EM waves & propagation',
        icon: '⚡',
        color: '#06b6d4',
        created_at: new Date().toISOString()
      },
      {
        id: 'branch_math_la',
        subject: 'Mathematics',
        name: 'Linear Algebra',
        description: 'Vector spaces, eigenvalues, diagonalization & SVD',
        icon: '📐',
        color: '#3b82f6',
        created_at: new Date().toISOString()
      },
      {
        id: 'branch_cs_distrib',
        subject: 'Computer Science',
        name: 'Distributed Systems',
        description: 'Consensus protocols, Raft, Paxos & fault tolerance',
        icon: '💻',
        color: '#10b981',
        created_at: new Date().toISOString()
      },
      {
        id: 'branch_med_cardio',
        subject: 'Medicine',
        name: 'Cardiology & Pathology',
        description: 'Cardiovascular pathology, ECG arrhythmias & high-yield signs',
        icon: '🩺',
        color: '#ef4444',
        created_at: new Date().toISOString()
      },
      {
        id: 'branch_law_torts',
        subject: 'Law',
        name: 'Tort Law',
        description: 'Duty of care, negligence, breach, causation & damages',
        icon: '⚖️',
        color: '#f59e0b',
        created_at: new Date().toISOString()
      }
    ];
    saveBranches();
    assignInitialNoteBranches();
  }
}

function assignInitialNoteBranches() {
  const savedNotes = localStorage.getItem('omnistudy_notes');
  if (!savedNotes) return;
  try {
    const list = JSON.parse(savedNotes);
    let modified = false;
    list.forEach(n => {
      if (!n.branch) {
        if (n.id === 'note_phys_1' || (n.category === 'Physics' && n.title.toLowerCase().includes('quantum'))) {
          n.branch = 'Quantum Mechanics';
          modified = true;
        } else if (n.id === 'note_phys_2' || (n.category === 'Physics' && n.title.toLowerCase().includes('electro'))) {
          n.branch = 'Electrodynamics';
          modified = true;
        } else if (n.category === 'Mathematics' && (n.title.toLowerCase().includes('linear') || n.title.toLowerCase().includes('eigen'))) {
          n.branch = 'Linear Algebra';
          modified = true;
        } else if (n.category === 'Computer Science' && n.title.toLowerCase().includes('distributed')) {
          n.branch = 'Distributed Systems';
          modified = true;
        } else if (n.category === 'Medicine' && n.title.toLowerCase().includes('cardio')) {
          n.branch = 'Cardiology & Pathology';
          modified = true;
        } else if (n.category === 'Law' && n.title.toLowerCase().includes('tort')) {
          n.branch = 'Tort Law';
          modified = true;
        }
      }
    });
    if (modified) {
      localStorage.setItem('omnistudy_notes', JSON.stringify(list));
    }
  } catch {}
}

export function saveBranches() {
  saveState('branches', branches);
}

export function getBranches() {
  return branches;
}

export function getBranchesForSubject(subjectName) {
  if (!subjectName) return [];
  return branches.filter(b => b.subject.toLowerCase() === subjectName.toLowerCase());
}

export function addBranch(subject, name, description = '', icon = '🌿', color = '') {
  if (!subject || !name.trim()) return null;

  const id = `branch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const branchColor = color || getSubjectColor(subject);

  const newBranch = {
    id,
    subject: subject.trim(),
    name: name.trim(),
    description: description.trim(),
    icon: icon.trim() || '🌿',
    color: branchColor,
    created_at: new Date().toISOString()
  };

  branches.push(newBranch);
  saveBranches();

  window.dispatchEvent(new CustomEvent('omnistudy:branches-updated'));
  return newBranch;
}

export function deleteBranch(branchId) {
  const branch = branches.find(b => b.id === branchId);
  if (!branch) return;

  branches = branches.filter(b => b.id !== branchId);
  saveBranches();

  // Reset branch property on affected notes
  try {
    const savedNotes = localStorage.getItem('omnistudy_notes');
    if (savedNotes) {
      const list = JSON.parse(savedNotes);
      let updated = false;
      list.forEach(n => {
        if (n.category.toLowerCase() === branch.subject.toLowerCase() && n.branch === branch.name) {
          n.branch = '';
          updated = true;
        }
      });
      if (updated) {
        localStorage.setItem('omnistudy_notes', JSON.stringify(list));
        window.dispatchEvent(new CustomEvent('omnistudy:notes-updated'));
      }
    }
  } catch {}

  if (toastFn) toastFn(`Branch "${branch.name}" deleted.`, 'info');
  window.dispatchEvent(new CustomEvent('omnistudy:branches-updated'));
}

export function renameBranch(branchId, newName) {
  const branch = branches.find(b => b.id === branchId);
  if (!branch || !newName.trim()) return;

  const oldName = branch.name;
  branch.name = newName.trim();
  saveBranches();

  try {
    const savedNotes = localStorage.getItem('omnistudy_notes');
    if (savedNotes) {
      const list = JSON.parse(savedNotes);
      let updated = false;
      list.forEach(n => {
        if (n.category.toLowerCase() === branch.subject.toLowerCase() && n.branch === oldName) {
          n.branch = branch.name;
          updated = true;
        }
      });
      if (updated) {
        localStorage.setItem('omnistudy_notes', JSON.stringify(list));
        window.dispatchEvent(new CustomEvent('omnistudy:notes-updated'));
      }
    }
  } catch {}

  if (toastFn) toastFn(`Renamed branch to "${branch.name}".`);
  window.dispatchEvent(new CustomEvent('omnistudy:branches-updated'));
}

/**
 * Create a new note under a branch and optionally open in editor
 */
export function createNoteUnderBranch(subject, branchName, customTitle = '', autoOpen = false) {
  let noteList = [];
  try {
    const s = localStorage.getItem('omnistudy_notes');
    if (s) noteList = JSON.parse(s);
  } catch {}

  const defaultTitle = customTitle.trim() || (branchName 
    ? `Untitled ${branchName} Note` 
    : `Untitled ${subject} Note`);

  const newNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: defaultTitle,
    category: subject,
    branch: branchName || '',
    content: `# ${defaultTitle}\n\n- \n- `,
    tags: [
      subject.toLowerCase().replace(/\s+/g, '-'), 
      ...(branchName ? [branchName.toLowerCase().replace(/\s+/g, '-')] : [])
    ],
    voice_memos: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  noteList.unshift(newNote);
  localStorage.setItem('omnistudy_notes', JSON.stringify(noteList));

  fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newNote)
  }).catch(() => {});

  if (toastFn) {
    toastFn(`Created note "${newNote.title}" in ${branchName || subject}!`);
  }

  window.dispatchEvent(new CustomEvent('omnistudy:notes-updated'));

  if (autoOpen) {
    switchView('view-notes');
    openNoteInWorkspace(subject, newNote.id);
  }
  return newNote;
}

/**
 * Open Modal to Add a New Branch
 */
export function openCreateBranchModal(preselectedSubject = null) {
  const modal = document.getElementById('create-branch-modal');
  const subjectSelect = document.getElementById('new-branch-subject');
  const nameInput = document.getElementById('new-branch-name');
  const descInput = document.getElementById('new-branch-description');
  const iconInput = document.getElementById('new-branch-icon');

  if (!modal || !subjectSelect) return;

  let subjList = [];
  try {
    const s = localStorage.getItem('omnistudy_subjects');
    if (s) subjList = JSON.parse(s);
  } catch {}

  if (subjList.length === 0) {
    subjList = subjects;
  }

  // Deduplicate for dropdown
  const seen = new Set();
  const deduped = [];
  subjList.forEach(s => {
    const n = (s.name || '').trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      deduped.push(s);
    }
  });

  subjectSelect.innerHTML = deduped.map(s => `
    <option value="${escapeHtml(s.name)}" ${preselectedSubject && preselectedSubject.toLowerCase() === s.name.toLowerCase() ? 'selected' : ''}>
      ${s.icon || '📚'} ${escapeHtml(s.name)}
    </option>
  `).join('');

  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (iconInput) iconInput.value = '🌿';

  modal.classList.add('open');
  nameInput?.focus();
}

/**
 * Color and Text Utilities
 */
function getSubjectColor(subjectName) {
  const key = (subjectName || '').toLowerCase().trim();
  for (let k in SUBJECT_COLORS) {
    if (key.includes(k)) return SUBJECT_COLORS[k];
  }
  return SUBJECT_COLORS.default;
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
