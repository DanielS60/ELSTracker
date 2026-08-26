/* ===========================================================================
   ELITE LEVEL SALES — CRM front end
   Talks to the /api/* endpoints in server.js. No framework, no build step.
   =========================================================================== */
'use strict';

const STATUSES = ['New', 'Contacted', 'Booked', 'Showed', 'Closed', 'Lost'];

const api = {
  async get(p)        { return (await fetch(p)).json(); },
  async post(p, body) { return (await fetch(p, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); },
  async patch(p, body){ return (await fetch(p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })).json(); },
  async del(p)        { return (await fetch(p, { method: 'DELETE' })).json(); }
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = d - new Date();
  const mins = Math.round(Math.abs(diff) / 60000);
  const rel = mins < 1 ? 'now'
            : mins < 60 ? `${mins}m`
            : mins < 1440 ? `${Math.round(mins / 60)}h`
            : `${Math.round(mins / 1440)}d`;
  const stamp = d.toLocaleString('en-IE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return diff > 0 ? `${stamp} <span class="muted">(in ${rel})</span>` : `${stamp} <span class="muted">(${rel} ago)</span>`;
}

const App = {
  contacts: [],
  view: 'dashboard',

  /* ------------------------------------------------------------- bootstrap */
  async init() {
    document.querySelectorAll('#nav button').forEach(b =>
      b.addEventListener('click', () => this.show(b.dataset.view)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeDrawer(); });

    document.getElementById('hookUrl').textContent =
      location.origin + '/api/webhooks/twilio/inbound';

    await this.refresh();
    setInterval(() => { if (this.view === 'dashboard' || this.view === 'messages') this.refresh(); }, 15000);
  },

  show(v) {
    this.view = v;
    document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    this.refresh();
  },

  async refresh() {
    const jobs = { dashboard: 'loadStats', pipeline: 'loadBoard', contacts: 'loadContacts',
                   messages: 'loadMessages', automations: 'loadAutomations',
                   templates: 'loadTemplates', settings: 'loadSettings',
                   reports: 'loadReport' };
    await this.loadMode();
    if (jobs[this.view]) await this[jobs[this.view]]();
  },

  toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast on' + (isErr ? ' err' : '');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.className = 'toast', 3200);
  },

  /* ------------------------------------------------------------------ mode */
  async loadMode() {
    const s = await api.get('/api/stats');
    document.getElementById('modeBanner').innerHTML = s.dryRun
      ? `<div class="banner warn"><b>DRY RUN</b> — messages are queued and logged but never actually sent.
         Add your Twilio details in Settings and switch to Live when you're ready.</div>`
      : `<div class="banner live"><b>LIVE</b> — real SMS are being sent through Twilio. Every send costs money.</div>`;
  },

  /* ------------------------------------------------------------- dashboard */
  async loadStats() {
    const s = await api.get('/api/stats');
    document.getElementById('statCards').innerHTML = `
      <div class="card stat"><b>${s.contacts}</b><span>Total leads</span></div>
      <div class="card stat gold"><b>${s.queued}</b><span>Queued to send</span></div>
      <div class="card stat green"><b>${s.sent}</b><span>Messages sent</span></div>
      <div class="card stat red"><b>${s.failed + s.optedOut}</b><span>Failed / opted out</span></div>`;

    const max = Math.max(1, ...Object.values(s.byStatus));
    document.getElementById('statusBars').innerHTML = STATUSES.map(st => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${st}</span><b>${s.byStatus[st]}</b></div>
        <div style="height:6px;background:var(--card-mid);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${(s.byStatus[st] / max) * 100}%;background:var(--green)"></div></div>
      </div>`).join('');

    document.getElementById('upcoming').innerHTML = s.upcoming.length
      ? s.upcoming.map(u => `
          <div style="padding:9px 0;border-bottom:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px">
              <b>${esc(u.first_name)}</b><span class="small">${when(u.scheduled_for)}</span></div>
            <div class="small muted" style="margin-top:3px">${esc(u.body).slice(0, 90)}…</div>
          </div>`).join('')
      : '<p class="empty">Nothing queued. Add a lead and the follow-up sequence fires automatically.</p>';
  },

  /* -------------------------------------------------------------- pipeline */
  async loadBoard() {
    this.contacts = await api.get('/api/contacts');
    document.getElementById('board').innerHTML = STATUSES.map(st => {
      const rows = this.contacts.filter(c => c.status === st);
      return `<div class="col">
        <h3>${st}<em>${rows.length}</em></h3>
        ${rows.map(c => `
          <div class="lead" onclick="App.openContact(${c.id})">
            <b>${esc(c.first_name)} ${esc(c.last_name)}</b>
            <small>${esc(c.phone)}</small>
            ${c.opted_out ? '<span class="tag bad" style="margin-top:6px">Opted out</span>' : ''}
          </div>`).join('') || '<p class="small muted" style="padding:6px">Empty</p>'}
      </div>`;
    }).join('');
  },

  /* -------------------------------------------------------------- contacts */
  async loadContacts() {
    const q = (document.getElementById('search')?.value || '').trim();
    this.contacts = await api.get('/api/contacts' + (q ? '?q=' + encodeURIComponent(q) : ''));
    document.getElementById('contactCount').textContent = `${this.contacts.length} lead(s)`;
    document.getElementById('contactRows').innerHTML = this.contacts.length
      ? this.contacts.map(c => `
        <tr onclick="App.openContact(${c.id})">
          <td><b>${esc(c.first_name)} ${esc(c.last_name)}</b></td>
          <td class="mono">${esc(c.phone)}</td>
          <td><span class="pill s-${c.status}">${c.status}</span></td>
          <td class="small muted">${esc(c.source) || '—'}</td>
          <td>${c.opted_out ? '<span class="tag bad">Opted out</span>'
                            : c.consent_sms ? '<span class="tag ok">OK</span>'
                                            : '<span class="tag warn">No consent</span>'}</td>
          <td class="small muted">${new Date(c.created_at).toLocaleDateString('en-IE')}</td>
        </tr>`).join('')
      : `<tr><td colspan="6"><p class="empty">No leads yet. Hit "+ New lead" to add the first one.</p></td></tr>`;
  },

  /* -------------------------------------------------------------- messages */
  async loadMessages() {
    const rows = await api.get('/api/messages');
    const cls = { sent: 'ok', simulated: 'warn', queued: '', failed: 'bad', cancelled: 'bad', received: 'ok' };
    document.getElementById('msgRows').innerHTML = rows.length
      ? rows.map(m => `
        <tr>
          <td class="small">${when(m.sent_at || m.scheduled_for)}</td>
          <td><b>${esc(m.first_name)}</b><br><span class="small muted mono">${esc(m.phone)}</span></td>
          <td><span class="tag">${m.direction === 'out' ? '→' : '←'}</span></td>
          <td class="small" style="max-width:340px">${esc(m.body)}
              ${m.error ? `<div class="small" style="color:#ef6d6d;margin-top:4px">${esc(m.error)}</div>` : ''}</td>
          <td><span class="tag ${cls[m.status] ?? ''}">${m.status}</span></td>
          <td>${m.status === 'queued'
                ? `<button class="btn ghost sm" onclick="event.stopPropagation();App.cancelMsg(${m.id})">Cancel</button>` : ''}</td>
        </tr>`).join('')
      : `<tr><td colspan="6"><p class="empty">No messages yet.</p></td></tr>`;
  },

  async cancelMsg(id) { await api.del('/api/messages/' + id); this.toast('Message cancelled'); this.loadMessages(); },
  async runQueue()    { await api.post('/api/tick'); this.toast('Queue processed'); this.loadMessages(); },

  /* ------------------------------------------------------------ automations */
  async loadAutomations() {
    const rows = await api.get('/api/automations');
    document.getElementById('autoList').innerHTML = rows.map(a => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <div>
            <b style="font-size:16px">${esc(a.name)}</b>
            <div class="small muted" style="margin-top:3px">
              Trigger: ${a.trigger_type === 'contact_created'
                ? 'when a new lead is added'
                : `when a lead moves to <b style="color:var(--gold)">${esc(a.trigger_status)}</b>`}
              · ${a.steps.length} message(s)
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost sm" onclick="App.toggleAuto(${a.id},${a.enabled ? 0 : 1})">
              ${a.enabled ? 'Pause' : 'Enable'}</button>
            <button class="btn danger sm" onclick="App.delAuto(${a.id})">Delete</button>
          </div>
        </div>
        <span class="tag ${a.enabled ? 'ok' : 'bad'}" style="margin-top:10px">${a.enabled ? 'Active' : 'Paused'}</span>
        <hr>
        ${a.steps.map((s, i) => `
          <div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)">
            <div style="flex:none;width:84px" class="small">
              <b style="color:var(--gold)">Step ${i + 1}</b><br>
              <span class="muted">${s.delay_minutes === 0 ? 'immediately'
                : s.delay_minutes < 60 ? s.delay_minutes + ' min'
                : s.delay_minutes < 1440 ? Math.round(s.delay_minutes / 60) + ' hr'
                : Math.round(s.delay_minutes / 1440) + ' day(s)'}</span>
            </div>
            <div class="small">${esc(s.body)}</div>
          </div>`).join('')}
      </div>`).join('') || '<p class="empty">No sequences yet.</p>';
  },

  async toggleAuto(id, enabled) { await api.patch('/api/automations/' + id, { enabled }); this.loadAutomations(); },
  async delAuto(id) {
    if (!confirm('Delete this sequence? Messages already queued will still send.')) return;
    await api.del('/api/automations/' + id); this.toast('Sequence deleted'); this.loadAutomations();
  },

  newAutomation() {
    this.drawer(`
      <h2 style="font-family:var(--display);text-transform:uppercase;font-size:19px;margin-bottom:16px">New sequence</h2>
      <div class="field"><label>Name</label><input id="a_name" placeholder="e.g. No-show win-back"></div>
      <div class="field"><label>Trigger</label>
        <select id="a_trig" onchange="document.getElementById('a_statusWrap').style.display=this.value==='status_changed'?'block':'none'">
          <option value="contact_created">When a new lead is added</option>
          <option value="status_changed">When a lead moves to a stage</option>
        </select></div>
      <div class="field" id="a_statusWrap" style="display:none"><label>Stage</label>
        <select id="a_status">${STATUSES.map(s => `<option>${s}</option>`).join('')}</select></div>
      <hr>
      <label>Messages</label>
      <div id="a_steps"></div>
      <button class="btn ghost sm" onclick="App.addStep()">+ Add step</button>
      <hr>
      <button class="btn" onclick="App.saveAutomation()">Create sequence</button>
    `);
    this.addStep();
  },

  addStep() {
    const d = document.createElement('div');
    d.className = 'step-row';
    d.innerHTML = `
      <input type="number" min="0" value="0" placeholder="mins" title="Delay in minutes">
      <textarea placeholder="Message — use {{first_name}}" style="min-height:64px"></textarea>
      <button class="btn danger sm" onclick="this.parentNode.remove()">×</button>`;
    document.getElementById('a_steps').appendChild(d);
  },

  async saveAutomation() {
    const name = document.getElementById('a_name').value.trim();
    const steps = [...document.querySelectorAll('#a_steps .step-row')].map(r => ({
      delay_minutes: Number(r.querySelector('input').value) || 0,
      body: r.querySelector('textarea').value.trim()
    })).filter(s => s.body);

    if (!name || !steps.length) return this.toast('Add a name and at least one message', true);

    await api.post('/api/automations', {
      name,
      trigger_type: document.getElementById('a_trig').value,
      trigger_status: document.getElementById('a_status')?.value || '',
      steps
    });
    this.closeDrawer(); this.toast('Sequence created'); this.loadAutomations();
  },

  /* --------------------------------------------------------------- templates */
  async loadTemplates() {
    const rows = await api.get('/api/templates');
    document.getElementById('tplList').innerHTML = rows.map(t => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <b>${esc(t.name)}</b>
          <button class="btn danger sm" onclick="App.delTemplate(${t.id})">Delete</button>
        </div>
        <p class="small muted" style="margin-top:9px">${esc(t.body)}</p>
      </div>`).join('') || '<p class="empty">No templates yet.</p>';
  },

  async delTemplate(id) { await api.del('/api/templates/' + id); this.loadTemplates(); },

  newTemplate() {
    this.drawer(`
      <h2 style="font-family:var(--display);text-transform:uppercase;font-size:19px;margin-bottom:16px">New template</h2>
      <div class="field"><label>Name</label><input id="t_name"></div>
      <div class="field"><label>Message</label><textarea id="t_body" placeholder="Hi {{first_name}} …"></textarea></div>
      <button class="btn" onclick="App.saveTemplate()">Save template</button>`);
  },

  async saveTemplate() {
    const name = document.getElementById('t_name').value.trim();
    const body = document.getElementById('t_body').value.trim();
    if (!name || !body) return this.toast('Name and message required', true);
    await api.post('/api/templates', { name, body });
    this.closeDrawer(); this.toast('Template saved'); this.loadTemplates();
  },

  /* ---------------------------------------------------------------- settings */
  async loadSettings() {
    const s = await api.get('/api/settings');
    document.getElementById('set_sid').value   = s.twilio_account_sid;
    document.getElementById('set_token').value = s.twilio_auth_token;
    document.getElementById('set_from').value  = s.twilio_from;
    document.getElementById('set_dry').value   = s.dry_run;
    document.getElementById('set_qs').value    = s.quiet_start;
    document.getElementById('set_qe').value    = s.quiet_end;
    document.getElementById('set_agent').value = s.agent_phone || '';
  },

  async saveSettings() {
    await api.post('/api/settings', {
      twilio_account_sid: document.getElementById('set_sid').value.trim(),
      twilio_auth_token:  document.getElementById('set_token').value.trim(),
      twilio_from:        document.getElementById('set_from').value.trim(),
      dry_run:            document.getElementById('set_dry').value,
      quiet_start:        document.getElementById('set_qs').value,
      quiet_end:          document.getElementById('set_qe').value,
      agent_phone:        document.getElementById('set_agent').value.trim()
    });
    this.toast('Settings saved'); this.loadMode();
  },

  /* ------------------------------------------------------------------ drawer */
  drawer(html) {
    document.getElementById('drawerBody').innerHTML =
      `<button class="x" onclick="App.closeDrawer()">✕</button>` + html;
    document.getElementById('drawer').classList.add('on');
    document.getElementById('scrim').classList.add('on');
  },
  closeDrawer() {
    document.getElementById('drawer').classList.remove('on');
    document.getElementById('scrim').classList.remove('on');
  },

  /* ------------------------------------------------------------- new contact */
  newContact() {
    this.drawer(`
      <h2 style="font-family:var(--display);text-transform:uppercase;font-size:19px;margin-bottom:6px">New lead</h2>
      <p class="small muted" style="margin-bottom:16px">Adding a lead fires any "new lead" sequence straight away.</p>
      <div class="row">
        <div class="field"><label>First name *</label><input id="c_first"></div>
        <div class="field"><label>Last name</label><input id="c_last"></div>
      </div>
      <div class="field"><label>Phone *</label><input id="c_phone" placeholder="087 123 4567">
        <p class="counter">Irish mobiles are converted to +353 automatically.</p></div>
      <div class="field"><label>Email</label><input id="c_email" type="email"></div>
      <div class="row">
        <div class="field"><label>Status</label>
          <select id="c_status">${STATUSES.map(s => `<option>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Source</label><input id="c_source" placeholder="Instagram, website…"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="c_notes"></textarea></div>
      <label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:var(--grey)">
        <input type="checkbox" id="c_consent" checked style="width:16px;height:16px;accent-color:var(--green)">
        They agreed to be contacted by SMS
      </label>
      <hr>
      <button class="btn" onclick="App.saveContact()">Add lead</button>`);
  },

  async saveContact() {
    const b = {
      first_name: document.getElementById('c_first').value.trim(),
      last_name:  document.getElementById('c_last').value.trim(),
      phone:      document.getElementById('c_phone').value.trim(),
      email:      document.getElementById('c_email').value.trim(),
      status:     document.getElementById('c_status').value,
      source:     document.getElementById('c_source').value.trim(),
      notes:      document.getElementById('c_notes').value.trim(),
      consent_sms: document.getElementById('c_consent').checked
    };
    if (!b.first_name || !b.phone) return this.toast('First name and phone are required', true);

    const r = await api.post('/api/contacts', b);
    if (r.error) return this.toast(r.error, true);
    this.closeDrawer();
    this.toast(r.queued ? `Lead added — ${r.queued} message(s) queued` : 'Lead added');
    this.refresh();
  },

  /* ---------------------------------------------------------- contact detail */
  async openContact(id) {
    const c = await api.get('/api/contacts/' + id);
    const tpls = await api.get('/api/templates');
    const calls = await api.get('/api/calls?contact_id=' + id);

    const OUTCOMES = ['connected', 'no_answer', 'voicemail', 'booked', 'not_interested', 'callback'];
    const callHtml = calls.length ? calls.slice(0, 6).map(cl => `
      <div style="padding:9px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span><span class="tag ${cl.outcome === 'booked' ? 'ok' : (cl.status === 'failed' ? 'bad' : '')}">${esc((cl.outcome || cl.status).replace(/_/g, ' '))}</span>
          ${cl.duration_seconds ? `<span class="small muted"> ${cl.duration_seconds}s</span>` : ''}</span>
          <span class="small muted">${when(cl.started_at || cl.created_at)}</span>
        </div>
        ${cl.notes ? `<div class="small muted" style="margin-top:5px">${esc(cl.notes)}</div>` : ''}
        ${!cl.outcome ? `
          <div style="display:flex;gap:6px;margin-top:8px">
            <select id="call_outcome_${cl.id}" style="flex:1">
              <option value="">How did it go?</option>
              ${OUTCOMES.map(o => `<option value="${o}">${o.replace(/_/g, ' ')}</option>`).join('')}
            </select>
            <button class="btn ghost sm" onclick="App.logCall(${cl.id},${c.id})">Log</button>
          </div>
          <input id="call_notes_${cl.id}" placeholder="Call notes (optional)" style="margin-top:6px">` : ''}
      </div>`).join('') : '<p class="small muted" style="padding:6px 0">No calls yet.</p>';

    const thread = c.messages.length ? c.messages.map(m => `
      <div class="msg ${m.direction}">
        ${esc(m.body)}
        <div class="meta">${m.status} · ${when(m.sent_at || m.scheduled_for)}</div>
      </div>`).join('') : '<p class="empty">No messages yet.</p>';

    this.drawer(`
      <h2 style="font-family:var(--display);text-transform:uppercase;font-size:20px">${esc(c.first_name)} ${esc(c.last_name)}</h2>
      <p class="small muted mono" style="margin-bottom:12px">${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}</p>
      ${c.opted_out ? '<div class="banner warn" style="margin-bottom:14px">This contact has opted out — no further SMS will be sent.</div>' : ''}

      <div class="row">
        <div class="field"><label>Stage</label>
          <select id="d_status" onchange="App.setStatus(${c.id},this.value)">
            ${STATUSES.map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="field"><label>Source</label><input value="${esc(c.source)}" disabled></div>
      </div>
      ${c.notes ? `<div class="field"><label>Notes</label><p class="small muted">${esc(c.notes)}</p></div>` : ''}

      <hr>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px">
        <label style="margin:0">Calls</label>
        <button class="btn" onclick="App.dial(${c.id})">Call ${esc(c.first_name)}</button>
      </div>
      <div>${callHtml}</div>

      <hr>
      <label>Conversation</label>
      <div class="thread">${thread}</div>

      ${c.opted_out ? '' : `
        <hr>
        <label>Send a message</label>
        ${tpls.length ? `<select onchange="if(this.value){document.getElementById('d_body').value=this.value;App.count()}"
            style="margin-bottom:9px">
            <option value="">Insert a template…</option>
            ${tpls.map(t => `<option value="${esc(t.body)}">${esc(t.name)}</option>`).join('')}
          </select>` : ''}
        <textarea id="d_body" oninput="App.count()" placeholder="Type a message — {{first_name}} works here"></textarea>
        <p class="counter" id="d_count">0 characters · 1 segment</p>
        <div style="display:flex;gap:9px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" onclick="App.sendSms(${c.id},0)">Send now</button>
          <button class="btn ghost" onclick="App.sendSms(${c.id},60)">Send in 1 hour</button>
          <button class="btn ghost" onclick="App.sendSms(${c.id},1440)">Send tomorrow</button>
        </div>`}

      <hr>
      <button class="btn danger sm" onclick="App.delContact(${c.id})">Delete lead</button>
    `);
  },

  count() {
    const v = document.getElementById('d_body').value;
    const seg = Math.ceil(v.length / 160) || 1;
    const el = document.getElementById('d_count');
    el.textContent = `${v.length} characters · ${seg} segment${seg > 1 ? 's' : ''}`;
    el.className = 'counter' + (v.length > 160 ? ' over' : '');
  },

  async setStatus(id, status) {
    const r = await api.patch('/api/contacts/' + id, { status });
    this.toast(r.queued ? `Moved to ${status} — ${r.queued} message(s) queued` : `Moved to ${status}`);
    this.refresh();
  },

  async sendSms(id, delay) {
    const body = document.getElementById('d_body').value.trim();
    if (!body) return this.toast('Write a message first', true);
    const r = await api.post('/api/messages/send', { contact_id: id, body, schedule_in_minutes: delay });
    if (r.error) return this.toast(r.error, true);
    this.toast(delay ? 'Message scheduled' : 'Message sent');
    this.openContact(id);
  },

  async delContact(id) {
    if (!confirm('Delete this lead and all their messages?')) return;
    await api.del('/api/contacts/' + id);
    this.closeDrawer(); this.toast('Lead deleted'); this.refresh();
  },

  /* -------------------------------------------------------------- dialling */
  async dial(id) {
    const r = await api.post('/api/calls/dial', { contact_id: id });
    if (r.error) return this.toast(r.error, true);
    this.toast(r.message || 'Calling…');
    this.openContact(id);
  },

  async logCall(callId, contactId) {
    const outcome = document.getElementById('call_outcome_' + callId).value;
    const notes = (document.getElementById('call_notes_' + callId) || {}).value || '';
    if (!outcome) return this.toast('Pick an outcome first', true);
    await api.patch('/api/calls/' + callId, { outcome, notes });
    this.toast('Call logged');
    this.openContact(contactId);
  },

  /* --------------------------------------------------------------- reports */
  async loadReport() {
    const r = await api.get('/api/reports/weekly' + (this.week ? '?start=' + this.week : ''));
    this.week = r.week_start;
    document.getElementById('weekLabel').textContent = `Mon ${r.week_start}  →  Sun ${r.week_end}`;

    const m = r.metrics;
    document.getElementById('repCards').innerHTML = `
      <div class="card stat"><b>${m.conversations}</b><span>Conversations had</span></div>
      <div class="card stat gold"><b>${m.booked}</b><span>Calls booked</span></div>
      <div class="card stat green"><b>${m.showed}</b><span>Calls showed</span></div>
      <div class="card stat green"><b>${m.closed}</b><span>Calls closed</span></div>`;

    const bar = (label, val, pct) => `
      <div style="margin-bottom:13px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${label}</span>
          <b>${val}${pct === null ? '' : ` <span class="muted">${pct}%</span>`}</b></div>
        <div style="height:7px;background:var(--card-mid);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${Math.max(2, Math.min(100, pct === null ? 100 : pct))}%;background:var(--green)"></div>
        </div></div>`;
    const rel = (a, b) => b ? Math.round((a / b) * 100) : 0;

    document.getElementById('repFunnel').innerHTML =
      bar('New leads', m.newLeads, null) +
      bar('Conversations', m.conversations, rel(m.conversations, m.newLeads)) +
      bar('Booked', m.booked, rel(m.booked, m.newLeads)) +
      bar('Showed', m.showed, rel(m.showed, m.booked)) +
      bar('Closed', m.closed, rel(m.closed, m.showed));

    document.getElementById('repTable').innerHTML = r.rows.map(row =>
      `<tr><td class="small muted">${esc(row[0])}</td>
           <td style="text-align:right"><b>${esc(row[1])}</b></td></tr>`).join('');
  },

  shiftWeek(dir) {
    if (dir === 0) { this.week = null; return this.loadReport(); }
    const now = new Date();
    const ymd = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const d = new Date((this.week || ymd(now)) + 'T00:00:00');
    d.setDate(d.getDate() + dir * 7);
    this.week = ymd(d);          // local parts — toISOString() would shift a day
    this.loadReport();
  },

  exportCsv() {
    window.location = '/api/reports/weekly.csv' + (this.week ? '?start=' + this.week : '');
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
