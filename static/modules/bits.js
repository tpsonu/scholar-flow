/**
 * OmniStudy 'Bits' Module
 * Automatically extracts clear, concise, and chapter-wise bullet points
 * from Notes & Documents for rapid study, high-yield review, and exam prep.
 * Allows full inline user editing, adding custom points, deleting, and persistent saving.
 */

import { saveState, loadState } from './storage.js';
import { openNoteInWorkspace } from './notes.js';

let bitsData = [];
let activeSubjectFilter = 'all';
let searchQuery = '';
let toastFn = null;
let autoSaveTimer = null;

export function initBitsModule(showToast) {
  toastFn = showToast;
  loadBitsData();

  // If no bits exist yet, extract them automatically from notes on first launch
  if (!bitsData || bitsData.length === 0) {
    extractBitsFromNotes({ preserveUserEdits: false, silent: true });
  }

  // Bind Header Controls
  const refreshBtn = document.getElementById('bits-refresh-btn');
  const saveBtn = document.getElementById('bits-save-btn');
  const exportBtn = document.getElementById('bits-export-btn');
  const searchInput = document.getElementById('bits-search-input');

  refreshBtn?.addEventListener('click', () => {
    extractBitsFromNotes({ preserveUserEdits: true, silent: false });
    renderBitsView();
  });

  saveBtn?.addEventListener('click', () => {
    saveBitsData();
    showSaveNotification();
  });

  exportBtn?.addEventListener('click', () => {
    exportBitsAsMarkdown();
  });

  searchInput?.addEventListener('input', (e) => {
    searchQuery = (e.target.value || '').trim().toLowerCase();
    renderBitsList();
  });

  // Listen for note updates to prompt or update bits
  window.addEventListener('omnistudy:notes-updated', () => {
    // Keep bits in sync or offer update
    const banner = document.getElementById('bits-update-banner');
    if (banner) banner.style.display = 'flex';
  });

  // Render initial view
  renderBitsView();
}

/**
 * Load Bits from local storage / dual-persistence engine
 */
export function loadBitsData() {
  const saved = localStorage.getItem('omnistudy_bits');
  if (saved) {
    try {
      bitsData = JSON.parse(saved);
    } catch {
      bitsData = [];
    }
  } else {
    bitsData = [];
  }
}

/**
 * Save Bits to storage & background cloud sync
 */
export function saveBitsData() {
  try {
    localStorage.setItem('omnistudy_bits', JSON.stringify(bitsData));
    saveState('bits', bitsData);
    window.dispatchEvent(new CustomEvent('omnistudy:bits-updated'));
  } catch (err) {
    console.error('Failed to save bits:', err);
  }
}

function showSaveNotification() {
  if (toastFn) {
    toastFn('✓ All Bits and edits saved successfully!');
  } else {
    alert('✓ All Bits saved successfully!');
  }
  const saveStatus = document.getElementById('bits-save-status');
  if (saveStatus) {
    saveStatus.textContent = 'Saved just now';
    saveStatus.style.opacity = '1';
    setTimeout(() => {
      saveStatus.style.opacity = '0.6';
    }, 2500);
  }
}

/**
 * Intelligent Concept Extraction Engine:
 * Scans notes, parses chapters/headings, definitions, formulas, and core takeaways,
 * synthesizing clear, concise bullet points for each chapter.
 */
