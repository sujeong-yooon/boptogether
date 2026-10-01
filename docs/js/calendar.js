// 메인 화면: 왼쪽 달력, 오른쪽의 주문 목록과 새 주문 등록.
// 주문 목록은 날짜를 고르지 않았으면 오늘 이후 전체(날짜별로 묶음), 골랐으면 그 날짜만 보여준다.
// 주문 상세(order.js)도 오른쪽 같은 자리에서 열린다. 화면 상태는 주소의 ?date= / ?order= 로 기억해
// 새로고침, 링크 공유, 브라우저 뒤로 가기가 모두 동작한다.
// MAX_PARTICIPANTS, ORDER_COLUMNS 는 order.js에 정의돼 있다.

const monthLabel = document.getElementById('monthLabel');
const calGrid = document.getElementById('calGrid');
const calStatus = document.getElementById('calStatus');
const dayViewEl = document.getElementById('dayView');
const dayTitle = document.getElementById('dayTitle');
const daySub = document.getElementById('daySub');
const dayOrderList = document.getElementById('dayOrderList');
const newOrderPanel = document.getElementById('newOrderPanel');
const newOrderForm = document.getElementById('newOrderForm');
const newOrderError = document.getElementById('newOrderError');
const newOrderSubmit = document.getElementById('newOrderSubmit');
const mainPane = document.getElementById('mainPane');
const showAllBtn = document.getElementById('showAllBtn');

const UPCOMING_LIMIT = 30;

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth() + 1; // 1-12
let selectedDate = null;
let ordersByDate = {};
let monthRequestSeq = 0;
let dayRequestSeq = 0;
// 상세를 앱 안에서 열었는지. 그렇다면 "목록으로"는 브라우저 뒤로 가기와 같게 동작해 들어온 목록으로 돌아간다.
let openedOrderFromApp = false;

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const todayStr = fmtDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str || '') && !Number.isNaN(new Date(str).getTime());
}

// 달력은 participants(count), 목록은 participants(name)으로 받는다
function participantCount(order) {
  const ps = order.participants || [];
  if (ps[0] && ps[0].count !== undefined) return ps[0].count;
  return ps.length;
}

