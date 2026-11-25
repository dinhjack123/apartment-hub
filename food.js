// Stage 2: food inventory, expiration tracking, shared shopping list
let X
export function init(ctx) { X = ctx }
const F = { items: [], shop: [], sub: 'use', q: '', modal: null, offer: null, err: null, dirty: false, ch: null }
const LOC = { refrigerator: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' }
const CATS = ['Produce', 'Dairy & eggs', 'Meat & seafood', 'Bakery', 'Frozen', 'Pantry staples', 'Beverages', 'Snacks', 'Condiments', 'Leftovers', 'Other']
const UNITS = ['pieces', 'packages', 'bottles', 'cans', 'bags', 'boxes', 'pounds', 'ounces', 'gallons']
const SUBS = [['use', 'Use first'], ['refrigerator', 'Fridge'], ['freezer', 'Freezer'], ['pantry', 'Pantry'], ['expired', 'Expired'], ['low', 'Low stock'], ['shop', '🛒 Shopping']]
const esc = s => X.esc(s)
const today = () => new Date().toLocaleDateString('en-CA')
const days = d => d ? Math.round((new Date(d + 'T00:00') - new Date(today() + 'T00:00')) / 864e5) : null
const low = i => i.low_stock_threshold != null && Number(i.quantity) <= Number(i.low_stock_threshold)
function status(d) {
  const n = days(d)
  if (n === null) return ['No date', 'none']
  if (n < 0) return [`Expired ${-n}d ago`, 'bad']
  if (n === 0) return ['Expires today', 'bad']
  if (n <= 3) return [`In ${n} day${n > 1 ? 's' : ''}`, 'warn']
  if (n <= 7) return [`In ${n} days`, 'soon']
  return [d, 'ok']
}

export async function load() {
  const hid = X.S.hh.id
  const [a, b] = await Promise.all([
    X.sb.from('food_items').select('*').eq('household_id', hid),
    X.sb.from('shopping_list_items').select('*').eq('household_id', hid).order('created_at')])
  if (a.error || b.error) F.err = (a.error || b.error).message
  else { F.items = a.data; F.shop = b.data; F.err = null }
  if (!F.ch) {
    const ev = () => { if (F.modal) F.dirty = true; else load().then(() => X.render()) }
    F.ch = X.sb.channel('food-' + hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items', filter: `household_id=eq.${hid}` }, ev)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_list_items', filter: `household_id=eq.${hid}` }, ev)
      .subscribe()
  }
}

