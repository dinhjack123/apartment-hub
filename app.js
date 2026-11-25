import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'

const sb = createClient('https://hvxlvvbwnucaoazomwii.supabase.co', 'sb_publishable_FOhX_lB59yOX5I-_4oTWjQ_iGNo1YhM')
const root = document.getElementById('root')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const S = { session: null, hh: null, tab: 'home', members: [], code: null, msg: null, mode: 'in', busy: false, loading: true, error: null, online: navigator.onLine, copied: false }
let channel = null
import * as Food from './food.js'
Food.init({ sb, S, esc, render: () => render() })

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})
addEventListener('online', () => { S.online = true; render() })
addEventListener('offline', () => { S.online = false; render() })

async function loadHousehold() {
  S.loading = true; S.error = null; render()
  const { data, error } = await sb.from('household_members').select('household_id, households(id, name)').eq('user_id', S.session.user.id).limit(1).maybeSingle()
  if (error) S.error = error.message
  else S.hh = data?.households ?? null
  S.loading = false
  if (S.hh) { await loadMembers(); subscribe(); await Food.load() }
  render()
}
async function loadMembers() {
  const { data: m } = await sb.from('household_members').select('user_id').eq('household_id', S.hh.id)
  const ids = (m ?? []).map(r => r.user_id)
  const { data: p } = await sb.from('profiles').select('id, display_name').in('id', ids)
  S.members = p ?? []
}
function subscribe() {
  if (channel) sb.removeChannel(channel)
  channel = sb.channel('members-' + S.hh.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${S.hh.id}` }, async () => { await loadMembers(); render() })
    .subscribe()
}

const TABS = [['home', '🏠', 'Home'], ['food', '🥕', 'Food'], ['spending', '💵', 'Spending'], ['settings', '⚙️', 'Settings']]

function authView() {
  const up = S.mode === 'up'
  return `<div class="auth"><div class="logo">🏠</div><h1>Apartment Hub</h1>
  <p class="muted">Food, groceries and spending for your place.</p>
  <form data-form="auth" class="card">
    ${up ? '<input name="name" placeholder="Your name" autocomplete="name" required>' : ''}
    <input name="email" type="email" inputmode="email" placeholder="Email" autocomplete="email" autocapitalize="none" required>
    <input name="password" type="password" placeholder="Password (6+ characters)" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required>
    ${S.msg ? `<p class="${S.msg.ok ? 'ok' : 'err'}">${esc(S.msg.text)}</p>` : ''}
    <button class="btn" ${S.busy ? 'disabled' : ''}>${S.busy ? 'One moment…' : up ? 'Create account' : 'Sign in'}</button>
  </form>
  <button class="link" data-act="toggle-mode">${up ? 'Have an account? Sign in' : 'New here? Create an account'}</button></div>`
}
function onboardView() {
  return `<div class="auth"><h1>Set up your household</h1>
  <form data-form="create" class="card"><h3>Start a new household</h3>
    <input name="name" placeholder="Household name (e.g. Our Apartment)">
    <button class="btn" ${S.busy ? 'disabled' : ''}>Create household</button></form>
  <form data-form="join" class="card"><h3>Join your roommate’s</h3>
    <p class="muted">Ask them for the invite code in Settings.</p>
    <input name="code" placeholder="Invite code" autocapitalize="none" autocorrect="off" required>
    <button class="btn secondary" ${S.busy ? 'disabled' : ''}>Join household</button></form>
  ${S.msg ? `<p class="err">${esc(S.msg.text)}</p>` : ''}
  <button class="link" data-act="signout">Sign out</button></div>`
}
function tabView() {
  if (S.tab === 'home') return `<h1>${esc(S.hh.name)}</h1><div class="card"><h3>Welcome 👋</h3><ol class="steps">
    <li>Invite your roommate in <button class="link inline" data-act="tab" data-tab="settings">Settings</button>.</li>
    <li>Add what’s in your kitchen under <button class="link inline" data-act="tab" data-tab="food">Food</button>.</li>
    <li>Log purchases under <button class="link inline" data-act="tab" data-tab="spending">Spending</button>.</li></ol></div>
    <p class="muted">The dashboard fills in as you add data.</p>`
  if (S.tab === 'food') return Food.view()
  if (S.tab === 'spending') return `<h1>Spending</h1><div class="card"><p class="muted">Spending tracker arrives in Stage 3.</p></div>`
  const me = S.session.user.id
  return `<h1>Settings</h1><div class="card"><h3>Members</h3>
    ${S.members.map(m => `<div class="row">${esc(m.display_name || 'Unnamed')}${m.id === me ? ' (you)' : ''}</div>`).join('')}
    ${S.members.length < 2 ? `<p class="muted">Your roommate hasn’t joined yet.</p>` + (S.code
      ? `<div class="code" data-act="copy">${esc(S.code)}<small>${S.copied ? 'Copied!' : 'Tap to copy · valid 7 days'}</small></div>`
      : `<button class="btn" data-act="invite">Create invite code</button>`) : ''}
    </div>${S.msg ? `<p class="err">${esc(S.msg.text)}</p>` : ''}
    <div class="card"><h3>Currency</h3><p class="muted">USD</p></div>
    <button class="btn secondary" data-act="signout">Sign out</button>`
}
function render() {
  if (S.loading) { root.innerHTML = '<div class="center">Loading…</div>'; return }
  if (!S.session) { root.innerHTML = authView(); return }
  if (S.error) { root.innerHTML = `<div class="center"><p class="err">Couldn’t load: ${esc(S.error)}</p><p class="muted">If this mentions a missing table, run the SQL in Supabase first.</p><button class="btn" data-act="retry">Try again</button></div>`; return }
  if (!S.hh) { root.innerHTML = onboardView(); return }
  root.innerHTML = `<div class="shell">${S.online ? '' : '<div class="offline">You’re offline. Changes can’t sync until you reconnect.</div>'}
    <main class="content">${tabView()}</main>
    <nav class="nav">${TABS.map(([id, ic, lb]) => `<button class="${S.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><span>${ic}</span><small>${lb}</small></button>`).join('')}</nav></div>`
}

root.addEventListener('submit', async e => {
  e.preventDefault()
  const f = e.target, kind = f.dataset.form, v = Object.fromEntries(new FormData(f))
  if (kind?.startsWith('f-')) { await Food.submit(kind, v); return }
  S.busy = true; S.msg = null
  if (kind === 'auth') {
    if (S.mode === 'in') {
      const { error } = await sb.auth.signInWithPassword({ email: v.email, password: v.password })
      if (error) S.msg = { ok: false, text: error.message }
    } else {
      const { data, error } = await sb.auth.signUp({ email: v.email, password: v.password, options: { data: { display_name: v.name } } })
      if (error) S.msg = { ok: false, text: error.message }
      else if (!data.session) S.msg = { ok: true, text: 'Check your email to confirm your account, then sign in.' }
    }
  } else if (kind === 'create') {
    const { error } = await sb.rpc('create_household', { p_name: (v.name || '').trim() || 'Our Apartment' })
    if (error) S.msg = { ok: false, text: error.message }; else { S.busy = false; return loadHousehold() }
  } else if (kind === 'join') {
    const { error } = await sb.rpc('join_household', { p_code: v.code })
    if (error) S.msg = { ok: false, text: error.message }; else { S.busy = false; return loadHousehold() }
  }
  S.busy = false; render()
})

root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return
  const act = el.dataset.act
  if (act.startsWith('f-')) return Food.click(act, el)
  if (act === 'toggle-mode') { S.mode = S.mode === 'in' ? 'up' : 'in'; S.msg = null; render() }
  else if (act === 'tab') { S.tab = el.dataset.tab; S.msg = null; render() }
  else if (act === 'retry') loadHousehold()
  else if (act === 'signout') await sb.auth.signOut()
  else if (act === 'invite') {
    const { data, error } = await sb.from('household_invites').insert({ household_id: S.hh.id, created_by: S.session.user.id }).select('code').single()
    if (error) S.msg = { ok: false, text: error.message }; else S.code = data.code
    render()
  } else if (act === 'copy') {
    try { await navigator.clipboard.writeText(S.code); S.copied = true; render(); setTimeout(() => { S.copied = false; render() }, 1500) } catch {}
  }
})

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'INITIAL_SESSION') return
  const was = S.session?.user.id
  S.session = session
  if (!session) { S.hh = null; S.members = []; S.code = null; S.msg = null; S.loading = false; render() }
  else if (session.user.id !== was) loadHousehold()
})
const { data } = await sb.auth.getSession()
S.session = data.session
if (S.session) loadHousehold(); else { S.loading = false; render() }

root.addEventListener('input', e => { if (e.target.dataset.f === 'q') Food.search(e.target.value) })