// 좁은 화면에서는 오른쪽 영역이 달력 아래에 있으므로, 전환할 때 그쪽으로 내려준다.
function revealMainOnNarrow() {
  if (window.matchMedia('(max-width: 959px)').matches) {
    mainPane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── 주소와 화면 상태 연결
function navigate(query, { replace = false } = {}) {
  const url = query ? `?${query}` : window.location.pathname;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  route();
}

function route() {
  const params = new URLSearchParams(window.location.search);
  const orderParam = params.get('order');
  if (orderParam !== null) {
    const id = /^\d+$/.test(orderParam) ? Number(orderParam) : null;
    const created = params.get('created') === '1';
    if (created) history.replaceState(null, '', `?order=${id}`);
    showOrder(id, { created });
    return;
  }
  const dateParam = params.get('date');
  showDay(isValidDate(dateParam) ? dateParam : null);
}

window.addEventListener('popstate', route);

function showOrder(id, opts) {
  dayViewEl.hidden = true;
  document.getElementById('orderView').hidden = false;
  markSelected();
  openOrderView(id, opts);
  revealMainOnNarrow();
}

// dateStr이 null이면 다가오는 주문 전체
function showDay(dateStr) {
  closeOrderView();
  openedOrderFromApp = false;
  document.getElementById('orderView').hidden = true;
  dayViewEl.hidden = false;
  document.title = '밥투게더 - 함께 주문하고 정산해요';

  const changed = selectedDate !== dateStr;
  selectedDate = dateStr;
  if (dateStr) {
    const [y, m] = dateStr.split('-').map(Number);
    if (y !== viewYear || m !== viewMonth) {
      viewYear = y;
      viewMonth = m;
      loadMonth();
    }
  }
  markSelected();
  if (changed) newOrderPanel.hidden = true;
  loadDayOrders(dateStr);
}

// 상세 화면에서 주문을 삭제했을 때
function onOrderDeleted(dateStr) {
  navigate(`date=${dateStr}`, { replace: true });
  loadMonth();
}

// ── 달력
function setStatus(msg, { retry = false, tone = 'muted' } = {}) {
  calStatus.className = `status-bar ${msg ? 'show' : ''} ${tone}`;
  calStatus.innerHTML = msg ? `<span>${escapeHtml(msg)}</span>` : '';
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent = '다시 시도';
    btn.addEventListener('click', loadMonth);
    calStatus.appendChild(btn);
  }
}

// 달력 칸은 DB 응답과 상관없이 먼저 그린다. 주문 건수는 불러온 뒤 칸에 덧붙인다.
function renderGrid() {
  monthLabel.textContent = `${viewYear}년 ${viewMonth}월`;
  calGrid.innerHTML = '';

  DOW_LABELS.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const startOffset = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calGrid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = fmtDate(viewYear, viewMonth, d);
    const dow = (startOffset + d - 1) % 7;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.dataset.date = dateStr;
    cell.className =
      'cal-cell' +
      (dateStr === todayStr ? ' today' : '') +
      (dateStr < todayStr ? ' past' : '') +
      (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    cell.style.setProperty('--i', d - 1);
    cell.setAttribute('aria-label', formatKoreanDate(dateStr));
    cell.innerHTML = `<span class="day-num">${d}</span><span class="count"></span>`;
    cell.addEventListener('click', () => {
      // 이미 고른 날짜를 다시 누르면 전체 일정으로 돌아간다
      if (!dayViewEl.hidden && selectedDate === dateStr) navigate('');
      else navigate(`date=${dateStr}`);
      revealMainOnNarrow();
    });
    calGrid.appendChild(cell);
  }
  markSelected();
}

function markSelected() {
  calGrid.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    const on = !dayViewEl.hidden && cell.dataset.date === selectedDate;
    cell.classList.toggle('selected', on);
    cell.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function applyOrdersToGrid() {
  calGrid.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    const list = ordersByDate[cell.dataset.date] || [];
    const badge = cell.querySelector('.count');
    cell.classList.toggle('has-orders', list.length > 0);
    badge.textContent = list.length ? `${list.length}건` : '';
    cell.setAttribute(
      'aria-label',
      formatKoreanDate(cell.dataset.date) + (list.length ? `, 주문 ${list.length}건` : '')
    );
  });
}

let renderedMonthKey = null;

async function loadMonth() {
  // 같은 달을 다시 불러올 때는 칸을 새로 그리지 않고 건수만 갱신한다 (등장 애니메이션 반복 방지)
  const monthKey = `${viewYear}-${viewMonth}`;
  if (monthKey !== renderedMonthKey) {
    renderGrid();
    renderedMonthKey = monthKey;
    ordersByDate = {};
  }

  if (!supabaseClient) {
    setStatus(connectionErrorMessage(), { tone: 'error' });
    return;
  }

  const seq = ++monthRequestSeq;
  setStatus('주문을 불러오는 중...');

  const monthStart = fmtDate(viewYear, viewMonth, 1);
  const nextMonthYear = viewMonth === 12 ? viewYear + 1 : viewYear;
  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const monthEnd = fmtDate(nextMonthYear, nextMonth, 1);

  const { data: orders, error } = await withTimeout(
    supabaseClient
      .from('orders')
      .select(`${ORDER_COLUMNS}, participants(count)`)
      .gte('order_date', monthStart)
      .lt('order_date', monthEnd)
      .order('order_date', { ascending: true })
      .order('order_time', { ascending: true })
  );

  // 달을 빠르게 넘기면 이전 달 응답이 늦게 도착할 수 있다. 최신 요청만 반영한다.
  if (seq !== monthRequestSeq) return;

  if (error) {
    console.error(error);
    setStatus(connectionErrorMessage(error), { retry: true, tone: 'error' });
    return;
  }

  ordersByDate = {};
  for (const o of orders) {
    if (!ordersByDate[o.order_date]) ordersByDate[o.order_date] = [];
    ordersByDate[o.order_date].push(o);
  }
  applyOrdersToGrid();
  setStatus(orders.length ? '' : '이번 달에는 아직 주문이 없어요.');
}

