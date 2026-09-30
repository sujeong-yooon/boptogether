// 메인 화면: 왼쪽 달력과 다가오는 주문, 오른쪽의 날짜별 주문 목록과 새 주문 등록.
// 주문 상세(order.js)도 오른쪽 같은 자리에서 열린다. 화면 상태는 주소의 ?date= / ?order= 로 기억해
// 새로고침, 링크 공유, 브라우저 뒤로 가기가 모두 동작한다.
// MAX_PARTICIPANTS, ORDER_COLUMNS 는 order.js에 정의돼 있다.

const monthLabel = document.getElementById('monthLabel');
const calGrid = document.getElementById('calGrid');
const calStatus = document.getElementById('calStatus');
const upcomingList = document.getElementById('upcomingList');
const dayViewEl = document.getElementById('dayView');
const dayTitle = document.getElementById('dayTitle');
const daySub = document.getElementById('daySub');
const dayOrderList = document.getElementById('dayOrderList');
const newOrderPanel = document.getElementById('newOrderPanel');
const newOrderForm = document.getElementById('newOrderForm');
const newOrderError = document.getElementById('newOrderError');
const newOrderSubmit = document.getElementById('newOrderSubmit');
const mainPane = document.getElementById('mainPane');

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth() + 1; // 1-12
let selectedDate = null;
let ordersByDate = {};
let monthRequestSeq = 0;
let dayRequestSeq = 0;

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

function participantCount(order) {
  return order.participants && order.participants[0] ? order.participants[0].count : 0;
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
  showDay(isValidDate(dateParam) ? dateParam : todayStr);
}

window.addEventListener('popstate', route);

function showOrder(id, opts) {
  dayViewEl.hidden = true;
  document.getElementById('orderView').hidden = false;
  markSelected();
  openOrderView(id, opts);
  revealMainOnNarrow();
}

function showDay(dateStr) {
  closeOrderView();
  document.getElementById('orderView').hidden = true;
  dayViewEl.hidden = false;
  document.title = '밥투게더 - 함께 주문하고 정산해요';

  const changed = selectedDate !== dateStr;
  selectedDate = dateStr;
  const [y, m] = dateStr.split('-').map(Number);
  if (y !== viewYear || m !== viewMonth) {
    viewYear = y;
    viewMonth = m;
    loadMonth();
  } else {
    markSelected();
  }
  if (changed) newOrderPanel.hidden = true;
  loadDayOrders(dateStr);
}

// 상세 화면에서 주문을 삭제했을 때
function onOrderDeleted(dateStr) {
  navigate(`date=${dateStr}`, { replace: true });
  loadMonth();
  loadUpcoming();
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
      navigate(`date=${dateStr}`);
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
function orderItemHtml(o, { showDate = false } = {}) {
  const count = participantCount(o);
  const full = count >= MAX_PARTICIPANTS;
  const when = showDate
    ? `${formatKoreanDate(o.order_date)} ${formatKoreanTime(o.order_time)}`
    : formatKoreanTime(o.order_time);
  return `
    <div>
      <div class="store">${escapeHtml(o.store_name)}</div>
      <div class="meta">${escapeHtml(o.orderer_name)} · ${escapeHtml(when)}</div>
    </div>
    <span class="pill ${full ? 'full' : ''}">${full ? '마감' : `${count}/${MAX_PARTICIPANTS}명`}</span>
  `;
}

function renderOrderList(container, orders, opts) {
  container.innerHTML = '';
  orders.forEach((o) => {
    const item = document.createElement('a');
    item.className = 'order-list-item';
    item.href = `?order=${o.id}`;
    item.innerHTML = orderItemHtml(o, opts);
    item.addEventListener('click', (e) => {
      // 새 탭 열기(Ctrl/가운데 클릭)는 브라우저에 맡긴다
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(`order=${o.id}`);
    });
    container.appendChild(item);
  });
}

async function loadUpcoming() {
  if (!supabaseClient) {
    upcomingList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage())}</p>`;
    return;
  }
  const { data: orders, error } = await withTimeout(
    supabaseClient
      .from('orders')
      .select(`${ORDER_COLUMNS}, participants(count)`)
      .gte('order_date', todayStr)
      .order('order_date', { ascending: true })
      .order('order_time', { ascending: true })
      .limit(5)
  );
  if (error) {
    console.error(error);
    upcomingList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage(error))}</p>`;
    return;
  }
  if (!orders.length) {
    upcomingList.innerHTML = '<p class="empty-state">예정된 주문이 없어요.</p>';
    return;
  }
  renderOrderList(upcomingList, orders, { showDate: true });
}

