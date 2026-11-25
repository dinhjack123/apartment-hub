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
const MARK = '(expiration estimated)'
const SHELF = {
  refrigerator: { 'Produce': 5, 'Dairy & eggs': 7, 'Meat & seafood': 2, 'Bakery': 7, 'Leftovers': 3, 'Condiments': 60, 'Beverages': 7, 'Snacks': 30, 'Frozen': 3, 'Pantry staples': 30, 'Other': 5 },
  freezer: { 'Meat & seafood': 120, 'default': 90 },
  pantry: { 'Bakery': 4, 'Produce': 5, 'Snacks': 90, 'Beverages': 180, 'Condiments': 180, 'Pantry staples': 365, 'default': 90 } }
const shelf = (loc, cat) => SHELF[loc]?.[cat] ?? SHELF[loc]?.default ?? 7
const estHtml = (cat, loc) => { const n = shelf(loc, cat); return `<button type="button" class="mini" data-act="f-est" data-d="${n}">Suggest ~${n} days from today</button> <small class="muted">Rough typical shelf life, not the printed date</small>` }
const guessCat = tags => {
  const s = (tags || []).join(' ')
  for (const [re, c] of [[/frozen/, 'Frozen'], [/dair|milk|cheese|yogurt|yoghurt|egg|butter/, 'Dairy & eggs'], [/meat|poultry|fish|seafood|sausage|beef|chicken|pork/, 'Meat & seafood'], [/bread|bakery|pastr/, 'Bakery'], [/beverage|drink|juice|water|soda|coffee|tea/, 'Beverages'], [/snack|chips|crisps|chocolate|biscuit|cookie|candy/, 'Snacks'], [/sauce|condiment|dressing|ketchup|mustard|mayo/, 'Condiments'], [/fruit|vegetable|produce|salad/, 'Produce'], [/cereal|pasta|rice|flour|canned|legume|oil|spice/, 'Pantry staples']]) if (re.test(s)) return c
  return 'Other'
}
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
    const [lb0, cl] = status(i.expiration_date), lb = (i.notes || '').includes(MARK) ? '~' + lb0 : lb0
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
  const hasEst = (i.notes || '').includes(MARK)
  const sel = (arr, v) => arr.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')
  return `<div class="sheet-bg"><form class="sheet" data-form="f-item"><div class="sheet-h"><h3>${edit ? 'Edit item' : 'Add food'}</h3><button type="button" class="x" data-act="f-close">×</button></div>
  ${edit ? '' : '<button type="button" class="btn secondary" data-act="f-scan">📷 Scan barcode</button><p id="scanmsg" class="muted"></p>'}
  ${!edit && recent.length ? `<div class="chips">${recent.map((r, n) => `<button type="button" data-act="f-chip" data-n="${n}">${esc(r.name)}</button>`).join('')}</div>` : ''}
  <input name="name" placeholder="Item name" value="${esc(i.name)}" required autocomplete="off">
  <div class="two"><input name="quantity" type="number" inputmode="decimal" step="any" min="0" value="${i.quantity ?? 1}" required>
  <select name="unit">${sel(UNITS, i.unit || 'pieces')}</select></div>
  <div class="two"><select name="location" data-f="est">${Object.entries(LOC).map(([k, v]) => `<option value="${k}" ${k === (i.location || 'refrigerator') ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <select name="category" data-f="est">${sel(CATS, i.category || 'Other')}</select></div>
  <label>Expiration date <span class="muted">(enter what’s printed on the package)</span><input name="expiration_date" type="date" value="${i.expiration_date || ''}"></label>
  <input type="hidden" name="est" value="${hasEst ? 1 : ''}"><input type="hidden" name="estd" value="${hasEst ? i.expiration_date : ''}">
  <div id="est">${estHtml(i.category || 'Other', i.location || 'refrigerator')}</div>
  <div class="two"><label>Purchased<input name="purchase_date" type="date" value="${i.purchase_date || today()}"></label>
  <label>Opened<input name="opened_date" type="date" value="${i.opened_date || ''}"></label></div>
  <label>Warn when quantity is at or below<input name="low_stock_threshold" type="number" inputmode="decimal" step="any" min="0" value="${i.low_stock_threshold ?? ''}" placeholder="optional"></label>
  <input name="notes" placeholder="Notes (optional)" value="${esc((i.notes || '').replace(MARK, '').trim())}">
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
  const noteVal = v => { let t = (v.notes || '').trim(); if (v.est === '1' && v.expiration_date && v.expiration_date === v.estd) t = (t + ' ' + MARK).trim(); return t || null }
  const n = k => v[k] === '' || v[k] == null ? null : v[k]
  const row = { name: v.name.trim(), category: v.category, quantity: Number(v.quantity), unit: v.unit, location: v.location,
    purchase_date: n('purchase_date'), expiration_date: n('expiration_date'), opened_date: n('opened_date'),
    low_stock_threshold: n('low_stock_threshold'), notes: noteVal(v) }
  const id = F.modal.id
  const { error } = id ? await sb.from('food_items').update(row).eq('id', id)
    : await sb.from('food_items').insert({ ...row, household_id: S.hh.id, created_by: S.session.user.id })
  if (error) { F.err = error.message; return X.render() }
  F.modal = null; F.err = null; F.dirty = false; X.toast('Saved ✓'); await load(); X.render()
}