// ── 주문 목록 (다가오는 주문, 날짜별 주문)
function namesPreview(o) {
  const names = (o.participants || []).map((p) => p.name).filter(Boolean);
  if (!names.length) {
    const count = participantCount(o);
    return count ? `${count}명 참여 중` : '아직 참여자가 없어요';
  }
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} 외 ${names.length - 3}명` : shown;
}

function orderItemHtml(o) {
  const count = participantCount(o);
  const state = recruitState(o, count);
  const left = maxOf(o) - count;
  const pill = state.joinable ? `${left}자리 남음` : `${count}/${maxOf(o)}명`;
  return `
    <div class="oi-main">
      <div class="oi-top">
        <span class="store">${escapeHtml(o.store_name)}</span>
        <span class="state-badge ${state.key}">${escapeHtml(state.label)}</span>
      </div>
      <div class="meta">${escapeHtml(whenAndType(o))} · ${escapeHtml(o.orderer_name)}</div>
      <div class="names">${escapeHtml(namesPreview(o))}</div>
    </div>
    <span class="pill ${state.joinable ? '' : 'full'}">${pill}</span>
  `;
}

// 끼어들 수 있는 모임을 마감 임박 순으로 먼저, 나머지는 시각 순으로 뒤에
function sortForRecruit(items) {
  const keyed = items.map((o) => ({ o, s: recruitState(o, participantCount(o)) }));
  keyed.sort((a, b) => {
    if (a.s.joinable !== b.s.joinable) return a.s.joinable ? -1 : 1;
    if (a.s.joinable) return deadlineOf(a.o) - deadlineOf(b.o);
    return String(a.o.order_time).localeCompare(String(b.o.order_time));
  });
  return keyed;
}

function orderListItem(o, state) {
  const item = document.createElement('a');
  item.className = 'order-list-item' + (state.joinable ? '' : ' inactive');
  item.href = `?order=${o.id}`;
  item.innerHTML = orderItemHtml(o);
  item.addEventListener('click', (e) => {
    // 새 탭 열기(Ctrl/가운데 클릭)는 브라우저에 맡긴다
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(`order=${o.id}`);
    openedOrderFromApp = true;
  });
  return item;
}

function emptyBlock(message, buttonLabel) {
  dayOrderList.innerHTML = `
    <div class="empty-block">
      <p>${escapeHtml(message)}</p>
      <button type="button" class="btn secondary" data-open-new>${escapeHtml(buttonLabel)}</button>
    </div>`;
  dayOrderList.querySelector('[data-open-new]').addEventListener('click', openNewOrderPanel);
}

// 날짜 하나: 카드 격자. 전체: 날짜 제목 아래 카드 격자를 날짜 순으로.
let lastDayOrders = null;

function renderDayOrders(orders, dateStr) {
  lastDayOrders = { orders, dateStr };
  dayOrderList.innerHTML = '';
  if (!orders.length) {
    if (dateStr) emptyBlock('이날 열린 모임이 없어요.', '이 날짜로 모임 열기');
    else emptyBlock('예정된 모임이 없어요. 오늘 점심 같이 먹을 사람을 모아보세요.', '모임 열기');
    return;
  }

  const groups = [];
  for (const o of orders) {
    const last = groups[groups.length - 1];
    if (last && last.date === o.order_date) last.items.push(o);
    else groups.push({ date: o.order_date, items: [o] });
  }

  groups.forEach((g) => {
    const section = document.createElement('div');
    section.className = 'date-group';
    if (!dateStr) {
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'date-group-head';
      head.innerHTML = `${escapeHtml(formatKoreanDate(g.date))}${
        g.date === todayStr ? ' <span class="today-chip">오늘</span>' : ''
      }<span class="date-group-count">${g.items.length}건</span>`;
      head.addEventListener('click', () => navigate(`date=${g.date}`));
      section.appendChild(head);
    }
    const grid = document.createElement('div');
    grid.className = 'group-items';
    sortForRecruit(g.items).forEach(({ o, s }) => grid.appendChild(orderListItem(o, s)));
    section.appendChild(grid);
    dayOrderList.appendChild(section);
  });
}

async function loadDayOrders(dateStr) {
  if (dateStr) {
    const isToday = dateStr === todayStr;
    dayTitle.textContent = `${formatKoreanDate(dateStr)}${isToday ? ' 오늘' : ''} 모임`;
    daySub.textContent =
      dateStr < todayStr
        ? '지난 날짜예요. 정산 확인은 그대로 할 수 있어요.'
        : '지금 낄 수 있는 모임이 위에 와요. 같은 날짜를 한 번 더 누르면 전체 일정으로 돌아가요.';
  } else {
    dayTitle.textContent = '다가오는 모임';
    daySub.textContent = '날짜마다 지금 낄 수 있는 모임이 마감 임박 순으로 위에 와요.';
  }
  showAllBtn.hidden = !dateStr;

  // 달력에서 이미 받아온 목록이 있으면 바로 보여주고, 최신 참여 인원은 뒤에서 다시 받아온다.
  const cached = dateStr ? ordersByDate[dateStr] : null;
  if (cached) renderDayOrders(cached, dateStr);
  else dayOrderList.innerHTML = '<p class="empty-state">불러오는 중...</p>';

  if (!supabaseClient) {
    if (!cached) dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage())}</p>`;
    return;
  }

  const seq = ++dayRequestSeq;
  let query = supabaseClient.from('orders').select(`${ORDER_COLUMNS}, participants(name)`);
  query = dateStr
    ? query.eq('order_date', dateStr).order('order_time', { ascending: true })
    : query
        .gte('order_date', todayStr)
        .order('order_date', { ascending: true })
        .order('order_time', { ascending: true })
        .limit(UPCOMING_LIMIT);
  const { data: orders, error } = await withTimeout(query);

  if (seq !== dayRequestSeq || selectedDate !== dateStr) return;
  if (error) {
    console.error(error);
    if (!cached) {
      dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage(error))}</p>`;
    }
    return;
  }
  renderDayOrders(orders, dateStr);
}

// ── 모임 열기 (오른쪽 영역 안에서 펼침)
// 흔한 값은 칩 한 번으로 고르고, '직접'이나 '날짜 선택'을 누를 때만 입력칸을 연다.
const orderDateEl = document.getElementById('orderDate');
const orderTimeEl = document.getElementById('orderTime');
const deadlineTimeEl = document.getElementById('deadlineTime');
const deadlineNote = document.getElementById('deadlineNote');
const menuUrlEl = document.getElementById('menuUrl');
const maxValueEl = document.getElementById('maxValue');
const DEFAULT_MAX = 4;
let maxCount = DEFAULT_MAX;

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return fmtDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function minusMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.max(0, h * 60 + m - mins);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

function chipValue(groupId) {
  const on = document.querySelector(`#${groupId} .chip[aria-checked="true"]`);
  return on ? on.dataset.value : null;
}

