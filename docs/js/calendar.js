const monthLabel = document.getElementById('monthLabel');
const calGrid = document.getElementById('calGrid');
const dayModalBackdrop = document.getElementById('dayModalBackdrop');
const dayModalTitle = document.getElementById('dayModalTitle');
const dayOrderList = document.getElementById('dayOrderList');
const newOrderBackdrop = document.getElementById('newOrderBackdrop');
const newOrderForm = document.getElementById('newOrderForm');
const newOrderError = document.getElementById('newOrderError');
const toast = document.getElementById('toast');

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth() + 1; // 1-12
let selectedDate = null;
let ordersByDate = {};

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function participantCount(order) {
  return order.participants && order.participants[0] ? order.participants[0].count : 0;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

async function loadMonth() {
  monthLabel.textContent = `${viewYear}년 ${viewMonth}월`;

  const monthStart = fmtDate(viewYear, viewMonth, 1);
  const nextMonthYear = viewMonth === 12 ? viewYear + 1 : viewYear;
  const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
  const monthEnd = fmtDate(nextMonthYear, nextMonth, 1);

  const { data: orders, error } = await supabaseClient
    .from('orders')
    .select('*, participants(count)')
    .gte('order_date', monthStart)
    .lt('order_date', monthEnd)
    .order('order_date', { ascending: true });

  if (error) {
    showToast('불러오기에 실패했어요.');
    console.error(error);
    return;
  }

  ordersByDate = {};
  for (const o of orders) {
    if (!ordersByDate[o.order_date]) ordersByDate[o.order_date] = [];
    ordersByDate[o.order_date].push(o);
  }
  renderGrid();
}

function renderGrid() {
  calGrid.innerHTML = '';
  DOW.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const firstDay = new Date(viewYear, viewMonth - 1, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const todayStr = fmtDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    calGrid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = fmtDate(viewYear, viewMonth, d);
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (dateStr === todayStr ? ' today' : '');
    cell.style.setProperty('--i', d - 1);
    cell.innerHTML = `<span>${d}</span>`;

    const dayOrders = ordersByDate[dateStr];
    if (dayOrders && dayOrders.length) {
      const badge = document.createElement('span');
      badge.className = 'count';
      badge.textContent = `${dayOrders.length}건`;
      cell.appendChild(badge);
    }

    cell.addEventListener('click', () => openDayModal(dateStr));
    calGrid.appendChild(cell);
  }
}

async function openDayModal(dateStr) {
  selectedDate = dateStr;
  dayModalTitle.textContent = `${dateStr} 주문 목록`;
  dayOrderList.innerHTML = '<p class="empty-state">불러오는 중...</p>';
  dayModalBackdrop.classList.remove('hidden');

  const { data: orders, error } = await supabaseClient
    .from('orders')
    .select('*, participants(count)')
    .eq('order_date', dateStr)
    .order('order_time', { ascending: true });

  if (error) {
    dayOrderList.innerHTML = '<p class="empty-state">불러오기에 실패했어요.</p>';
    console.error(error);
    return;
  }

  if (!orders.length) {
    dayOrderList.innerHTML = '<p class="empty-state">등록된 주문이 없어요. 새 주문을 등록해보세요!</p>';
    return;
  }

  dayOrderList.innerHTML = '';
  orders.forEach((o) => {
    const item = document.createElement('div');
    item.className = 'order-list-item';
    item.innerHTML = `
      <div>
        <div class="store">${escapeHtml(o.store_name)}</div>
        <div class="meta">${escapeHtml(o.orderer_name)} · ${o.order_time} · 참여 ${participantCount(o)}/10</div>
      </div>
      <span>›</span>
    `;
    item.addEventListener('click', () => {
      window.location.href = `order.html?id=${o.id}`;
    });
    dayOrderList.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('dayModalClose').addEventListener('click', () => {
  dayModalBackdrop.classList.add('hidden');
});
dayModalBackdrop.addEventListener('click', (e) => {
  if (e.target === dayModalBackdrop) dayModalBackdrop.classList.add('hidden');
});

document.getElementById('openNewOrderBtn').addEventListener('click', () => {
  dayModalBackdrop.classList.add('hidden');
  newOrderError.classList.remove('show');
  document.getElementById('orderDate').value = selectedDate || fmtDate(viewYear, viewMonth, 1);
  newOrderBackdrop.classList.remove('hidden');
});

document.getElementById('newOrderClose').addEventListener('click', () => {
  newOrderBackdrop.classList.add('hidden');
});
newOrderBackdrop.addEventListener('click', (e) => {
  if (e.target === newOrderBackdrop) newOrderBackdrop.classList.add('hidden');
});

newOrderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  newOrderError.classList.remove('show');

  const ordererName = document.getElementById('ordererName').value.trim();
  const storeName = document.getElementById('storeName').value.trim();
  const orderDate = document.getElementById('orderDate').value;
  const orderTime = document.getElementById('orderTime').value;

  if (!ordererName || !storeName || !orderDate || !orderTime) {
    newOrderError.textContent = '모든 항목을 입력해주세요.';
    newOrderError.classList.add('show');
    return;
  }

  const { data, error } = await supabaseClient
    .from('orders')
    .insert({
      orderer_name: ordererName,
      store_name: storeName,
      order_date: orderDate,
      order_time: orderTime,
    })
    .select()
    .single();

  if (error) {
    newOrderError.textContent = '등록에 실패했어요. (' + error.message + ')';
    newOrderError.classList.add('show');
    console.error(error);
    return;
  }

  window.location.href = `order.html?id=${data.id}`;
});

document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth -= 1;
  if (viewMonth < 1) {
    viewMonth = 12;
    viewYear -= 1;
  }
  loadMonth();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth += 1;
  if (viewMonth > 12) {
    viewMonth = 1;
    viewYear += 1;
  }
  loadMonth();
});

loadMonth();
