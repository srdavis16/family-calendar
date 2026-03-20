// ─────────────────────────────────────────────────────────
//  FAMILY CALENDAR — MAIN APP
// ─────────────────────────────────────────────────────────
let tokenClient, gapiInited = false, gisInited = false;
let currentView = 'week';
let currentDate = new Date();
let events = [];
let editingEventId = null;
let hiddenMembers = new Set();
// ─── Google API Init ──────────────────────────────────────
function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({
      apiKey: CONFIG.GOOGLE_API_KEY,
      discoveryDocs: [CONFIG.DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
  });
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        console.error('OAuth error:', resp.error);
        showToast('Sign-in failed. Please try again.');
        return;
      }
      showApp();
      await loadEvents();
    },
  });
  gisInited = true;
  maybeEnableButtons();
}

function maybeEnableButtons() {
  if (gapiInited && gisInited) {
    document.getElementById('sign-in-btn').disabled = false;
    // Auto-sign in if token exists
    const token = gapi.client.getToken();
    if (token !== null) { showApp(); loadEvents(); }
  }
}

// ─── Auth ──────────────────────────────────────────────────
document.getElementById('sign-in-btn').addEventListener('click', () => {
  if (gapi.client.getToken() === null) {
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } else {
    tokenClient.requestAccessToken({ prompt: '' });
  }
});

document.getElementById('sign-out-btn').addEventListener('click', () => {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      gapi.client.setToken('');
      document.getElementById('auth-screen').classList.add('active');
      document.getElementById('main-screen').classList.remove('active');
    });
  }
});

function showApp() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  gapi.client.people?.profiles.get({ resourceName: 'people/me' });
  // Try to get user name
  fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
  }).then(r => r.json()).then(u => {
    const name = u.given_name || u.name || 'You';
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-avatar').textContent = name[0].toUpperCase();
  }).catch(() => {});
}

// ─── Load Events ───────────────────────────────────────────
async function loadEvents() {
  const token = gapi.client.getToken();
  if (!token || !token.access_token) {
    console.warn('loadEvents called without a valid token — skipping.');
    return;
  }
  events = [];
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 4, 0);

    const resp = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      showDeleted: false,
      singleEvents: true,
      maxResults: 500,
      orderBy: 'startTime',
    });

    events = (resp.result.items || []).map(e => parseGoogleEvent(e));
    renderCurrentView();
  } catch (err) {
    console.error('Error loading events:', err);
    showToast('Error loading calendar events');
  }
}

function parseGoogleEvent(e) {
  const member = detectMember(e.summary || '', e.description || '');
  return {
    id: e.id,
    title: e.summary || '(no title)',
    description: e.description || '',
    member,
    allDay: !e.start.dateTime,
    start: e.start.dateTime ? new Date(e.start.dateTime) : parseLocalDate(e.start.date),
    end: e.end.dateTime ? new Date(e.end.dateTime) : parseLocalDate(e.end.date),
    reminder: e.reminders?.overrides?.[0]?.minutes || 0,
    raw: e,
  };
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function detectMember(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  for (const name of Object.keys(CONFIG.MEMBERS)) {
    if (text.includes(name.toLowerCase())) return name;
  }
  return 'Madeleine'; // default
}

// ─── Save Event ────────────────────────────────────────────
async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  if (!title) { showToast('Please enter a title'); return; }

  const member = document.querySelector('.member-btn.active')?.dataset.member || 'Madeleine';
  const dateVal = document.getElementById('event-date').value;
  const allDay = document.getElementById('all-day-toggle').checked;
  const startTime = document.getElementById('event-start').value;
  const endTime = document.getElementById('event-end').value;
  const reminder = parseInt(document.getElementById('event-reminder').value);
  const notes = document.getElementById('event-notes').value.trim();

  if (!dateVal) { showToast('Please select a date'); return; }

  let eventBody = {
    summary: `[${member}] ${title}`,
    description: notes || '',
    reminders: {
      useDefault: false,
      overrides: reminder > 0 ? [{ method: 'popup', minutes: reminder }] : [],
    },
  };

  if (allDay) {
    eventBody.start = { date: dateVal };
    eventBody.end = { date: dateVal };
  } else {
    const startDT = new Date(`${dateVal}T${startTime}`);
    const endDT = new Date(`${dateVal}T${endTime}`);
    if (endDT <= startDT) { showToast('End time must be after start time'); return; }
    eventBody.start = { dateTime: startDT.toISOString() };
    eventBody.end = { dateTime: endDT.toISOString() };
  }

  try {
    if (editingEventId) {
      await gapi.client.calendar.events.update({
        calendarId: 'primary',
        eventId: editingEventId,
        resource: eventBody,
      });
      showToast('Event updated ✓');
    } else {
      await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: eventBody,
      });
      showToast('Event added ✓');
    }
    closeModal();
    await loadEvents();
  } catch (err) {
    console.error(err);
    showToast('Error saving event');
  }
}