function setChip(groupId, value) {
  document.querySelectorAll(`#${groupId} .chip`).forEach((c) => {
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', c.dataset.value === value ? 'true' : 'false');
  });
}

// 칩 선택값을 실제 날짜, 시각으로 바꾼다
function formDate() {
  const v = chipValue('dateChips');
  if (v === 'today') return todayStr;
  if (v === 'tomorrow') return addDays(todayStr, 1);
  return orderDateEl.value;
}

function formTime() {
  const v = chipValue('timeChips');
  return v === 'pick' ? orderTimeEl.value : v;
}

function formDeadline() {
  const v = chipValue('deadlineChips');
  if (v === 'pick') return deadlineTimeEl.value;
  const time = formTime();
  return time ? minusMinutes(time, Number(v)) : '';
}

function syncNewOrderForm() {
  orderDateEl.hidden = chipValue('dateChips') !== 'pick';
  orderTimeEl.hidden = chipValue('timeChips') !== 'pick';
  deadlineTimeEl.hidden = chipValue('deadlineChips') !== 'pick';
  const time = formTime();
  const deadline = formDeadline();
  deadlineNote.textContent =
    time && deadline ? `${formatKoreanTime(deadline)}까지 참여를 받아요.` : '';
  maxValueEl.textContent = `${maxCount}명까지`;
  document.getElementById('maxMinus').disabled = maxCount <= 2;
  document.getElementById('maxPlus').disabled = maxCount >= MAX_PARTICIPANTS;
}

