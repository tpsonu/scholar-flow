/**
 * OmniStudy Interactive Calendar & Audio Reminder Engine
 * - Monthly calendar grid & local date/time synchronizer
 * - Alerts when scheduled reminder time matches real computer system time
 * - Continuous Blinking Alert Pop-up positioned on the right side of the screen
 * - Cancel Pop-up option: turns off the pop-up without closing or cancelling the reminder
 * - Automatic Day-End Lifecycle Closure (at midnight / when scheduled day ends)
 * - User-initiated Reminder Closure & Status Management
 * - Live real-time computer clock ticker
 * - Web Audio API Synthesized chime sound
 */

let currentDate = new Date();
let selectedDate = new Date();
let reminders = [];
let activeAlertReminderId = null;
let isAlertPopupVisible = false;
let showToastRef = null;

export function initCalendarModule(showToastFn) {
  showToastRef = showToastFn;
  loadReminders();

  const prevMonthBtn = document.getElementById('cal-prev-month');
  const nextMonthBtn = document.getElementById('cal-next-month');
  const todayBtn = document.getElementById('cal-today-btn');
  const addReminderForm = document.getElementById('calendar-add-reminder-form');

  // Pop-up Alert Controls
  const popupCancelBtn = document.getElementById('reminder-popup-cancel-btn');
  const popupCloseX = document.getElementById('reminder-popup-close-x');
  const popupCloseBtn = document.getElementById('reminder-popup-close-btn');

  popupCancelBtn?.addEventListener('click', () => {
    dismissReminderAlertPopup(showToastRef);
  });

  popupCloseX?.addEventListener('click', () => {
    dismissReminderAlertPopup(showToastRef);
  });

  popupCloseBtn?.addEventListener('click', () => {
    if (activeAlertReminderId) {
      closeReminder(activeAlertReminderId, showToastRef);
    }
  });

  prevMonthBtn?.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendarGrid();
  });

  nextMonthBtn?.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendarGrid();
  });

  todayBtn?.addEventListener('click', () => {
    currentDate = new Date();
    selectedDate = new Date();
    renderCalendarGrid();
    renderRemindersList();
  });

  // Pre-fill reminder form with user's local date and upcoming default time (+ 5 mins)
  initReminderFormDefaults();

  addReminderForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const titleInput = document.getElementById('rem-title');
    const dateInput = document.getElementById('rem-date');
    const timeInput = document.getElementById('rem-time');
    const prioritySelect = document.getElementById('rem-priority');

    if (!titleInput.value.trim() || !dateInput.value || !timeInput.value) {
      alert('Please provide a title, date, and time for the reminder.');
      return;
    }

    const newReminder = {
      id: `rem_${Date.now()}`,
      title: titleInput.value.trim(),
      event_date: dateInput.value,
      event_time: timeInput.value,
      priority: prioritySelect.value,
      status: 'pending',
      alertFired: false,
      created_at: new Date().toISOString()
    };

    reminders.push(newReminder);
    saveReminders();
    renderCalendarGrid();
    renderRemindersList();

    titleInput.value = '';

    // Check if user set the reminder for the past/present minute or future
    const [y, m, d] = newReminder.event_date.split('-').map(Number);
    const [h, min] = newReminder.event_time.split(':').map(Number);
    const targetDate = new Date(y, m - 1, d, h, min, 0, 0);
    const now = Date.now();

    if (now >= targetDate.getTime()) {
      // If time is right now or already reached today, alert immediately!
      newReminder.alertFired = true;
      saveReminders();
      fireReminderAlert(newReminder, showToastRef);
    } else {
      // Future reminder: notify user that it will alert when their system time reaches it
      const diffMins = Math.max(1, Math.ceil((targetDate.getTime() - now) / 60000));
      const formattedTime = formatTime12Hour(newReminder.event_time);
      if (showToastRef) {
        showToastRef(`⏰ Reminder set for ${formattedTime}. It will alert when your system time reaches ${formattedTime} (in ~${diffMins} min${diffMins === 1 ? '' : 's'}).`);
      }
    }

    // Refresh default time for next reminder
    initReminderFormDefaults();
  });

  // Check auto-close for reminders whose day has already ended
  checkDayEndAutoClose(showToastRef);

  // Render initial grid and start live periodic reminder checker
  renderCalendarGrid();
  renderRemindersList();
  startReminderChecker(showToastRef);
}