// ─── Delete Event ──────────────────────────────────────────
async function deleteEvent() {
  if (!editingEventId) return;
  if (!confirm('Delete this event?')) return;
  try {
    await gapi.client.calendar.events.delete({
      calendarId: 'primary',
      eventId: editingEventId,
    });
    showToast('Event deleted');
    closeModal();
    await loadEvents();
  } catch (err) {
    showToast('Error deleting event');
  }
}

// ─── Modal ──────────────────────────────────────────────────
function openModal(opts = {}) {
  editingEventId = opts.id || null;
  document.getElementById('modal-title').textContent = opts.id ? 'Edit Event' : 'New Event';
  document.getElementById('event-title').value = opts.title || '';
  document.getElementById('event-notes').value = opts.description || '';
  document.getElementById('event-date').value = opts.date || formatDate(new Date());
  document.getElementById('event-start').value = opts.startTime || '09:00';
  document.getElementById('event-end').value = opts.endTime || '10:00';
  document.getElementById('all-day-toggle').checked = opts.allDay || false;
  document.getElementById('event-reminder').value = opts.reminder || 10;
  toggleTimeFields(!opts.allDay);

  // Member buttons
  document.querySelectorAll('.member-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.member === (opts.member || 'Madeleine'));
  });

  const deleteBtn = document.getElementById('delete-event-btn');
  if (opts.id) deleteBtn.classList.remove('hidden');
  else deleteBtn.classList.add('hidden');

  document.getElementById('event-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('event-title').focus(), 50);
}

function closeModal() {
  document.getElementById('event-modal').classList.add('hidden');
  editingEventId = null;
}

function toggleTimeFields(show) {
  document.getElementById('time-fields').style.display = show ? 'grid' : 'none';
}

document.getElementById('all-day-toggle').addEventListener('change', e => {
  toggleTimeFields(!e.target.checked);
});

document.getElementById('modal-close-btn').addEventListener('click', closeModal);
document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
document.getElementById('save-event-btn').addEventListener('click', saveEvent);
document.getElementById('delete-event-btn').addEventListener('click', deleteEvent);
document.getElementById('add-event-btn').addEventListener('click', () => openModal());

document.getElementById('event-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('event-modal')) closeModal();
});