export function extractBitsFromNotes({ preserveUserEdits = true, silent = false } = {}) {
  const notesRaw = localStorage.getItem('omnistudy_notes');
  let notes = [];
  if (notesRaw) {
    try { notes = JSON.parse(notesRaw); } catch {}
  }

  if (!notes || notes.length === 0) {
    if (!silent && toastFn) toastFn('No notes found in workspace to extract Bits from.');
    return;
  }

  // Map of existing chapters to preserve custom user edits/additions
  const existingMap = new Map();
  if (preserveUserEdits && Array.isArray(bitsData)) {
    bitsData.forEach(ch => {
      existingMap.set(ch.chapterId, ch);
    });
  }

  const newBits = [];

  notes.forEach((note) => {
    const chapterId = note.id || ('note_' + Math.random().toString(36).substr(2, 9));
    const existingChapter = existingMap.get(chapterId);

    // If user edited this chapter previously and preserveUserEdits is on, keep custom points
    const customPoints = existingChapter ? existingChapter.points.filter(p => p.isCustom || p.edited) : [];

    // Extract auto-generated points from note content
    const extractedPoints = analyzeNoteContent(note.title, note.content || '');

    // Merge: custom user points first or combined with extracted points (avoiding duplicates)
    const combinedPoints = [...customPoints];
    const customTexts = new Set(customPoints.map(p => p.text.toLowerCase().trim()));

    extractedPoints.forEach(ep => {
      if (!customTexts.has(ep.text.toLowerCase().trim())) {
        // Check if previously marked as mastered
        const oldMatch = existingChapter?.points.find(p => p.text === ep.text);
        if (oldMatch) {
          ep.mastered = oldMatch.mastered;
        }
        combinedPoints.push(ep);
      }
    });

    newBits.push({
      chapterId: chapterId,
      noteId: note.id,
      title: note.title || 'Untitled Chapter',
      category: note.category || 'General',
      lastExtracted: new Date().toISOString(),
      points: combinedPoints
    });
  });

  bitsData = newBits;
  saveBitsData();

  if (!silent && toastFn) {
    const totalPoints = bitsData.reduce((acc, c) => acc + c.points.length, 0);
    toastFn(`✨ Extracted ${totalPoints} high-yield Bits across ${bitsData.length} chapters!`);
  }
}

/**
 * Analyzes markdown note content to extract high-yield concepts
 */
function analyzeNoteContent(title, content) {
  const points = [];
  const lines = content.split(/\r?\n/);

  let currentHeading = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Remove voice chip placeholders and comment tags
    line = line.replace(/🎙️[^\r\n]*/g, "").trim();
    line = line.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (!line) continue;

    // Detect Section / Chapter Headings
    if (line.startsWith("#")) {
      currentHeading = line.replace(/^#+\s*/, "").trim();
      continue;
    }

    // 1. Formula / Equation Detection
    if (line.includes("$") || line.includes("\\frac") || line.includes("\\nabla") || line.includes("\\lambda") || line.includes("c =") || line.includes("E =")) {
      const cleanFormula = line.replace(/\$\$/g, "").replace(/\$/g, "").trim();
      if (cleanFormula.length > 3 && cleanFormula.length < 180) {
        points.push({
          id: "point_" + Math.random().toString(36).substr(2, 9),
          type: "formula",
          badge: "⚡ Formula",
          text: (currentHeading ? "[" + currentHeading + "] " : "") + cleanFormula,
          mastered: false,
          isCustom: false
        });
        continue;
      }
    }

    // 2. Definition Detection (**Term**: Description or Term is defined as...)
    const defMatch = line.match(/^\*\*([^\*]+)\*\*\s*[:\-—]\s*(.+)$/);
    if (defMatch) {
      const term = defMatch[1].trim();
      const desc = defMatch[2].replace(/\*\*/g, "").trim();
      if (desc.length > 5 && desc.length < 240) {
        points.push({
          id: "point_" + Math.random().toString(36).substr(2, 9),
          type: "definition",
          badge: "💡 Definition",
          text: term + ": " + desc,
          mastered: false,
          isCustom: false
        });
        continue;
      }
    }

    // 3. Bullet Point Key Principles (- or * or numbered list)
    const listMatch = line.match(/^[-*•\d+.]\s*(.+)$/);
    if (listMatch) {
      let itemText = listMatch[1].replace(/\*\*/g, "").replace(/\*/g, "").trim();
      if (itemText.length > 15 && itemText.length < 260) {
        const isPrinciple = itemText.toLowerCase().includes("principle") || itemText.toLowerCase().includes("law") || itemText.toLowerCase().includes("rule") || itemText.toLowerCase().includes("must") || itemText.toLowerCase().includes("requires");
        points.push({
          id: "point_" + Math.random().toString(36).substr(2, 9),
          type: isPrinciple ? "principle" : "takeaway",
          badge: isPrinciple ? "📌 Principle" : "🎯 Takeaway",
          text: itemText,
          mastered: false,
          isCustom: false
        });
        continue;
      }
    }

    // 4. Standalone High-Yield sentences containing key knowledge triggers
    if (line.length > 25 && line.length < 220 && !line.startsWith("![")) {
      const triggers = ["fundamental", "critical", "essential", "primary", "key rule", "governed by", "distinguished by", "characterized by", "leads to", "result:"];
      if (triggers.some(t => line.toLowerCase().includes(t))) {
        points.push({
          id: "point_" + Math.random().toString(36).substr(2, 9),
          type: "takeaway",
          badge: "🎯 Takeaway",
          text: line.replace(/\*\*/g, "").trim(),
          mastered: false,
          isCustom: false
        });
      }
    }
  }

  // Fallback: If note had no structured bullets, extract the first 3 key sentences from paragraphs
  if (points.length === 0 && content.length > 20) {
    const sentences = content
      .replace(/#[^\r\n]*/g, "")
      .replace(/🎙️[^\r\n]*/g, "")
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 25 && s.length < 200);

    sentences.slice(0, 4).forEach((st) => {
      points.push({
        id: "point_" + Math.random().toString(36).substr(2, 9),
        type: "takeaway",
        badge: "🎯 Key Point",
        text: st,
        mastered: false,
        isCustom: false
      });
    });
  }

  // Limit to most relevant high-yield points (max 8 per chapter to maintain concise "Bits" philosophy)
  return points.slice(0, 8);
}

