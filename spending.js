// Stage 3: combined household spending (integer cents, USD)
let X
export function init(ctx) { X = ctx }
const pad = n => String(n).padStart(2, '0')
const todayStr = () => new Date().toLocaleDateString('en-CA')
const thisMonth = () => todayStr().slice(0, 7)
const P = { month: thisMonth(), rows: [], cats: [], q: '', cat: '', sort: 'date', modal: null, catModal: false, err: null, dirty: false, ch: null }
const esc = s => X.esc(s)
const money = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const addM = (m, n) => { let [y, mo] = m.split('-').map(Number); mo += n - 1; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + pad(mo + 1) }
const label = m => new Date(m + '-01T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const catName = id => P.cats.find(c => c.id === id)?.name || 'Uncategorized'
const sum = l => l.reduce((t, r) => t + r.amount_cents, 0)
const cur = () => P.rows.filter(r => r.purchase_date.startsWith(P.month))
const prev = () => P.rows.filter(r => !r.purchase_date.startsWith(P.month))

export async function load() {
  const { sb, S } = X, hid = S.hh.id
  const from = addM(P.month, -1) + '-01', to = addM(P.month, 1) + '-01'
  const [a, b] = await Promise.all([
    sb.from('purchases').select('*').eq('household_id', hid).gte('purchase_date', from).lt('purchase_date', to).order('purchase_date', { ascending: false }),
    sb.from('spending_categories').select('*').eq('household_id', hid).order('sort_order').order('name')])
  if (a.error || b.error) P.err = (a.error || b.error).message
  else { P.rows = a.data; P.cats = b.data; P.err = null }
  if (!P.ch) {
    const ev = () => { if (P.modal || P.catModal) P.dirty = true; else load().then(() => X.render()) }
    P.ch = sb.channel('spend-' + hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `household_id=eq.${hid}` }, ev)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spending_categories', filter: `household_id=eq.${hid}` }, ev)
      .subscribe()
  }
}

function list() {
  const q = P.q.trim().toLowerCase()
  let l = cur().filter(r => (!q || (r.description + ' ' + (r.merchant || '')).toLowerCase().includes(q)) && (!P.cat || r.category_id === P.cat))
  l.sort(P.sort === 'amount' ? (a, b) => b.amount_cents - a.amount_cents : (a, b) => a.purchase_date < b.purchase_date ? 1 : a.purchase_date > b.purchase_date ? -1 : a.created_at < b.created_at ? 1 : -1)
  if (!l.length) return `<p class="muted">${cur().length ? 'No matches.' : 'No purchases this month yet. Tap + to add one.'}</p>`
  return l.map(r => `<div class="item" data-act="s-edit" data-id="${r.id}"><div class="grow"><b>${esc(r.description)}</b>
    <small>${new Date(r.purchase_date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${esc(catName(r.category_id))}${r.merchant ? ' · ' + esc(r.merchant) : ''}</small></div>
    <b>${money(r.amount_cents)}</b></div>`).join('')
}
export function filter(el) {
  P[el.dataset.s] = el.value
  const e = document.getElementById('plist'); if (e) e.innerHTML = list()
}