document.querySelectorAll('.member-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ─── Views ──────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.querySelectorAll('.calendar-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${currentView}-view`).classList.add('active');
    renderCurrentView();
  });
});

document.getElementById('prev-btn').addEventListener('click', () => {
  navigate(-1);
});
document.getElementById('next-btn').addEventListener('click', () => {
  navigate(1);
});
document.getElementById('today-btn').addEventListener('click', () => {
  currentDate = new Date();
  renderCurrentView();
});

function navigate(dir) {
  if (currentView === 'week') {
    currentDate.setDate(currentDate.getDate() + dir * 7);
  } else if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() + dir);
  } else {
    currentDate.setDate(currentDate.getDate() + dir * 14);
  }
  renderCurrentView();
}

// ─── Member Filters ─────────────────────────────────────────
document.querySelectorAll('.member-toggle').forEach(toggle => {
  toggle.addEventListener('change', () => {
    if (toggle.checked) hiddenMembers.delete(toggle.dataset.member);
    else hiddenMembers.add(toggle.dataset.member);
    renderCurrentView();
  });
});

function visibleEvents() {
  return events.filter(e => !hiddenMembers.has(e.member));
}

// ─── Render ─────────────────────────────────────────────────
function renderCurrentView() {
  updateHeaderTitle();
  if (currentView === 'week') renderWeek();
  else if (currentView === 'month') renderMonth();
  else renderAgenda();
}

function updateHeaderTitle() {
  const el = document.getElementById('current-period');
  const opts = { month: 'long', year: 'numeric' };
  if (currentView === 'week') {
    const start = getWeekStart(currentDate);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    if (start.getMonth() === end.getMonth()) {
      el.textContent = `${start.toLocaleDateString('en-US', { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
    } else {
      el.textContent = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  } else if (currentView === 'month') {
    el.textContent = currentDate.toLocaleDateString('en-US', opts);
  } else {
    el.textContent = `Next ${CONFIG.AGENDA_DAYS} Days`;
  }
}

// ── Week View ────────────────────────────────────────────────
function getWeekStart(d) {
  const day = new Date(d);
  const diff = day.getDay();
  day.setDate(day.getDate() - diff);
  day.setHours(0, 0, 0, 0);
  return day;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderWeek() {
  const start = getWeekStart(currentDate);
  const today = new Date(); today.setHours(0,0,0,0);

  // Headers
  const headerEl = document.getElementById('week-days-header');
  headerEl.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const isToday = d.getTime() === today.getTime();
    const div = document.createElement('div');
    div.className = 'day-header' + (isToday ? ' today' : '');
    div.innerHTML = `<div class="day-name">${DAY_NAMES[d.getDay()]}</div><div class="day-num">${d.getDate()}</div>`;
    headerEl.appendChild(div);
  }

  // Time labels
  const timeCol = document.getElementById('time-column');
  timeCol.innerHTML = '';
  HOURS.forEach(h => {
    const label = document.createElement('div');
    label.className = 'time-slot-label';
    label.textContent = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`;
    timeCol.appendChild(label);
  });

  // Day columns
  const bodyEl = document.getElementById('week-body');
  bodyEl.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const col = document.createElement('div');
    col.className = 'week-day-col';
    col.style.height = `${60 * 24}px`;

    // Hour lines
    HOURS.forEach(h => {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = `${h * 60}px`;
      col.appendChild(line);
    });

    // Click to add
    col.addEventListener('click', (e) => {
      if (e.target.classList.contains('week-event')) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const hour = Math.floor(y / 60);
      const min = Math.floor((y % 60) / 15) * 15;
      const hStr = String(hour).padStart(2, '0');
      const mStr = String(min).padStart(2, '0');
      const endH = hour + 1 < 24 ? hour + 1 : hour;
      openModal({
        date: formatDate(d),
        startTime: `${hStr}:${mStr}`,
        endTime: `${String(endH).padStart(2,'0')}:${mStr}`,
      });
    });

    // Events for this day
    const dayEvents = visibleEvents().filter(ev => {
      if (ev.allDay) return false;
      const evDate = new Date(ev.start); evDate.setHours(0,0,0,0);
      const colDate = new Date(d); colDate.setHours(0,0,0,0);
      return evDate.getTime() === colDate.getTime();
    });

    dayEvents.forEach(ev => {
      const startMin = ev.start.getHours() * 60 + ev.start.getMinutes();
      const endMin = ev.end.getHours() * 60 + ev.end.getMinutes();
      const height = Math.max(endMin - startMin, 30);
      const cfg = CONFIG.MEMBERS[ev.member] || CONFIG.MEMBERS.Madeleine;

      const evEl = document.createElement('div');
      evEl.className = 'week-event';
      evEl.style.top = `${startMin}px`;
      evEl.style.height = `${height}px`;
      evEl.style.background = cfg.color;
      evEl.style.color = '#fff';
      evEl.innerHTML = `<div class="ev-title">${ev.title.replace(/^\[.*?\]\s*/, '')}</div>${height > 40 ? `<div class="ev-time">${fmtTime(ev.start)}–${fmtTime(ev.end)}</div>` : ''}`;
      evEl.addEventListener('click', e => { e.stopPropagation(); openEventEditor(ev); });
      col.appendChild(evEl);
    });

    bodyEl.appendChild(col);
  }
}

// ── Month View ───────────────────────────────────────────────
function renderMonth() {
  const grid = document.getElementById('month-grid');
  grid.innerHTML = '';
  const today = new Date(); today.setHours(0,0,0,0);

  DAY_NAMES.forEach(name => {
    const el = document.createElement('div');
    el.className = 'month-day-name';
    el.textContent = name;
    grid.appendChild(el);
  });

  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const lastDay = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  const startPad = firstDay.getDay();
  const totalCells = Math.ceil((startPad + lastDay.getDate()) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1 - startPad + i);
    const isCurrentMonth = d.getMonth() === currentDate.getMonth();
    const isToday = d.getTime() === today.getTime();

    const cell = document.createElement('div');
    cell.className = 'month-cell' + (!isCurrentMonth ? ' other-month' : '') + (isToday ? ' today' : '');

    const numEl = document.createElement('div');
    numEl.className = 'cell-num';
    numEl.textContent = d.getDate();
    cell.appendChild(numEl);

    const dayEvents = visibleEvents().filter(ev => {
      const evDate = new Date(ev.start); evDate.setHours(0,0,0,0);
      const cellDate = new Date(d); cellDate.setHours(0,0,0,0);
      return evDate.getTime() === cellDate.getTime();
    });

    const maxShow = 3;
    dayEvents.slice(0, maxShow).forEach(ev => {
      const cfg = CONFIG.MEMBERS[ev.member] || CONFIG.MEMBERS.Madeleine;
      const evEl = document.createElement('div');
      evEl.className = 'month-event';
      evEl.style.background = cfg.color;
      evEl.style.color = '#fff';
      evEl.textContent = ev.title.replace(/^\[.*?\]\s*/, '');
      evEl.addEventListener('click', e => { e.stopPropagation(); openEventEditor(ev); });
      cell.appendChild(evEl);
    });

    if (dayEvents.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+${dayEvents.length - maxShow} more`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => {
      openModal({ date: formatDate(d) });
    });

    grid.appendChild(cell);
  }
}

// ── Agenda View ──────────────────────────────────────────────
function renderAgenda() {
  const list = document.getElementById('agenda-list');
  list.innerHTML = '';
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today); end.setDate(end.getDate() + CONFIG.AGENDA_DAYS);

  const upcoming = visibleEvents()
    .filter(ev => ev.start >= today && ev.start <= end)
    .sort((a, b) => a.start - b.start);

  if (upcoming.length === 0) {
    list.innerHTML = '<div class="loading-spinner"><div>No upcoming events in the next 30 days</div></div>';
    return;
  }

  const byDay = {};
  upcoming.forEach(ev => {
    const key = formatDate(ev.start);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(ev);
  });

  Object.entries(byDay).forEach(([dateStr, evs]) => {
    const d = new Date(dateStr + 'T00:00:00');
    const isToday = d.getTime() === today.getTime();

    const section = document.createElement('div');
    section.className = 'agenda-day';

    const dateLabel = document.createElement('div');
    dateLabel.className = 'agenda-date' + (isToday ? ' today-date' : '');
    dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (isToday) {
      const todayBadge = document.createElement('span');
      todayBadge.style.cssText = 'font-size:0.7rem;background:var(--primary);color:#fff;padding:2px 8px;border-radius:20px;font-family:var(--font-body);font-weight:600';
      todayBadge.textContent = 'Today';
      dateLabel.appendChild(todayBadge);
    }
    section.appendChild(dateLabel);

    evs.forEach(ev => {
      const cfg = CONFIG.MEMBERS[ev.member] || CONFIG.MEMBERS.Madeleine;
      const row = document.createElement('div');
      row.className = 'agenda-event';

      const bar = document.createElement('div');
      bar.className = 'agenda-color-bar';
      bar.style.background = cfg.color;

      const info = document.createElement('div');
      info.className = 'agenda-info';

      const titleEl = document.createElement('div');
      titleEl.className = 'agenda-title';
      titleEl.textContent = ev.title.replace(/^\[.*?\]\s*/, '');

      const meta = document.createElement('div');
      meta.className = 'agenda-meta';
      meta.textContent = ev.allDay ? 'All day' : `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`;

      const badge = document.createElement('span');
      badge.className = 'agenda-member';
      badge.style.background = cfg.light;
      badge.style.color = cfg.color;
      badge.textContent = ev.member;

      info.appendChild(titleEl);
      info.appendChild(meta);
      row.appendChild(bar);
      row.appendChild(info);
      row.appendChild(badge);
      row.addEventListener('click', () => openEventEditor(ev));
      section.appendChild(row);
    });

    list.appendChild(section);
  });
}

// ─── Edit Existing Event ────────────────────────────────────
function openEventEditor(ev) {
  openModal({
    id: ev.id,
    title: ev.title.replace(/^\[.*?\]\s*/, ''),
    description: ev.description,
    member: ev.member,
    date: formatDate(ev.start),
    startTime: ev.allDay ? '09:00' : `${pad(ev.start.getHours())}:${pad(ev.start.getMinutes())}`,
    endTime: ev.allDay ? '10:00' : `${pad(ev.end.getHours())}:${pad(ev.end.getMinutes())}`,
    allDay: ev.allDay,
    reminder: ev.reminder,
  });
}

// ─── Helpers ────────────────────────────────────────────────
function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${pad(m)} ${period}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2800);
}

// ─── Load Google APIs ────────────────────────────────────────
(function loadGoogleAPIs() {
  const gapiScript = document.createElement('script');
  gapiScript.src = 'https://apis.google.com/js/api.js';
  gapiScript.onload = gapiLoaded;
  document.head.appendChild(gapiScript);

  const gisScript = document.createElement('script');
  gisScript.src = 'https://accounts.google.com/gsi/client';
  gisScript.onload = gisLoaded;
  document.head.appendChild(gisScript);
})();

// Initial render
renderCurrentView();
