// Receipt scanning: on-device OCR (Tesseract.js), review screen, then one spending record + selected inventory items
let X, reload = async () => {}
export function init(ctx) { X = ctx; reload = ctx.reload }
const esc = s => X.esc(s)
const money = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const todayStr = () => new Date().toLocaleDateString('en-CA')
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const CATS = ['Produce', 'Dairy & eggs', 'Meat & seafood', 'Bakery', 'Frozen', 'Pantry staples', 'Beverages', 'Snacks', 'Condiments', 'Leftovers', 'Other']
const LOCS = { refrigerator: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' }
const SHELF = {
  refrigerator: { Produce: 5, 'Dairy & eggs': 7, 'Meat & seafood': 2, Bakery: 5, Leftovers: 3, Beverages: 7, Condiments: 60, Frozen: 3, default: 7 },
  freezer: { 'Meat & seafood': 120, default: 90 },
  pantry: { Bakery: 4, Snacks: 90, 'Pantry staples': 365, Condiments: 180, Beverages: 180, default: 90 } }
const toCents = s => Math.round(parseFloat(String(s).replace(/[$,\s]/g, '')) * 100) || 0
const AMT = /(-?\$?\d{1,3}(?:,\d{3})*\.\d{2})\s*[A-Za-z]?\s*$/
const SKIP = /total|tax|change|visa|master|amex|cash|card|balance|thank|approved|debit|credit|receipt|member|items? sold|payment/i

function guessCat(n) {
  for (const [re, c] of [[/milk|cheese|yogurt|yoghurt|butter|\beggs?\b|cream/i, 'Dairy & eggs'], [/chicken|beef|pork|fish|salmon|sausage|bacon|turkey|shrimp|meat/i, 'Meat & seafood'],
    [/bread|bagel|bun|tortilla|cake|muffin/i, 'Bakery'], [/frozen|ice cream|pizza/i, 'Frozen'], [/juice|soda|water|coffee|tea|drink|beer|wine/i, 'Beverages'],
    [/chips|cookie|candy|chocolate|cracker|snack/i, 'Snacks'], [/ketchup|mustard|mayo|sauce|dressing|salsa/i, 'Condiments'],
    [/apple|banana|lettuce|tomato|onion|potato|carrot|fruit|vegetable|berr|grape|lemon|avocado|spinach/i, 'Produce'],
    [/rice|pasta|cereal|flour|sugar|oil|beans|soup|\bcans?\b|oats/i, 'Pantry staples']])
    if (re.test(n)) return c
  return 'Other'
}
const locFor = cat => cat === 'Frozen' ? 'freezer' : ['Dairy & eggs', 'Meat & seafood', 'Produce', 'Leftovers'].includes(cat) ? 'refrigerator' : 'pantry'

function parse(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const r = { merchant: '', date: '', items: [], discounts: 0, subtotal: null, tax: null, total: null }
  r.merchant = (lines.find(l => /[a-z]{3,}/i.test(l) && !/\d{1,2}[\/.-]\d{1,2}/.test(l)) || '').slice(0, 40)
  const iso = text.match(/\d{4}-\d{2}-\d{2}/), us = text.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (iso) r.date = iso[0]
  else if (us) { const y = us[3].length === 2 ? '20' + us[3] : us[3]; r.date = `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` }
  for (const l of lines) {
    const m = l.match(AMT); if (!m) continue
    const amt = toCents(m[1]), label = l.slice(0, m.index).replace(/[.\s:$-]+$/, '').trim()
    if (/sub\s?total/i.test(label)) r.subtotal = Math.abs(amt)
    else if (/\btax/i.test(label)) r.tax = Math.abs(amt)
    else if (/^(grand )?total|amount due/i.test(label)) r.total = Math.abs(amt)
    else if (/coupon|discount|savings|promo/i.test(label)) r.discounts += Math.abs(amt)
    else if (amt > 0 && label.length > 1 && !SKIP.test(label)) {
      const q = label.match(/^(\d+)\s*[x@]\s+/i)
      const name = (q ? label.slice(q[0].length) : label).replace(/^[\W\d]+/, '').trim()
      if (!name) continue
      const cat = guessCat(name)
      r.items.push({ name, qty: q ? +q[1] : 1, cents: amt, cat, loc: locFor(cat), on: true })
    }
  }
  return r
}

async function ocr(file, say) {
  let T
  try { T = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm') }
  catch { throw new Error('Couldn’t load the text reader. Check your connection.') }
  const w = await T.createWorker('eng', 1, { logger: m => { if (m.status === 'recognizing text') say(`Reading receipt… ${Math.round(m.progress * 100)}%`) } })
  try { const { data } = await w.recognize(file); return data.text || '' } finally { await w.terminate() }
}

function box() {
  let b = document.getElementById('rcx')
  if (!b) {
    b = document.createElement('div'); b.id = 'rcx'; b.className = 'sheet-bg'
    b.addEventListener('click', onClick)
    b.addEventListener('submit', e => e.preventDefault())
    document.body.appendChild(b)
  }
  return b
}
function close() { document.getElementById('rcx')?.remove() }

export function click(act) { if (act === 'rc-open') start() }

function onClick(e) {
  const el = e.target.closest('[data-rc]')
  if (!el) { if (e.target.id === 'rcx') close(); return }
  const a = el.dataset.rc
  if (a === 'close') close()
  else if (a === 'start') start()
  else if (a === 'rm') el.closest('.ri').remove()
  else if (a === 'add') document.getElementById('rclist').insertAdjacentHTML('beforeend', rowHtml({ name: '', qty: 1, cents: 0, cat: 'Other', loc: 'pantry', on: true }))
  else if (a === 'save') save(el)
}

function start() {
  const b = box()
  b.innerHTML = `<div class="sheet"><div class="sheet-h"><h3>Scan receipt</h3><button type="button" class="x" data-rc="close">×</button></div>
  <p class="muted">Lay the receipt flat in good light and keep every line in the photo. Reading happens on your phone and can take 20–40 seconds.</p>
  <label class="btn">📸 Take photo<input type="file" accept="image/*" capture="environment" hidden data-rcf></label>
  <label class="btn secondary">🖼 Choose from Photos<input type="file" accept="image/*" hidden data-rcf></label></div>`
  b.querySelectorAll('[data-rcf]').forEach(i => i.addEventListener('change', e => { const f = e.target.files[0]; if (f) read(f) }))
}

async function read(file) {
  const b = box(), say = t => { const e = document.getElementById('rcmsg'); if (e) e.textContent = t }
  b.innerHTML = `<div class="sheet"><h3>Reading receipt</h3><div class="spin"></div><p id="rcmsg" class="muted">Starting…</p></div>`
  try {
    const text = await ocr(file, say)
    if (!text.trim()) throw new Error('No text was found in that photo.')
    review(parse(text))
  } catch (e) {
    b.innerHTML = `<div class="sheet"><div class="sheet-h"><h3>Couldn’t read that</h3><button type="button" class="x" data-rc="close">×</button></div>
    <p class="muted">${esc(e.message || 'The photo may be blurry or dark.')} Try again with the receipt flat, in bright light, filling the frame.</p>
    <button class="btn" data-rc="start">Try another photo</button></div>`
  }
}

function rowHtml(it) {
  const days = it.cat && it.loc ? (SHELF[it.loc]?.[it.cat] ?? SHELF[it.loc]?.default) : null
  const sug = days ? addDays(days) : ''
  return `<div class="ri"><div class="r1">
    <input type="checkbox" class="ck" name="on" ${it.on === false ? '' : 'checked'} aria-label="Add to inventory">
    <input name="name" value="${esc(it.name)}" placeholder="Item name" autocomplete="off">
    <button type="button" class="x" data-rc="rm" aria-label="Remove">×</button></div>
    <div class="r2"><input name="qty" inputmode="decimal" value="${it.qty ?? 1}" aria-label="Quantity">
    <input name="price" inputmode="decimal" value="${((it.cents || 0) / 100).toFixed(2)}" aria-label="Price shown on receipt"></div>
    <div class="r2"><select name="loc">${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${k === it.loc ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select name="cat">${CATS.map(c => `<option ${c === it.cat ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <label class="exp">Expires${sug ? ' (suggested)' : ''}<input name="exp" type="date" value="${sug}" data-sug="${sug}"></label></div>`
}

function review(r) {
  const b = box(), sum = r.items.reduce((t, i) => t + i.cents, 0)
  const total = r.total ?? Math.max(0, sum - r.discounts + (r.tax || 0))
  b.innerHTML = `<form class="sheet" novalidate><div class="sheet-h"><h3>Review receipt</h3><button type="button" class="x" data-rc="close">×</button></div>
  <p class="muted">Check everything. Nothing is saved until you tap Save. The receipt total is recorded once in spending, and the checked items go to inventory.</p>
  <label>Store<input name="merchant" value="${esc(r.merchant)}" placeholder="Store name" autocomplete="off"></label>
  <div class="two"><label>Date<input name="date" type="date" value="${r.date || todayStr()}"></label>
  <label>Total ($)<input name="total" inputmode="decimal" value="${(total / 100).toFixed(2)}"></label></div>
  <p class="muted">Found: items ${money(sum)}${r.discounts ? ` · discounts −${money(r.discounts)}` : ''}${r.tax != null ? ` · tax ${money(r.tax)}` : ''}${r.subtotal != null ? ` · subtotal ${money(r.subtotal)}` : ''}</p>
  <h4>Items</h4><div id="rclist">${r.items.length ? r.items.map(rowHtml).join('') : '<p class="muted">No items were recognized. Add them below.</p>'}</div>
  <button type="button" class="btn secondary" data-rc="add">+ Add item</button>
  <p class="muted">Dates marked “suggested” are estimates. Replace them with the date printed on the package when you have it.</p>
  <div id="rcerr"></div>
  <button type="button" class="btn" data-rc="save">Save receipt</button></form>`
}

async function save(btn) {
  const b = box(), err = m => { document.getElementById('rcerr').innerHTML = `<p class="err">${esc(m)}</p>` }
  const total = toCents(b.querySelector('[name=total]').value), date = b.querySelector('[name=date]').value || todayStr()
  const merchant = b.querySelector('[name=merchant]').value.trim()
  if (!(total > 0)) return err('Enter the receipt total.')
  btn.disabled = true; btn.textContent = 'Saving…'
  const hid = X.S.hh.id, uid = X.S.session.user.id
  const { data: cats } = await X.sb.from('spending_categories').select('id,name').eq('household_id', hid)
  const groceries = cats?.find(c => c.name === 'Groceries')?.id || null
  const { error } = await X.sb.from('purchases').insert({ household_id: hid, created_by: uid, description: 'Receipt: ' + (merchant || 'Store'),
    merchant: merchant || null, amount_cents: total, category_id: groceries, purchase_date: date, notes: 'From receipt scan' })
  if (error) { btn.disabled = false; btn.textContent = 'Save receipt'; return err(error.message) }
  const items = [...b.querySelectorAll('.ri')].map(el => {
    const g = n => el.querySelector(`[name=${n}]`), exp = g('exp').value
    return { on: g('on').checked, name: g('name').value.trim(), qty: Number(g('qty').value) || 1, loc: g('loc').value, cat: g('cat').value,
      exp: exp || null, est: !!exp && exp === g('exp').dataset.sug }
  }).filter(i => i.on && i.name).map(i => ({ household_id: hid, created_by: uid, name: i.name, category: i.cat, quantity: i.qty, unit: 'pieces',
    location: i.loc, purchase_date: date, expiration_date: i.exp, notes: i.est ? '(expiration estimated)' : null }))
  if (items.length) {
    const r2 = await X.sb.from('food_items').insert(items)
    if (r2.error) { await reload(); return err('Receipt saved, but the items failed: ' + r2.error.message) }
  }
  close(); X.toast(`Receipt saved · ${items.length} item${items.length === 1 ? '' : 's'} added`); await reload()
}