function visible() {
  const q = F.q.trim().toLowerCase()
  let l = F.items.filter(i => !q || (i.name + ' ' + (i.category || '')).toLowerCase().includes(q))
  if (['refrigerator', 'freezer', 'pantry'].includes(F.sub)) l = l.filter(i => i.location === F.sub)
  if (F.sub === 'expired') l = l.filter(i => days(i.expiration_date) < 0 && i.expiration_date)
  if (F.sub === 'low') l = l.filter(low)
  return l.sort((a, b) => (a.expiration_date || '9999') < (b.expiration_date || '9999') ? -1 : 1)
}
function rows() {
  const l = visible()
  if (!l.length) return `<div class="card"><p class="muted">${F.items.length ? 'Nothing here.' : 'Your kitchen is empty. Tap + to add your first item.'}</p></div>`
  return l.map(i => {
    const [lb, cl] = status(i.expiration_date)
    return `<div class="item" data-act="f-edit" data-id="${i.id}">
      <div class="grow"><b>${esc(i.name)}</b>${low(i) ? ' <span class="tag">low</span>' : ''}
      <small>${LOC[i.location]}${i.category ? ' · ' + esc(i.category) : ''}</small></div>
      <div class="qty"><button data-act="f-dec" data-id="${i.id}" aria-label="Use one">−</button><span>${+i.quantity} ${esc(i.unit)}</span></div>
      <div class="badge ${cl}">${esc(lb)}</div></div>`
  }).join('')
}
function shopView() {
  const open = F.shop.filter(s => !s.is_purchased), done = F.shop.filter(s => s.is_purchased)
  const need = F.items.filter(low).filter(i => !open.some(s => s.name.toLowerCase() === i.name.toLowerCase()))
  const groups = {}; open.forEach(s => (groups[s.category || 'Other'] ||= []).push(s))
  const line = s => `<div class="item"><button class="chk ${s.is_purchased ? 'on' : ''}" data-act="f-toggle" data-id="${s.id}">${s.is_purchased ? '✓' : ''}</button>
    <div class="grow ${s.is_purchased ? 'done' : ''}">${esc(s.name)}</div>
    ${s.is_purchased ? `<button class="mini" data-act="f-stock" data-id="${s.id}">+ Inventory</button>` : ''}
    <button class="x" data-act="f-del-shop" data-id="${s.id}" aria-label="Remove">×</button></div>`
  return `${F.offer ? `<div class="offer">Bought “${esc(F.offer.name)}”. <button class="mini" data-act="f-stock" data-id="${F.offer.id}">Add to inventory</button><button class="x" data-act="f-offer-x">×</button></div>` : ''}
  <form data-form="f-shop" class="addrow"><input name="name" placeholder="Add to shopping list" required autocomplete="off">
    <select name="category">${CATS.map(c => `<option>${c}</option>`).join('')}</select><button class="btn sm">Add</button></form>
  ${need.length ? `<button class="btn secondary" data-act="f-addlow">Add ${need.length} low-stock item${need.length > 1 ? 's' : ''} to list</button>` : ''}
  ${!F.shop.length ? '<div class="card"><p class="muted">Your list is empty.</p></div>' : ''}
  ${Object.keys(groups).sort().map(c => `<h4>${esc(c)}</h4>${groups[c].map(line).join('')}`).join('')}
  ${done.length ? `<h4>In the cart</h4>${done.map(line).join('')}<button class="link" data-act="f-clear">Clear purchased</button>` : ''}`
}
export function view() {
  return `<h1>Food</h1>
  ${F.err ? `<p class="err">${esc(F.err)}</p>` : ''}
  <div class="subs">${SUBS.map(([id, lb]) => `<button class="${F.sub === id ? 'on' : ''}" data-act="f-sub" data-sub="${id}">${lb}</button>`).join('')}</div>
  ${F.sub === 'shop' ? shopView() : `<input class="search" data-f="q" placeholder="Search food" value="${esc(F.q)}"><div id="flist">${rows()}</div>`}
  ${F.sub !== 'shop' ? '<button class="fab" data-act="f-new" aria-label="Add food">+</button>' : ''}
  ${F.modal ? modal() : ''}`
}
export function search(v) { F.q = v; const el = document.getElementById('flist'); if (el) el.innerHTML = rows() }