function initReminderFormDefaults() {
  const dateInput = document.getElementById('rem-date');
  const timeInput = document.getElementById('rem-time');

  const now = new Date();
  if (dateInput) {
    dateInput.value = getLocalDateString(now);
  }

  if (timeInput) {
    // Default time is 5 minutes ahead of current computer time
    const future = new Date(now.getTime() + 5 * 60000);
    const hh = String(future.getHours()).padStart(2, '0');
    const mm = String(future.getMinutes()).padStart(2, '0');
    timeInput.value = `${hh}:${mm}`;
  }
}

function loadReminders() {
  const saved = localStorage.getItem('omnistudy_reminders');
  if (saved) {
    reminders = JSON.parse(saved);
  } else {
    // High-yield starter reminders
    const today = new Date();
    const d1 = new Date(today);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() + 2);
    const d3 = new Date(today);
    d3.setDate(d3.getDate() + 5);

    reminders = [
      {
        id: 'rem_1',
        title: 'Review LeetCode Dynamic Programming Patterns',
        event_date: getLocalDateString(d1),
        event_time: '23:30',
        priority: 'high',
        status: 'pending',
        alertFired: false
      },
      {
        id: 'rem_2',
        title: 'USMLE Step 2 Cardiology Vignettes Practice',
        event_date: getLocalDateString(d2),
        event_time: '14:00',
        priority: 'medium',
        status: 'pending',
        alertFired: false
      },
      {
        id: 'rem_3',
        title: 'Submit Research Grant & Passport Photo Docs',
        event_date: getLocalDateString(d3),
        event_time: '11:00',
        priority: 'high',
        status: 'pending',
        alertFired: false
      }
    ];
    saveReminders();
  }

  // Ensure day-ended reminders are marked closed
  checkDayEndAutoClose();
}

function saveReminders() {
  localStorage.setItem('omnistudy_reminders', JSON.stringify(reminders));
  
  // Background server sync
  fetch('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reminders[reminders.length - 1] || {})
  }).catch(() => {});
}

export function renderCalendarGrid() {
  const monthTitle = document.getElementById('cal-month-title');
  const daysGrid = document.getElementById('cal-days-grid');
  const dateInput = document.getElementById('rem-date');

  if (!monthTitle || !daysGrid) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  monthTitle.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  daysGrid.innerHTML = '';

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // Previous month trailing days
  for (let i = firstDay - 1; i >= 0; i--) {
    const dayNum = prevMonthTotalDays - i;
    const cell = createDayCell(dayNum, true, false, null);
    daysGrid.appendChild(cell);
  }

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = getLocalDateString(selectedDate) === dateStr;

    // Check if this date has any active/pending or closed reminders
    const dayReminders = reminders.filter(r => r.event_date === dateStr);

    const cell = createDayCell(d, false, false, isSelected, dayReminders, dateStr);
    daysGrid.appendChild(cell);
  }

  if (dateInput) {
    dateInput.value = getLocalDateString(selectedDate);
  }
}

function createDayCell(dayNum, isOtherMonth, isToday, isSelected, dayReminders = [], dateStr = '') {
  const cell = document.createElement('div');
  cell.className = `calendar-day-cell ${isOtherMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''}`;

  cell.innerHTML = `
    <div style="font-weight: 600;">${dayNum}</div>
    <div style="display: flex; gap: 3px; margin-top: 4px;">
      ${dayReminders.map(r => `<span class="day-event-dot" style="background: ${r.status === 'closed' ? 'var(--text-muted)' : getPriorityColor(r.priority)}"></span>`).join('')}
    </div>
  `;

  if (!isOtherMonth && dateStr) {
    cell.addEventListener('click', () => {
      const [y, m, d] = dateStr.split('-').map(Number);
      selectedDate = new Date(y, m - 1, d);
      renderCalendarGrid();
      renderRemindersList();
      const dateInput = document.getElementById('rem-date');
      if (dateInput) dateInput.value = dateStr;
    });
  }

  return cell;
}

function getPriorityColor(priority) {
  if (priority === 'high') return '#ef4444';
  if (priority === 'medium') return '#f59e0b';
  return '#10b981';
}

