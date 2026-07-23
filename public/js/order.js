const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

const storeNameEl = document.getElementById('storeName');
const infoRowEl = document.getElementById('infoRow');
const participantListEl = document.getElementById('participantList');
const participantEmptyEl = document.getElementById('participantEmpty');
const countBadgeEl = document.getElementById('countBadge');
const joinForm = document.getElementById('joinForm');
const joinError = document.getElementById('joinError');
const joinBtn = document.getElementById('joinBtn');
const settleForm = document.getElementById('settleForm');
const settleSummaryEl = document.getElementById('settleSummary');
const toast = document.getElementById('toast');

const MAX_PARTICIPANTS = 10;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatWon(n) {
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

if (!orderId) {
  storeNameEl.textContent = '잘못된 접근입니다.';
} else {
  loadOrder();
}

async function loadOrder() {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) {
    storeNameEl.textContent = '주문을 찾을 수 없어요.';
    return;
  }
  const order = await res.json();
  render(order);
}

function render(order) {
  document.title = `${order.store_name} - 밥투게더`;
  storeNameEl.textContent = order.store_name;
  infoRowEl.innerHTML = `
    <span>👤 주문자 ${escapeHtml(order.orderer_name)}</span>
    <span>📅 ${order.order_date}</span>
    <span>🕒 ${order.order_time}</span>
  `;

  countBadgeEl.textContent = `${order.participants.length}/${MAX_PARTICIPANTS}명`;

  participantListEl.innerHTML = '';
  participantEmptyEl.style.display = order.participants.length ? 'none' : 'block';

  let total = 0;
  order.participants.forEach((p) => {
    if (p.amount) total += p.amount;
    const row = document.createElement('div');
    row.className = 'participant-row';
    row.innerHTML = `
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="menu">${escapeHtml(p.menu)}</span>
      <input type="number" min="0" step="100" placeholder="금액" value="${p.amount ?? ''}" data-pid="${p.id}" />
      <button class="remove-btn" data-remove="${p.id}" title="삭제">✕</button>
    `;
    participantListEl.appendChild(row);
  });

  settleSummaryEl.innerHTML = `
    <div class="settle-summary">
      <div class="row"><span class="label">참여자 합계</span><span>${formatWon(total)}</span></div>
      ${
        order.account_number
          ? `<div class="row"><span class="label">입금 계좌</span><span>${escapeHtml(
              order.bank_name || ''
            )} ${escapeHtml(order.account_number)} (${escapeHtml(order.account_holder || '')})</span></div>`
          : `<div class="row"><span class="label">입금 계좌</span><span>아직 등록되지 않았어요</span></div>`
      }
    </div>
  `;

  document.getElementById('bankName').value = order.bank_name || '';
  document.getElementById('accountHolder').value = order.account_holder || '';
  document.getElementById('accountNumber').value = order.account_number || '';

  joinBtn.disabled = order.participants.length >= MAX_PARTICIPANTS;
  joinBtn.textContent =
    order.participants.length >= MAX_PARTICIPANTS ? '참여 마감 (10/10)' : '참여하기';

  participantListEl.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener('change', async () => {
      const pid = input.dataset.pid;
      const res = await fetch(`/api/orders/${orderId}/participants/${pid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: input.value }),
      });
      const data = await res.json();
      if (res.ok) {
        render(data);
        showToast('정산금액이 저장되었어요.');
      } else {
        showToast(data.error || '저장에 실패했어요.');
      }
    });
  });

  participantListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('참여자를 삭제할까요?')) return;
      const pid = btn.dataset.remove;
      const res = await fetch(`/api/orders/${orderId}/participants/${pid}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        render(data);
        showToast('삭제되었어요.');
      } else {
        showToast(data.error || '삭제에 실패했어요.');
      }
    });
  });
}

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  joinError.classList.remove('show');

  const payload = {
    name: document.getElementById('joinName').value,
    menu: document.getElementById('joinMenu').value,
  };

  const res = await fetch(`/api/orders/${orderId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    joinError.textContent = data.error || '참여에 실패했어요.';
    joinError.classList.add('show');
    return;
  }

  joinForm.reset();
  render(data);
  showToast('참여가 등록되었어요!');
});

settleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    bankName: document.getElementById('bankName').value,
    accountHolder: document.getElementById('accountHolder').value,
    accountNumber: document.getElementById('accountNumber').value,
  };

  const res = await fetch(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (res.ok) {
    render(data);
    showToast('정산 계좌가 저장되었어요.');
  } else {
    showToast(data.error || '저장에 실패했어요.');
  }
});