/**
 * Render the full Bits Workspace (stats, filters, and chapter cards)
 */
export function renderBitsView() {
  renderBitsStats();
  renderSubjectPills();
  renderBitsList();
}

/**
 * Render quick overview counters (Total Chapters, Total Bits, Mastered Bits)
 */
function renderBitsStats() {
  const totalChaptersElem = document.getElementById('bits-total-chapters');
  const totalPointsElem = document.getElementById('bits-total-points');
  const masteredPointsElem = document.getElementById('bits-mastered-points');

  const totalChapters = bitsData.length;
  let totalBits = 0;
  let masteredBits = 0;

  bitsData.forEach(ch => {
    ch.points.forEach(p => {
      totalBits++;
      if (p.mastered) masteredBits++;
    });
  });

  if (totalChaptersElem) totalChaptersElem.textContent = totalChapters;
  if (totalPointsElem) totalPointsElem.textContent = totalBits;
  if (masteredPointsElem) masteredPointsElem.textContent = masteredBits;
}

/**
 * Render Subject Filter Pills (All, Physics, Mathematics, CS, etc.)
 */
function renderSubjectPills() {
  const container = document.getElementById('bits-subject-pills');
  if (!container) return;

  // Extract unique subjects from bits
  const subjects = new Set(['all']);
  bitsData.forEach(ch => {
    if (ch.category) subjects.add(ch.category);
  });

  container.innerHTML = '';

  subjects.forEach(subj => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bits-pill-btn ${activeSubjectFilter.toLowerCase() === subj.toLowerCase() ? 'active' : ''}`;
    
    // Friendly name & icon
    const isAll = subj === 'all';
    btn.innerHTML = `
      <span>${isAll ? '🌟 All Chapters' : getSubjectIcon(subj) + ' ' + subj}</span>
      <span class="bits-pill-badge">${getSubjectBitsCount(subj)}</span>
    `;

    btn.addEventListener('click', () => {
      activeSubjectFilter = subj;
      renderSubjectPills();
      renderBitsList();
    });

    container.appendChild(btn);
  });
}

function getSubjectBitsCount(subj) {
  if (subj === 'all') {
    return bitsData.reduce((acc, c) => acc + c.points.length, 0);
  }
  return bitsData
    .filter(c => c.category && c.category.toLowerCase() === subj.toLowerCase())
    .reduce((acc, c) => acc + c.points.length, 0);
}

function getSubjectIcon(subj) {
  const s = (subj || '').toLowerCase();
  if (s.includes('phys')) return '⚛️';
  if (s.includes('math')) return '📐';
  if (s.includes('cs') || s.includes('comp')) return '💻';
  if (s.includes('med')) return '🩺';
  if (s.includes('law')) return '⚖️';
  return '📚';
}

/**
 * Render the filtered list of Chapter Cards with their editable bullet points
 */
function renderBitsList() {
  const container = document.getElementById('bits-cards-container');
  if (!container) return;

  let filtered = bitsData;

  // Apply Subject Filter
  if (activeSubjectFilter !== 'all') {
    filtered = filtered.filter(ch => ch.category && ch.category.toLowerCase() === activeSubjectFilter.toLowerCase());
  }

  // Apply Live Search Query
  if (searchQuery) {
    filtered = filtered.filter(ch => {
      const matchTitle = ch.title.toLowerCase().includes(searchQuery);
      const matchCategory = ch.category.toLowerCase().includes(searchQuery);
      const matchPoints = ch.points.some(p => p.text.toLowerCase().includes(searchQuery));
      return matchTitle || matchCategory || matchPoints;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="bits-empty-state">
        <div style="font-size: 2.8rem; margin-bottom: 10px;">💡</div>
        <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 6px;">No Bits Match Your Filter</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); max-width: 420px; margin-bottom: 16px;">
          ${searchQuery ? `No bullet points found for "${searchQuery}". Try adjusting your search term.` : 'Create notes in Notes & Docs or click "Extract / Refresh Bits" above to generate chapter summaries.'}
        </p>
        <button class="btn-primary" onclick="document.getElementById('bits-refresh-btn')?.click()">✨ Extract Bits from Notes</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  filtered.forEach(chapter => {
    const card = document.createElement('div');
    card.className = 'bits-chapter-card card';
    card.dataset.chapterId = chapter.chapterId;

    const subjectIcon = getSubjectIcon(chapter.category);

    card.innerHTML = `
      <div class="bits-chapter-header">
        <div class="bits-chapter-meta">
          <span class="badge bits-subject-badge">${subjectIcon} ${escapeHtml(chapter.category || 'General')}</span>
          <h2 class="bits-chapter-title">${escapeHtml(chapter.title)}</h2>
        </div>
        <div class="bits-chapter-actions">
          <button type="button" class="btn-secondary bits-action-btn open-note-btn" title="Open full note in Notes & Docs">
            📖 Open Note
          </button>
          <button type="button" class="btn-secondary bits-action-btn copy-chapter-btn" title="Copy chapter bullet points to clipboard">
            📋 Copy
          </button>
        </div>
      </div>

      <div class="bits-points-list"></div>

      <div class="bits-chapter-footer">
        <button type="button" class="btn-secondary bits-add-point-btn">
          <span>+ Add Key Point</span>
        </button>
        <span class="bits-count-indicator">${chapter.points.length} points</span>
      </div>
    `;

    // Populate points
    const pointsList = card.querySelector('.bits-points-list');
    chapter.points.forEach((point, pIdx) => {
      const pointRow = createPointElement(chapter, point, pIdx);
      pointsList.appendChild(pointRow);
    });

    // Wire Open Full Note button
    const openNoteBtn = card.querySelector('.open-note-btn');
    openNoteBtn?.addEventListener('click', () => {
      openNoteInWorkspace(chapter.category, chapter.noteId);
      // Switch view to notes
      document.querySelector('.nav-item[data-view="view-notes"]')?.click();
    });

    // Wire Copy Chapter button
    const copyBtn = card.querySelector('.copy-chapter-btn');
    copyBtn?.addEventListener('click', () => {
      copyChapterToClipboard(chapter);
    });

    // Wire Add Point button
    const addPointBtn = card.querySelector('.bits-add-point-btn');
    addPointBtn?.addEventListener('click', () => {
      addNewPointToChapter(chapter, pointsList);
    });

    container.appendChild(card);
  });
}

/**
 * Creates an editable bullet point item element
 */
function createPointElement(chapter, point, pIdx) {
  const row = document.createElement('div');
  row.className = `bit-point-item ${point.mastered ? 'mastered' : ''}`;
  row.dataset.pointId = point.id;

  const badgeClass = getBadgeClass(point.type);
  const badgeLabel = point.badge || getBadgeLabel(point.type);

  row.innerHTML = `
    <div class="bit-point-left">
      <input type="checkbox" class="bit-mastery-checkbox" title="Mark as reviewed / mastered" ${point.mastered ? 'checked' : ''}>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>
    <div class="bit-point-text" contenteditable="true" spellcheck="false" title="Click to edit this bullet point">${escapeHtml(point.text)}</div>
    <div class="bit-point-tools">
      <button type="button" class="bit-tool-btn bit-delete-btn" title="Delete this bullet point">✕</button>
    </div>
  `;

  const checkbox = row.querySelector('.bit-mastery-checkbox');
  const textElem = row.querySelector('.bit-point-text');
  const deleteBtn = row.querySelector('.bit-delete-btn');

  // Checkbox toggle
  checkbox?.addEventListener('change', () => {
    point.mastered = checkbox.checked;
    row.classList.toggle('mastered', point.mastered);
    renderBitsStats();
    scheduleAutoSave();
  });

  // Inline editing
  textElem?.addEventListener('input', () => {
    point.text = textElem.innerText.trim();
    point.edited = true;
    scheduleAutoSave();
  });

  // Delete point
  deleteBtn?.addEventListener('click', () => {
    chapter.points = chapter.points.filter(p => p.id !== point.id);
    row.remove();
    renderBitsStats();
    scheduleAutoSave();
    const countIndicator = row.closest('.bits-chapter-card')?.querySelector('.bits-count-indicator');
    if (countIndicator) countIndicator.textContent = `${chapter.points.length} points`;
  });

  return row;
}

/**
 * Append a new custom point to a chapter and focus its editable text
 */
function addNewPointToChapter(chapter, pointsList) {
  const newPoint = {
    id: 'point_' + Math.random().toString(36).substr(2, 9),
    type: 'takeaway',
    badge: '🎯 Key Point',
    text: 'New key concept point...',
    mastered: false,
    isCustom: true
  };

  chapter.points.push(newPoint);
  const row = createPointElement(chapter, newPoint, chapter.points.length - 1);
  pointsList.appendChild(row);

  renderBitsStats();
  scheduleAutoSave();

  const countIndicator = pointsList.closest('.bits-chapter-card')?.querySelector('.bits-count-indicator');
  if (countIndicator) countIndicator.textContent = `${chapter.points.length} points`;

  // Focus and select text for instant typing
  const textElem = row.querySelector('.bit-point-text');
  if (textElem) {
    textElem.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textElem);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * Debounced auto-save
 */
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  const saveStatus = document.getElementById('bits-save-status');
  if (saveStatus) {
    saveStatus.textContent = 'Saving edits...';
    saveStatus.style.opacity = '1';
  }

  autoSaveTimer = setTimeout(() => {
    saveBitsData();
    if (saveStatus) {
      saveStatus.textContent = 'Saved just now';
      setTimeout(() => { saveStatus.style.opacity = '0.6'; }, 2000);
    }
  }, 600);
}

/**
 * Copy chapter bullet points as formatted Markdown
 */
function copyChapterToClipboard(chapter) {
  let md = `# ${chapter.title} (${chapter.category}) - Key Bits

`;
  chapter.points.forEach(p => {
    const mark = p.mastered ? '[x]' : '[ ]';
    md += `- ${mark} **${p.badge}**: ${p.text}
`;
  });

  navigator.clipboard.writeText(md).then(() => {
    if (toastFn) toastFn(`✓ Copied ${chapter.points.length} Bits for "${chapter.title}" to clipboard!`);
  }).catch(() => {
    prompt('Copy Chapter Bits:', md);
  });
}

/**
 * Export all Bits across all chapters as a Markdown summary sheet
 */
function exportBitsAsMarkdown() {
  let fullMd = `# OmniStudy Bits: High-Yield Knowledge Synthesis
Generated: ${new Date().toLocaleDateString()} • Total Chapters: ${bitsData.length}

---

`;

  bitsData.forEach(ch => {
    fullMd += `## ${ch.title} [${ch.category}]

`;
    ch.points.forEach(p => {
      fullMd += `- **${p.badge}**: ${p.text}
`;
    });
    fullMd += "\n";
  });

  const blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `OmniStudy_Bits_Summary_${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);

  if (toastFn) toastFn('📑 Full Bits Study Summary downloaded!');
}

function getBadgeClass(type) {
  switch (type) {
    case 'formula': return 'badge-formula';
    case 'definition': return 'badge-definition';
    case 'principle': return 'badge-principle';
    case 'takeaway':
    default: return 'badge-takeaway';
  }
}

function getBadgeLabel(type) {
  switch (type) {
    case 'formula': return '⚡ Formula';
    case 'definition': return '💡 Definition';
    case 'principle': return '📌 Principle';
    case 'takeaway':
    default: return '🎯 Takeaway';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