export function renderRemindersList() {
  const container = document.getElementById('reminders-list-container');
  if (!container) return;

  const selectedStr = getLocalDateString(selectedDate);
  const listTitle = document.getElementById('reminders-view-title');
  if (listTitle) {
    listTitle.textContent = `Reminders & Deadlines (${selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })})`;
  }

  const dayReminders = reminders.filter(r => r.event_date === selectedStr);

  if (dayReminders.length === 0) {
    container.innerHTML = '';
    return;
  }

  const now = Date.now();

  container.innerHTML = dayReminders.map(r => {
    const isSelected = r.id === activeAlertReminderId && isAlertPopupVisible;
    const isClosed = r.status === 'closed' || r.status === 'completed';

    // Calculate timing status relative to system clock
    const [y, m, d] = r.event_date.split('-').map(Number);
    const [h, min] = r.event_time.split(':').map(Number);
    const targetDate = new Date(y, m - 1, d, h, min, 0, 0);
    const isDue = now >= targetDate.getTime();
    const diffMins = Math.ceil((targetDate.getTime() - now) / 60000);

    let timingBadge = '';
    if (isClosed) {
      timingBadge = `<span class="status-pill" style="background: var(--border); color: var(--text-muted); font-size: 0.68rem; padding: 1px 6px;">${r.closedReason === 'day_ended' ? 'Day Ended' : 'Closed'}</span>`;
    } else if (isSelected) {
      timingBadge = `<span class="status-pill" style="background: #ef444425; color: #ef4444; border: 1px solid #ef444480; font-size: 0.68rem; padding: 1px 6px; animation: badge-blink-flash 0.9s infinite;">🔔 Alerting on Screen</span>`;
    } else if (isDue) {
      timingBadge = `<span class="status-pill" style="background: #ef444420; color: #ef4444; border: 1px solid #ef444450; font-size: 0.68rem; padding: 1px 6px;">⏰ Time Reached</span>`;
    } else {
      timingBadge = `<span class="status-pill" style="background: rgba(124, 58, 237, 0.15); color: var(--accent); border: 1px solid rgba(124, 58, 237, 0.3); font-size: 0.68rem; padding: 1px 6px;">Due in ${diffMins} min${diffMins === 1 ? '' : 's'}</span>`;
    }

    return `
      <div class="reminder-card priority-${r.priority} ${isSelected ? 'selected' : ''} ${isClosed ? 'status-closed' : ''}" data-id="${r.id}">
        <div style="flex: 1; padding-right: 8px;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <div style="font-weight: 600; font-size: 0.94rem; text-decoration: ${isClosed ? 'line-through' : 'none'};">
              ${escapeHtml(r.title)}
            </div>
            ${timingBadge}
          </div>
          <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 3px;">
            🕒 <strong>${formatTime12Hour(r.event_time)}</strong> (${r.event_time}) • 
            <span style="text-transform: capitalize; color: ${getPriorityColor(r.priority)}; font-weight: 600;">${r.priority} Priority</span>
            ${!isClosed ? ' • <span style="color: var(--accent); font-size: 0.7rem;">Auto-closes when day ends</span>' : ''}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="btn-icon rem-select-btn" data-id="${r.id}" title="${isSelected ? 'Alerting currently' : 'Test / View Alert Pop-up'}">
            🔔
          </button>
          <button class="btn-icon rem-toggle-close" data-id="${r.id}" title="${isClosed ? 'Reopen Reminder' : 'Close Reminder'}">
            ${isClosed ? '↩️' : '✓'}
          </button>
          <button class="btn-icon rem-delete" data-id="${r.id}" title="Delete" style="color: #ef4444;">✕</button>
        </div>
      </div>
    `;
  }).join('');

  // Card click: informs user or shows alert if already due
  container.querySelectorAll('.reminder-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.rem-select-btn') || e.target.closest('.rem-toggle-close') || e.target.closest('.rem-delete')) {
        return;
      }
      const id = card.dataset.id;
      const rem = reminders.find(r => r.id === id);
      if (!rem) return;

      const [y, m, d] = rem.event_date.split('-').map(Number);
      const [h, min] = rem.event_time.split(':').map(Number);
      const targetDate = new Date(y, m - 1, d, h, min, 0, 0);
      const curTime = Date.now();

      if (curTime >= targetDate.getTime() || isAlertPopupVisible) {
        // Already due or alerting: show pop-up
        fireReminderAlert(rem, showToastRef);
      } else {
        // Upcoming reminder: notify user when it will alert
        const diffMins = Math.max(1, Math.ceil((targetDate.getTime() - curTime) / 60000));
        const formattedTime = formatTime12Hour(rem.event_time);
        if (showToastRef) {
          showToastRef(`⏰ Reminder "${rem.title}" is set for ${formattedTime}. It will alert when your system time reaches ${formattedTime} (in ~${diffMins} min${diffMins === 1 ? '' : 's'}).`);
        }
      }
    });
  });

  // Explicit Alert Button: preview or fire alert
  container.querySelectorAll('.rem-select-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rem = reminders.find(r => r.id === id);
      if (rem) {
        fireReminderAlert(rem, showToastRef);
      }
    });
  });

  // Close / Reopen toggle
  container.querySelectorAll('.rem-toggle-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      closeReminder(id, showToastRef);
    });
  });

  // Delete button
  container.querySelectorAll('.rem-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (activeAlertReminderId === id && isAlertPopupVisible) {
        dismissReminderAlertPopup();
      }
      reminders = reminders.filter(r => r.id !== id);
      saveReminders();
      renderRemindersList();
      renderCalendarGrid();
    });
  });
}