['dateChips', 'timeChips', 'deadlineChips', 'typeChips'].forEach((groupId) => {
  document.getElementById(groupId).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setChip(groupId, chip.dataset.value);
    syncNewOrderForm();
    const extra = { dateChips: orderDateEl, timeChips: orderTimeEl, deadlineChips: deadlineTimeEl }[groupId];
    if (extra && chip.dataset.value === 'pick') {
      // 빈 칸 대신 지금 고른 값에서 시작하게 채워둔다
      if (!extra.value) {
        if (groupId === 'dateChips') extra.value = addDays(todayStr, 2);
        if (groupId === 'timeChips') extra.value = '12:00';
        if (groupId === 'deadlineChips') extra.value = minusMinutes(formTime() || '12:00', 10);
      }
      syncNewOrderForm();
      extra.focus();
    }
  });
});
[orderDateEl, orderTimeEl, deadlineTimeEl].forEach((el) => el.addEventListener('input', syncNewOrderForm));

document.getElementById('maxMinus').addEventListener('click', () => {
  maxCount = Math.max(2, maxCount - 1);
  syncNewOrderForm();
});
document.getElementById('maxPlus').addEventListener('click', () => {
  maxCount = Math.min(MAX_PARTICIPANTS, maxCount + 1);
  syncNewOrderForm();
});

document.getElementById('menuUrlToggle').addEventListener('click', (e) => {
  e.target.hidden = true;
  menuUrlEl.hidden = false;
  menuUrlEl.focus();
});

function openNewOrderPanel() {
  newOrderForm.reset();
  newOrderError.classList.remove('show');
  applyKnownName(document.getElementById('ordererName'), document.getElementById('ordererAsName'), '모임을 열어요');

  // 고른 날짜가 있으면 그 날짜로, 없으면 오늘. 점심이 지났으면 내일을 먼저 고른다.
  const base = selectedDate && selectedDate >= todayStr ? selectedDate : null;
  const lunchOver = new Date().getHours() >= 13;
  if (!base) setChip('dateChips', lunchOver ? 'tomorrow' : 'today');
  else if (base === todayStr) setChip('dateChips', 'today');
  else if (base === addDays(todayStr, 1)) setChip('dateChips', 'tomorrow');
  else {
    setChip('dateChips', 'pick');
    orderDateEl.value = base;
  }
  orderDateEl.min = todayStr;
  setChip('timeChips', '12:00');
  setChip('deadlineChips', '10');
  setChip('typeChips', 'delivery');
  maxCount = DEFAULT_MAX;
  menuUrlEl.hidden = true;
  document.getElementById('menuUrlToggle').hidden = false;
  syncNewOrderForm();

  newOrderPanel.hidden = false;
  newOrderPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => document.getElementById('newStoreName').focus({ preventScroll: true }), 50);
}

document.getElementById('openNewOrderBtn').addEventListener('click', openNewOrderPanel);
document.getElementById('newOrderCancel').addEventListener('click', () => {
  newOrderPanel.hidden = true;
});

document.getElementById('backToDay').addEventListener('click', () => {
  // 앱 안의 목록에서 들어왔으면 그 목록으로, 공유 링크로 바로 들어왔으면 이 주문 날짜의 목록으로
  if (openedOrderFromApp) {
    history.back();
    return;
  }
  const date = currentOrder ? currentOrder.order_date : selectedDate;
  navigate(date ? `date=${date}` : '');
});

showAllBtn.addEventListener('click', () => navigate(''));

// 숫자 외 입력은 바로 걸러낸다 (모바일 키패드에서도 문자 입력이 가능한 경우가 있음)
document.getElementById('orderPin').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

function showFormError(msg) {
  newOrderError.textContent = msg;
  newOrderError.classList.remove('show');
  void newOrderError.offsetWidth; // 같은 오류가 반복돼도 흔들림 애니메이션이 다시 보이도록
  newOrderError.classList.add('show');
}

newOrderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  newOrderError.classList.remove('show');

  const ordererName = document.getElementById('ordererName').value.trim();
  const storeName = document.getElementById('newStoreName').value.trim();
  const orderDate = formDate();
  const orderTime = formTime();
  const deadline = formDeadline();
  const pin = document.getElementById('orderPin').value.trim();
  const menuUrl = menuUrlEl.value.trim();

  if (!storeName) return showFormError('가게 이름을 입력해주세요.');
  if (!orderDate) return showFormError('날짜를 골라주세요.');
  if (!orderTime) return showFormError('주문 시각을 입력해주세요.');
  if (!deadline) return showFormError('모집 마감 시각을 입력해주세요.');
  if (deadline > orderTime) return showFormError('모집 마감은 주문 시각보다 늦을 수 없어요.');
  if (orderDate < todayStr) return showFormError('지난 날짜로는 모임을 열 수 없어요.');
  if (new Date(`${orderDate}T${deadline}:00`) <= new Date()) {
    return showFormError('모집 마감 시각이 이미 지났어요. 시각을 다시 골라주세요.');
  }
  if (menuUrl && !/^https?:\/\//i.test(menuUrl)) {
    return showFormError('메뉴판 링크는 http로 시작하는 주소를 붙여넣어 주세요.');
  }
  if (!ordererName) return showFormError('내 이름을 입력해주세요.');
  if (!/^\d{4}$/.test(pin)) return showFormError('관리 비밀번호는 숫자 4자리로 입력해주세요.');
  if (!supabaseClient) return showFormError(connectionErrorMessage());

  let createdId = null;
  await withBusy(newOrderSubmit, '여는 중...', async () => {
    const { data, error } = await withTimeout(
      supabaseClient
        .rpc('create_order', {
          p_orderer_name: ordererName,
          p_store_name: storeName,
          p_order_date: orderDate,
          p_order_time: orderTime,
          p_pin: pin,
          p_deadline_time: deadline,
          p_max_participants: maxCount,
          p_order_type: chipValue('typeChips') || 'delivery',
          p_menu_url: menuUrl || null,
        })
        .single()
    );

    if (error || !data) {
      console.error(error);
      showFormError(
        error && error.message === 'TIMEOUT'
          ? connectionErrorMessage(error)
          : '모임을 열지 못했어요. 잠시 후 다시 시도해주세요.'
      );
      return;
    }

    safeStore.set('localStorage', 'bt:myName', ordererName);
    // 주문을 만든 기기는 주문자로 기억해서, 상세 화면을 열 때마다 비밀번호를 다시 치지 않게 한다.
    safeStore.set('localStorage', `bt:pin:${data.id}`, pin);
    createdId = data.id;
  });

  if (createdId !== null) {
    newOrderPanel.hidden = true;
    navigate(`order=${createdId}&created=1`);
    openedOrderFromApp = true;
    loadMonth();
  }
});

function moveMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 1) {
    viewMonth = 12;
    viewYear -= 1;
  } else if (viewMonth > 12) {
    viewMonth = 1;
    viewYear += 1;
  }
  loadMonth();
}

document.getElementById('prevMonth').addEventListener('click', () => moveMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => moveMonth(1));
document.getElementById('todayBtn').addEventListener('click', () => {
  viewYear = today.getFullYear();
  viewMonth = today.getMonth() + 1;
  loadMonth();
});

// 마감까지 남은 시간과 정렬이 바뀌므로 목록을 30초마다 다시 그린다 (다시 받아오지는 않음)
setInterval(() => {
  if (!dayViewEl.hidden && lastDayOrders && lastDayOrders.dateStr === selectedDate) {
    renderDayOrders(lastDayOrders.orders, lastDayOrders.dateStr);
  }
}, 30000);

// 다른 사람이 주문을 추가했을 수 있으니, 탭으로 돌아오면 다시 불러온다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  loadMonth();
  if (!dayViewEl.hidden) loadDayOrders(selectedDate);
});

loadMonth();
route();