export async function click(act, el) {
  const { sb } = X, id = el.dataset.id
  if (act === 'f-scan') return scan()
  if (act === 'f-est') {
    const f = el.closest('form'), d = new Date(); d.setDate(d.getDate() + Number(el.dataset.d)); const s = d.toLocaleDateString('en-CA')
    f.expiration_date.value = s; f.est.value = '1'; f.estd.value = s; return
  }
  if (act === 'f-new-home') { X.S.tab = 'food'; F.sub = 'use'; F.modal = {}; return X.render() }
  if (act === 'f-scan-home') { X.S.tab = 'food'; F.sub = 'use'; F.modal = {}; X.render(); return scan() }
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
    await sb.from('food_items').delete().eq('id', F.modal.id); F.modal = null; X.toast('Item deleted'); await load()
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

export function est() {
  const f = document.querySelector('form[data-form=f-item]'), e = document.getElementById('est')
  if (f && e) e.innerHTML = estHtml(f.category.value, f.location.value)
}

const setMsg = t => { const e = document.getElementById('scanmsg'); if (e) e.textContent = t }
async function scan() {
  const ov = document.createElement('div'); ov.className = 'scan'
  ov.innerHTML = `<video playsinline muted></video>
  <p id="ovmsg">Hold the barcode flat and steady, about 6–8 inches away, in good light.</p>
  <label class="btn secondary">📸 Take a photo of the barcode<input type="file" accept="image/*" capture="environment" id="scanfile" hidden></label>
  <div class="addrow2"><input id="scannum" inputmode="numeric" placeholder="or type the number under it"><button class="btn sm" id="scango">Go</button></div>
  <button class="btn danger" id="scanx">Cancel</button>`
  document.body.appendChild(ov)
  const say = t => { const e = ov.querySelector('#ovmsg'); if (e) e.textContent = t }
  let done = false, ctl = null, reader = null
  const stop = () => { done = true; try { ctl?.stop() } catch {} ; ov.remove() }
  const found = code => { if (done) return; stop(); lookup(code) }
  ov.querySelector('#scanx').onclick = stop
  ov.querySelector('#scango').onclick = () => { const d = ov.querySelector('#scannum').value.replace(/\D/g, ''); if (d.length >= 6) found(d); else say('Type the digits printed under the barcode.') }
  try {
    const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm'), import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm')])
    const { DecodeHintType: H, BarcodeFormat: B } = lib
    const hints = new Map([[H.POSSIBLE_FORMATS, [B.EAN_13, B.EAN_8, B.UPC_A, B.UPC_E, B.CODE_128, B.CODE_39]], [H.TRY_HARDER, true]])
    reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 })
    ov.querySelector('#scanfile').onchange = async e => {
      const file = e.target.files[0]; if (!file) return
      say('Reading photo…')
      try { const r = await reader.decodeFromImageUrl(URL.createObjectURL(file)); found(r.getText()) }
      catch { say('No barcode found in that photo. Try again closer, with the barcode filling most of the frame.') }
    }
    ctl = await reader.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } }, ov.querySelector('video'), (res, err, c) => {
      ctl = c || ctl
      if (res) found(res.getText())
    })
    if (done) ctl?.stop()
  } catch (e) { say('Live scanning isn’t available (' + (e.message || e) + '). Use the photo button or type the number.') }
}
async function lookup(code) {
  setMsg(`Looking up ${code}…`)
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,categories_tags`)
    const j = await r.json(), f = document.querySelector('form[data-form=f-item]')
    if (!f) return
    if (j.status !== 1 || !j.product?.product_name) return setMsg(`Barcode ${code} isn’t in the free product database. Enter it manually.`)
    const p = j.product, brand = (p.brands || '').split(',')[0].trim()
    f.name.value = brand && !p.product_name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${p.product_name}` : p.product_name
    const cat = guessCat(p.categories_tags)
    f.category.value = cat
    f.location.value = cat === 'Frozen' ? 'freezer' : ['Dairy & eggs', 'Meat & seafood', 'Produce', 'Leftovers'].includes(cat) ? 'refrigerator' : 'pantry'
    f.unit.value = 'packages'; est()
    f.expiration_date.focus()
    setMsg('Filled in the name and category. Check them, then enter the date printed on the package.')
  } catch { setMsg('Couldn’t reach the product database. Check your connection or enter it manually.') }
}