/**
 * Fires the continuous blinking reminder alert pop-up on the right side of the screen
 */
export function fireReminderAlert(reminder, showToastFn) {
  if (!reminder) return;

  activeAlertReminderId = reminder.id;
  isAlertPopupVisible = true;

  const popup = document.getElementById('reminder-alert-popup');
  const titleElem = document.getElementById('reminder-popup-title');
  const timeElem = document.getElementById('reminder-popup-time');
  const dateElem = document.getElementById('reminder-popup-date');
  const priorityBadge = document.getElementById('reminder-popup-priority-badge');
  const lifecycleText = document.getElementById('reminder-popup-lifecycle-text');
  const closeBtn = document.getElementById('reminder-popup-close-btn');

  if (titleElem) titleElem.textContent = reminder.title;
  if (timeElem) timeElem.textContent = `🕒 ${formatTime12Hour(reminder.event_time)} (${reminder.event_time})`;

  const todayStr = getLocalDateString();
  const isToday = reminder.event_date === todayStr;
  const isPast = reminder.event_date < todayStr;
  const [y, m, d] = reminder.event_date.split('-').map(Number);
  const dateFormatted = new Date(y, m - 1, d).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  if (dateElem) {
    dateElem.textContent = `📅 ${isToday ? 'Today (' + dateFormatted + ')' : dateFormatted}`;
  }

  if (priorityBadge) {
    const pColor = getPriorityColor(reminder.priority);
    priorityBadge.innerHTML = `
      <span class="status-pill" style="background: ${pColor}20; color: ${pColor}; border: 1px solid ${pColor}60; font-size: 0.72rem; text-transform: capitalize; font-weight: 700;">
        ${reminder.priority} Priority
      </span>
      <span class="status-pill" style="background: #ef444425; color: #ef4444; border: 1px solid #ef444470; font-size: 0.72rem; font-weight: 700; margin-left: 6px;">
        🔔 Time Reached!
      </span>
      ${reminder.status === 'closed' ? '<span class="status-pill" style="background: var(--border); color: var(--text-muted); font-size: 0.72rem; margin-left: 6px;">✓ Closed</span>' : ''}
    `;
  }

  if (lifecycleText) {
    if (reminder.status === 'closed') {
      lifecycleText.textContent = `This reminder is closed (${reminder.closedReason === 'day_ended' ? 'Day ended' : 'Closed by user'}).`;
    } else if (isToday) {
      lifecycleText.textContent = `Reached your real computer time. Closes automatically at midnight (when day ends), or you can close it below.`;
    } else if (isPast) {
      lifecycleText.textContent = `The scheduled day has ended. Closes automatically.`;
    } else {
      lifecycleText.textContent = `Scheduled for ${dateFormatted}. Closes automatically when that day ends.`;
    }
  }

  if (closeBtn) {
    if (reminder.status === 'closed') {
      closeBtn.textContent = '↩️ Reopen Reminder';
      closeBtn.style.background = 'var(--primary)';
      closeBtn.style.borderColor = 'var(--primary)';
    } else {
      closeBtn.textContent = '✓ Close Reminder';
      closeBtn.style.background = 'var(--success)';
      closeBtn.style.borderColor = 'var(--success)';
    }
  }

  if (popup) {
    popup.style.display = 'flex';
  }

  playNotificationChime();
  renderRemindersList();
}

/**
 * Cancel Alert: turns off the pop-up, NOT the reminder!
 */
