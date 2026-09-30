const monthLabel = document.getElementById('monthLabel');
const calGrid = document.getElementById('calGrid');
const calStatus = document.getElementById('calStatus');
const upcomingList = document.getElementById('upcomingList');
const dayModalBackdrop = document.getElementById('dayModalBackdrop');
const dayModalTitle = document.getElementById('dayModalTitle');
const dayOrderList = document.getElementById('dayOrderList');
const newOrderBackdrop = document.getElementById('newOrderBackdrop');
const newOrderForm = document.getElementById('newOrderForm');
const newOrderError = document.getElementById('newOrderError');
const newOrderSubmit = document.getElementById('newOrderSubmit');

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth() + 1; // 1-12
let selectedDate = null;
let ordersByDate = {};
let monthRequestSeq = 0;

const MAX_PARTICIPANTS = 10;

// pin_hash/quiz_answer_hash/계좌 정보는 절대 일반 조회로 내려받지 않도록
// 컬럼을 명시적으로 지정 (계좌는 reveal_settlement() 함수로만 받아옴)
const ORDER_COLUMNS =
  'id, orderer_name, store_name, order_date, order_time, quiz_question, created_at';

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const todayStr = fmtDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

function participantCount(order) {
  return order.participants && order.participants[0] ? order.participants[0].count : 0;
}

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
    cell.addEventListener('click', () => openDayModal(dateStr));
    calGrid.appendChild(cell);
  }
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
    item.href = `order.html?id=${o.id}`;
    item.innerHTML = orderItemHtml(o, opts);
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

// ── 모달 열고 닫기 (배경 스크롤 잠금, ESC로 닫기)
function openModal(backdrop) {
  backdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(backdrop) {
  backdrop.classList.add('hidden');
  if (!document.querySelector('.modal-backdrop:not(.hidden)')) {
    document.body.classList.remove('modal-open');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(closeModal);
});

function renderDayOrders(orders) {
  if (!orders.length) {
    dayOrderList.innerHTML =
      '<p class="empty-state">등록된 주문이 없어요. 새 주문을 등록해보세요!</p>';
    return;
  }
  renderOrderList(dayOrderList, orders);
}

async function openDayModal(dateStr) {
  selectedDate = dateStr;
  dayModalTitle.textContent = `${formatKoreanDate(dateStr)} 주문`;
  openModal(dayModalBackdrop);

  // 달력에서 이미 받아온 목록을 바로 보여주고, 최신 참여 인원은 뒤에서 다시 받아온다.
  const cached = ordersByDate[dateStr];
  if (cached) renderDayOrders(cached);
  else dayOrderList.innerHTML = '<p class="empty-state">불러오는 중...</p>';

  if (!supabaseClient) {
    if (!cached) dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage())}</p>`;
    return;
  }

  const { data: orders, error } = await withTimeout(
    supabaseClient
      .from('orders')
      .select(`${ORDER_COLUMNS}, participants(count)`)
      .eq('order_date', dateStr)
      .order('order_time', { ascending: true })
  );

  if (selectedDate !== dateStr) return;
  if (error) {
    console.error(error);
    if (!cached) {
      dayOrderList.innerHTML = `<p class="empty-state">${escapeHtml(connectionErrorMessage(error))}</p>`;
    }
    return;
  }
  renderDayOrders(orders);
}

document.getElementById('dayModalClose').addEventListener('click', () => closeModal(dayModalBackdrop));
dayModalBackdrop.addEventListener('click', (e) => {
  if (e.target === dayModalBackdrop) closeModal(dayModalBackdrop);
});

document.getElementById('openNewOrderBtn').addEventListener('click', () => {
  closeModal(dayModalBackdrop);
  newOrderForm.reset();
  newOrderError.classList.remove('show');
  document.getElementById('ordererName').value = safeStore.get('localStorage', 'bt:myName') || '';
  document.getElementById('orderDate').value = selectedDate || todayStr;
  openModal(newOrderBackdrop);
  const first = document.getElementById(
    document.getElementById('ordererName').value ? 'storeName' : 'ordererName'
  );
  setTimeout(() => first.focus(), 50);
});

document.getElementById('newOrderClose').addEventListener('click', () => closeModal(newOrderBackdrop));
newOrderBackdrop.addEventListener('click', (e) => {
  if (e.target === newOrderBackdrop) closeModal(newOrderBackdrop);
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
  const storeName = document.getElementById('storeName').value.trim();
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
    // 방금 만든 주문자는 상세 화면에서 관리 비밀번호를 다시 치지 않아도 되게 이 탭에만 기억한다.
    safeStore.set('sessionStorage', `bt:pin:${data.id}`, pin);
    window.location.href = `order.html?id=${data.id}&created=1`;
  });
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

// 다른 사람이 주문을 추가했을 수 있으니, 탭으로 돌아오면 다시 불러온다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadMonth();
    loadUpcoming();
  }
});

loadMonth();
loadUpcoming();