function renderDayOrders(orders) {
  if (!orders.length) {
    dayOrderList.innerHTML = `
      <div class="empty-block">
        <p>이날 등록된 주문이 없어요.</p>
        <button type="button" class="btn secondary" data-open-new>이 날짜로 새 주문 등록</button>
      </div>`;
    dayOrderList.querySelector('[data-open-new]').addEventListener('click', openNewOrderPanel);
    return;
  }
  renderOrderList(dayOrderList, orders);
}

async function loadDayOrders(dateStr) {
  const isToday = dateStr === todayStr;
  dayTitle.textContent = `${formatKoreanDate(dateStr)}${isToday ? ' 오늘' : ''} 주문`;
  daySub.textContent =
    dateStr < todayStr
      ? '지난 날짜예요. 정산 확인은 그대로 할 수 있어요.'
      : '목록에서 주문을 고르면 참여하고 정산할 수 있어요.';

  // 달력에서 이미 받아온 목록이 있으면 바로 보여주고, 최신 참여 인원은 뒤에서 다시 받아온다.
  const cached = ordersByDate[dateStr];
  if (cached) renderDayOrders(cached);
  else dayOrderList.innerHTML = '<p class="empty-state">불러오는 중...</p>';

  if (!supabaseClient) {
    if (!cached) dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage())}</p>`;
    return;
  }

  const seq = ++dayRequestSeq;
  const { data: orders, error } = await withTimeout(
    supabaseClient
      .from('orders')
      .select(`${ORDER_COLUMNS}, participants(count)`)
      .eq('order_date', dateStr)
      .order('order_time', { ascending: true })
  );

  if (seq !== dayRequestSeq || selectedDate !== dateStr) return;
  if (error) {
    console.error(error);
    if (!cached) {
      dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage(error))}</p>`;
    }
    return;
  }
  renderDayOrders(orders);
}

// ── 새 주문 등록 (오른쪽 영역 안에서 펼침)
function openNewOrderPanel() {
  newOrderForm.reset();
  newOrderError.classList.remove('show');
  document.getElementById('ordererName').value = safeStore.get('localStorage', 'bt:myName') || '';
  document.getElementById('orderDate').value = selectedDate || todayStr;
  newOrderPanel.hidden = false;
  newOrderPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const first = document.getElementById(
    document.getElementById('ordererName').value ? 'newStoreName' : 'ordererName'
  );
  setTimeout(() => first.focus({ preventScroll: true }), 50);
}

document.getElementById('openNewOrderBtn').addEventListener('click', openNewOrderPanel);
document.getElementById('newOrderCancel').addEventListener('click', () => {
  newOrderPanel.hidden = true;
});

document.getElementById('backToDay').addEventListener('click', () => {
  // 이 주문 날짜의 목록으로 돌아간다 (공유 링크로 바로 들어온 경우도 같은 동작)
  const date = currentOrder ? currentOrder.order_date : selectedDate || todayStr;
  navigate(`date=${date}`);
});

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
  const orderDate = document.getElementById('orderDate').value;
  const orderTime = document.getElementById('orderTime').value;
  const pin = document.getElementById('orderPin').value.trim();
  const quizQuestion = document.getElementById('quizQuestion').value.trim();
  const quizAnswer = document.getElementById('quizAnswer').value.trim();

  if (!ordererName || !storeName || !orderDate || !orderTime || !pin || !quizQuestion || !quizAnswer) {
    showFormError('모든 항목을 입력해주세요.');
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    showFormError('관리 비밀번호는 숫자 4자리로 입력해주세요.');
    return;
  }
  if (!supabaseClient) {
    showFormError(connectionErrorMessage());
    return;
  }

  let createdId = null;
  await withBusy(newOrderSubmit, '등록 중...', async () => {
    const { data, error } = await withTimeout(
      supabaseClient
        .rpc('create_order', {
          p_orderer_name: ordererName,
          p_store_name: storeName,
          p_order_date: orderDate,
          p_order_time: orderTime,
          p_pin: pin,
          p_quiz_question: quizQuestion,
          p_quiz_answer: quizAnswer,
        })
        .single()
    );

    if (error || !data) {
      console.error(error);
      showFormError(
        error && error.message === 'TIMEOUT'
          ? connectionErrorMessage(error)
          : '등록에 실패했어요. 잠시 후 다시 시도해주세요.'
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
    loadMonth();
    loadUpcoming();
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
document.getElementById('todayBtn').addEventListener('click', () => navigate(`date=${todayStr}`));

// 다른 사람이 주문을 추가했을 수 있으니, 탭으로 돌아오면 다시 불러온다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  loadMonth();
  loadUpcoming();
  if (!dayViewEl.hidden && selectedDate) loadDayOrders(selectedDate);
});

loadMonth();
loadUpcoming();
route();