export function dismissReminderAlertPopup(showToastFn) {
  const popup = document.getElementById('reminder-alert-popup');
  if (popup) popup.style.display = 'none';
  isAlertPopupVisible = false;

  renderRemindersList();

  const fn = showToastFn || showToastRef;
  if (fn) {
    fn('Pop-up alert turned off. Reminder remains active in your list.');
  }
}

/**
 * Close Reminder: marks the reminder closed and turns off the pop-up
 */
export function closeReminder(reminderId, showToastFn) {
  const rem = reminders.find(r => r.id === reminderId);
  if (!rem) return;

  const fn = showToastFn || showToastRef;

  if (rem.status === 'closed') {
    // Reopening
    rem.status = 'pending';
    rem.alertFired = false;
    delete rem.closedReason;
    delete rem.closedAt;
    saveReminders();
    renderRemindersList();
    renderCalendarGrid();
    if (fn) fn(`↩️ Reminder "${rem.title}" reopened.`);
    return;
  }

  // User decides to close it
  rem.status = 'closed';
  rem.closedReason = 'user_closed';
  rem.closedAt = new Date().toISOString();

  // If this reminder is currently active in the pop-up, turn off the pop-up
  if (activeAlertReminderId === reminderId) {
    const popup = document.getElementById('reminder-alert-popup');
    if (popup) popup.style.display = 'none';
    isAlertPopupVisible = false;
  }

  saveReminders();
  renderRemindersList();
  renderCalendarGrid();

  if (fn) {
    fn(`✓ Reminder "${rem.title}" closed.`);
  }
}

/**
 * Automatically close reminders when their day ends
 */
export function checkDayEndAutoClose(showToastFn) {
  const todayStr = getLocalDateString();
  let changed = false;

  reminders.forEach(r => {
    // If reminder is still pending/active, but its scheduled event_date is strictly before today's local date,
    // that means the reminder's scheduled day has ended!
    if (r.status !== 'closed' && r.status !== 'completed' && r.event_date < todayStr) {
      r.status = 'closed';
      r.closedReason = 'day_ended';
      r.closedAt = new Date().toISOString();
      changed = true;

      // If this reminder was alerting in the pop-up, close the pop-up!
      if (activeAlertReminderId === r.id && isAlertPopupVisible) {
        const popup = document.getElementById('reminder-alert-popup');
        if (popup) popup.style.display = 'none';
        isAlertPopupVisible = false;

        const fn = showToastFn || showToastRef;
        if (fn) {
          fn(`⏳ Reminder "${r.title}" automatically closed as the day ended.`);
        }
      }
    }
  });

  if (changed) {
    saveReminders();
    renderRemindersList();
    renderCalendarGrid();
  }
}

/**
 * Periodic reminder engine: checks upcoming alerts every second against real system time
 */
function startReminderChecker(showToastFn) {
  // Check day-end closure immediately
  checkDayEndAutoClose(showToastFn);

  // 1-second interval checking real system clock
  setInterval(() => {
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const nowTimestamp = now.getTime();

    // 1. Update live system time clock pill in the UI
    const clockTextElem = document.getElementById('live-system-time-text');
    if (clockTextElem) {
      clockTextElem.textContent = `System Time: ${now.toLocaleTimeString()}`;
    }

    // 2. Auto-close reminders when day ends
    checkDayEndAutoClose(showToastFn);

    // 3. Compare real computer system time with scheduled reminders
    reminders.forEach(r => {
      if (r.status !== 'closed' && r.status !== 'completed' && !r.alertFired) {
        if (r.event_date === todayStr) {
          const [h, min] = r.event_time.split(':').map(Number);
          const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);

          // Alert when real computer system time reaches or crosses the target reminder time
          if (nowTimestamp >= targetDate.getTime()) {
            r.alertFired = true;
            r.alertedAt = now.toISOString();
            saveReminders();
            fireReminderAlert(r, showToastFn);
          }
        }
      }
    });
  }, 1000);
}

/**
 * Format 24-hour time "HH:mm" to 12-hour format "H:mm AM/PM"
 */
function formatTime12Hour(time24) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Get date string "YYYY-MM-DD" in user's real local computer timezone
 */
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Web Audio API synthesized chime sound generator
 */
export function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Pleasant two-tone chime (523.25 Hz C5 -> 659.25 Hz E5 -> 783.99 Hz G5)
    const playTone = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(523.25, now, 0.4);
    playTone(659.25, now + 0.15, 0.5);
    playTone(783.99, now + 0.3, 0.8);
  } catch (e) {
    console.warn('Audio chime failed:', e);
  }
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