export function home() {
  const byExp = (a, b) => a.expiration_date < b.expiration_date ? -1 : 1
  const exp = F.items.filter(i => i.expiration_date)
  const expired = exp.filter(i => days(i.expiration_date) < 0)
  const in3 = exp.filter(i => days(i.expiration_date) >= 0 && days(i.expiration_date) <= 3)
  const soon = exp.filter(i => days(i.expiration_date) <= 7).sort(byExp)
  const lows = F.items.filter(low)
  const alerts = []
  if (expired.length) alerts.push(`⚠️ ${expired.length} item${expired.length > 1 ? 's' : ''} past the expiration date: ${expired.slice(0, 3).map(i => esc(i.name)).join(', ')}`)
  if (in3.length) alerts.push(`⏰ Expiring within 3 days: ${in3.slice(0, 4).map(i => esc(i.name)).join(', ')}`)
  if (lows.length) alerts.push(`🛒 Low stock: ${lows.slice(0, 4).map(i => esc(i.name)).join(', ')}`)
  const row = i => { const [lb, cl] = status(i.expiration_date); return `<div class="row"><span>${esc(i.name)}</span><span class="badge ${cl}" style="float:right">${esc(lb)}</span></div>` }
  const recent = [...F.items].sort((a, b) => a.created_at < b.created_at ? 1 : -1).slice(0, 4)
  return { tracked: F.items.length, soon: soon.length, alerts,
    soonHtml: soon.length ? `<div class="card"><h3>Use first</h3>${soon.slice(0, 5).map(row).join('')}</div>` : '',
    recentHtml: recent.length ? `<div class="card"><h3>Recently added</h3>${recent.map(i => `<div class="row">${esc(i.name)} <small class="muted">· ${LOC[i.location]}</small></div>`).join('')}</div>` : '' }
}

export function closeTransient() { F.modal = null; F.err = null; F.offer = null; if (F.dirty) { F.dirty = false; load().then(() => X.render()) } }