function modal() {
  const i = F.modal, edit = !!i.id
  const recent = [...new Map([...F.items].sort((a, b) => a.created_at < b.created_at ? 1 : -1).map(x => [x.name.toLowerCase(), x])).values()].slice(0, 8)
  F.recent = recent
  const sel = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')
  return `<div class="sheet-bg"><form class="sheet" data-form="f-item"><div class="sheet-h"><h3>${edit ? 'Edit item' : 'Add food'}</h3><button type="button" class="x" data-act="f-close">×</button></div>
  ${!edit && recent.length ? `<div class="chips">${recent.map((r, n) => `<button type="button" data-act="f-chip" data-n="${n}">${esc(r.name)}</button>`).join('')}</div>` : ''}
  <input name="name" placeholder="Item name" value="${esc(i.name)}" required autocomplete="off">
  <div class="two"><input name="quantity" type="number" inputmode="decimal" step="any" min="0" value="${i.quantity ?? 1}" required>
  <select name="unit">${sel(UNITS, i.unit || 'pieces')}</select></div>
  <div class="two"><select name="location">${Object.entries(LOC).map(([k, v]) => `<option value="${k}" ${k === (i.location || 'refrigerator') ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <select name="category">${sel(CATS, i.category || 'Other')}</select></div>
  <label>Expiration date <span class="muted">(enter what’s printed on the package)</span><input name="expiration_date" type="date" value="${i.expiration_date || ''}"></label>
  <div class="two"><label>Purchased<input name="purchase_date" type="date" value="${i.purchase_date || today()}"></label>
  <label>Opened<input name="opened_date" type="date" value="${i.opened_date || ''}"></label></div>
  <label>Warn when quantity is at or below<input name="low_stock_threshold" type="number" inputmode="decimal" step="any" min="0" value="${i.low_stock_threshold ?? ''}" placeholder="optional"></label>
  <input name="notes" placeholder="Notes (optional)" value="${esc(i.notes || '')}">
  ${F.err ? `<p class="err">${esc(F.err)}</p>` : ''}
  <button class="btn">${edit ? 'Save' : 'Add item'}</button>
  ${edit ? '<button type="button" class="btn danger" data-act="f-del">Delete item</button>' : ''}</form></div>`
}
const closeModal = async () => { F.modal = null; F.err = null; if (F.dirty) { F.dirty = false; await load() } X.render() }

export async function submit(kind, v) {
  const { S, sb } = X
  if (kind === 'f-shop') {
    const { error } = await sb.from('shopping_list_items').insert({ household_id: S.hh.id, created_by: S.session.user.id, name: v.name.trim(), category: v.category })
    F.err = error?.message || null; await load(); return X.render()
  }
  const n = k => v[k] === '' || v[k] == null ? null : v[k]
  const row = { name: v.name.trim(), category: v.category, quantity: Number(v.quantity), unit: v.unit, location: v.location,
    purchase_date: n('purchase_date'), expiration_date: n('expiration_date'), opened_date: n('opened_date'),
    low_stock_threshold: n('low_stock_threshold'), notes: n('notes') }
  const id = F.modal.id
  const { error } = id ? await sb.from('food_items').update(row).eq('id', id)
    : await sb.from('food_items').insert({ ...row, household_id: S.hh.id, created_by: S.session.user.id })
  if (error) { F.err = error.message; return X.render() }
  F.modal = null; F.err = null; F.dirty = false; await load(); X.render()
}

export async function click(act, el) {
  const { sb } = X, id = el.dataset.id
  if (act === 'f-sub') { F.sub = el.dataset.sub; F.q = ''; F.err = null }
  else if (act === 'f-new') F.modal = {}
  else if (act === 'f-close') return closeModal()
  else if (act === 'f-edit') F.modal = F.items.find(i => i.id === id)
  else if (act === 'f-chip') {
    const r = F.recent[+el.dataset.n], f = el.closest('form')
    f.name.value = r.name; f.unit.value = r.unit; f.location.value = r.location; f.category.value = r.category || 'Other'; f.quantity.value = 1
    f.expiration_date.focus(); return
  } else if (act === 'f-dec') {
    const it = F.items.find(i => i.id === id), q = Math.max(0, Number(it.quantity) - 1)
    it.quantity = q; X.render()
    const { error } = await sb.from('food_items').update({ quantity: q }).eq('id', id)
    if (error) F.err = error.message
    return
  } else if (act === 'f-del') {
    if (!confirm(`Delete “${F.modal.name}”?`)) return
    await sb.from('food_items').delete().eq('id', F.modal.id); F.modal = null; await load()
  } else if (act === 'f-toggle') {
    const s = F.shop.find(x => x.id === id), p = !s.is_purchased
    await sb.from('shopping_list_items').update({ is_purchased: p, purchased_at: p ? new Date().toISOString() : null }).eq('id', id)
    F.offer = p ? s : null; await load()
  } else if (act === 'f-stock') {
    const s = F.shop.find(x => x.id === id); F.offer = null
    F.modal = { name: s.name, category: s.category, quantity: s.quantity, unit: s.unit || 'pieces' }; F.shopDone = id
  } else if (act === 'f-offer-x') F.offer = null
  else if (act === 'f-del-shop') { await sb.from('shopping_list_items').delete().eq('id', id); await load() }
  else if (act === 'f-clear') { await sb.from('shopping_list_items').delete().eq('household_id', X.S.hh.id).eq('is_purchased', true); await load() }
  else if (act === 'f-addlow') {
    const open = F.shop.filter(s => !s.is_purchased).map(s => s.name.toLowerCase())
    const rows = F.items.filter(low).filter(i => !open.includes(i.name.toLowerCase()))
      .map(i => ({ household_id: X.S.hh.id, created_by: X.S.session.user.id, name: i.name, category: i.category }))
    await sb.from('shopping_list_items').insert(rows); await load()
  }
  X.render()
}