export function view() {
  const c = cur(), total = sum(c), pt = sum(prev()), m = P.month
  const [y, mo] = m.split('-').map(Number), dim = new Date(y, mo, 0).getDate()
  const elapsed = m === thisMonth() ? Number(todayStr().slice(8)) : dim
  let cmp = 'No spending recorded last month'
  if (pt > 0) { const d = total - pt; cmp = `${d >= 0 ? '▲' : '▼'} ${money(Math.abs(d))} (${Math.round(Math.abs(d) / pt * 100)}%) vs ${label(addM(m, -1))}` }
  const byCat = {}; c.forEach(r => byCat[r.category_id || 'x'] = (byCat[r.category_id || 'x'] || 0) + r.amount_cents)
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1])
  const weeks = Array.from({ length: Math.ceil(dim / 7) }, (_, i) => c.filter(r => Math.floor((Number(r.purchase_date.slice(8)) - 1) / 7) === i))
  const wmax = Math.max(1, ...weeks.map(sum))
  const top = [...c].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 3)
  return `<div class="mnav"><button data-act="s-prev">‹</button><b>${label(m)}</b><button data-act="s-next" ${m >= thisMonth() ? 'disabled' : ''}>›</button></div>
  ${P.err ? `<p class="err">${esc(P.err)}</p>` : ''}
  <div class="hero"><small>Total household spending</small><div class="big">${money(total)}</div><small>${esc(cmp)}</small></div>
  <div class="two"><div class="card stat"><small>Purchases</small><b>${c.length}</b></div><div class="card stat"><small>Avg per day</small><b>${money(Math.round(total / elapsed))}</b></div></div>
  ${c.length ? `<div class="card"><h3>By category</h3>${cats.map(([id, v]) => `<div class="bar"><div class="bl"><span>${esc(catName(id))}</span><span>${money(v)}</span></div><div class="bt"><i style="width:${Math.round(v / total * 100)}%"></i></div></div>`).join('')}</div>
  <div class="card"><h3>By week</h3><div class="wk">${weeks.map((w, i) => `<div><i style="height:${Math.round(sum(w) / wmax * 80)}px"></i><small>${money(sum(w)).replace('.00', '')}</small><small>${i * 7 + 1}–${Math.min(dim, i * 7 + 7)}</small></div>`).join('')}</div></div>
  <div class="card"><h3>Largest purchases</h3>${top.map(r => `<div class="row"><span>${esc(r.description)}</span><b style="float:right">${money(r.amount_cents)}</b></div>`).join('')}</div>` : ''}
  <h4>Purchases</h4>
  <input class="search" data-s="q" placeholder="Search purchases" value="${esc(P.q)}">
  <div class="two"><select data-s="cat"><option value="">All categories</option>${P.cats.map(k => `<option value="${k.id}" ${P.cat === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
  <select data-s="sort"><option value="date" ${P.sort === 'date' ? 'selected' : ''}>Newest first</option><option value="amount" ${P.sort === 'amount' ? 'selected' : ''}>Largest first</option></select></div>
  <div id="plist">${list()}</div>
  <button class="link" data-act="s-cats">Manage categories</button>
  <button class="fab" data-act="s-new" aria-label="Add purchase">+</button>
  ${P.modal ? modal() : ''}${P.catModal ? catModal() : ''}`
}

function modal() {
  const i = P.modal, edit = !!i.id
  const last = localStorage.getItem('hub:lastcat')
  const def = i.category_id || (P.cats.some(c => c.id === last) ? last : P.cats[0]?.id)
  const recent = [...new Map(P.rows.map(r => [r.description.toLowerCase(), r])).values()].slice(0, 8); P.recent = recent
  return `<div class="sheet-bg"><form class="sheet" data-form="s-purchase"><div class="sheet-h"><h3>${edit ? 'Edit purchase' : 'Add purchase'}</h3><button type="button" class="x" data-act="s-close">×</button></div>
  ${!edit && recent.length ? `<div class="chips">${recent.map((r, n) => `<button type="button" data-act="s-chip" data-n="${n}">${esc(r.description)}</button>`).join('')}</div>` : ''}
  <input name="description" placeholder="What was it?" value="${esc(i.description || '')}" required autocomplete="off">
  <input name="amount" inputmode="decimal" placeholder="Amount ($)" value="${edit ? (i.amount_cents / 100).toFixed(2) : ''}" required autocomplete="off">
  <select name="category_id">${P.cats.map(c => `<option value="${c.id}" ${c.id === def ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  <label>Date<input name="purchase_date" type="date" value="${i.purchase_date || todayStr()}" required></label>
  <input name="merchant" placeholder="Store (optional)" value="${esc(i.merchant || '')}">
  <input name="notes" placeholder="Notes (optional)" value="${esc(i.notes || '')}">
  ${P.err ? `<p class="err">${esc(P.err)}</p>` : ''}
  <button class="btn">${edit ? 'Save' : 'Add purchase'}</button>
  ${edit ? '<button type="button" class="btn danger" data-act="s-del">Delete purchase</button>' : ''}</form></div>`
}
function catModal() {
  return `<div class="sheet-bg"><div class="sheet"><div class="sheet-h"><h3>Spending categories</h3><button type="button" class="x" data-act="s-catclose">×</button></div>
  ${P.cats.map(c => `<div class="addrow2"><input data-s="catname" data-id="${c.id}" value="${esc(c.name)}"><button class="x" data-act="s-cat-del" data-id="${c.id}">🗑</button></div>`).join('')}
  <form data-form="s-cat-add" class="addrow2"><input name="name" placeholder="New category" required><button class="btn sm">Add</button></form>
  ${P.err ? `<p class="err">${esc(P.err)}</p>` : ''}<p class="muted">Deleting a category keeps its purchases as “Uncategorized”.</p></div></div>`
}
async function reload() { P.err = null; await load(); X.render() }
async function closeAll() { P.modal = null; P.catModal = false; P.err = null; if (P.dirty) { P.dirty = false; await load() } X.render() }

export async function submit(kind, v) {
  const { sb, S } = X
  if (kind === 's-cat-add') {
    const { error } = await sb.from('spending_categories').insert({ household_id: S.hh.id, name: v.name.trim(), sort_order: 100 })
    P.err = error?.message || null; await load(); return X.render()
  }
  const cents = Math.round(parseFloat(String(v.amount).replace(/[$,\s]/g, '')) * 100)
  if (!(cents >= 0)) { P.err = 'Enter a valid amount, like 12.50'; return X.render() }
  const row = { description: v.description.trim(), amount_cents: cents, category_id: v.category_id || null, purchase_date: v.purchase_date, merchant: v.merchant.trim() || null, notes: v.notes.trim() || null }
  const id = P.modal.id
  const { error } = id ? await sb.from('purchases').update(row).eq('id', id)
    : await sb.from('purchases').insert({ ...row, household_id: S.hh.id, created_by: S.session.user.id })
  if (error) { P.err = error.message; return X.render() }
  if (row.category_id) localStorage.setItem('hub:lastcat', row.category_id)
  P.month = row.purchase_date.slice(0, 7); P.modal = null; P.dirty = false; P.err = null
  await load(); X.render()
}

export async function rename(el) {
  const name = el.value.trim(); if (!name) return
  const { error } = await X.sb.from('spending_categories').update({ name }).eq('id', el.dataset.id)
  P.err = error?.message || null; await load(); X.render()
}

async function exportCsv() {
  const { data, error } = await X.sb.from('purchases').select('*').eq('household_id', X.S.hh.id).order('purchase_date')
  if (error) { alert(error.message); return }
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"` }
  const csv = ['Date,Description,Category,Amount (USD),Store,Notes', ...data.map(r => [r.purchase_date, r.description, catName(r.category_id), (r.amount_cents / 100).toFixed(2), r.merchant, r.notes].map(cell).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'household-spending.csv'
  document.body.appendChild(a); a.click(); a.remove()
}

export async function click(act, el) {
  const id = el.dataset.id
  if (act === 's-prev' || act === 's-next') { P.month = addM(P.month, act === 's-prev' ? -1 : 1); await load() }
  else if (act === 's-new') P.modal = {}
  else if (act === 's-edit') P.modal = P.rows.find(r => r.id === id)
  else if (act === 's-close' || act === 's-catclose') return closeAll()
  else if (act === 's-cats') { X.S.tab = 'spending'; P.catModal = true }
  else if (act === 's-chip') {
    const r = P.recent[+el.dataset.n], f = el.closest('form')
    f.description.value = r.description; f.category_id.value = r.category_id || f.category_id.value; f.merchant.value = r.merchant || ''
    f.amount.focus(); return
  } else if (act === 's-del') {
    if (!confirm(`Delete “${P.modal.description}”?`)) return
    await X.sb.from('purchases').delete().eq('id', P.modal.id); P.modal = null; await load()
  } else if (act === 's-cat-del') {
    if (!confirm('Delete this category?')) return
    await X.sb.from('spending_categories').delete().eq('id', id); await load()
  } else if (act === 's-export') return exportCsv()
  X.render()
}
