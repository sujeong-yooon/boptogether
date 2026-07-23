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

// pin_hash는 절대 클라이언트로 내려받지 않도록 컬럼을 명시적으로 지정
const ORDER_COLUMNS =
  'id, orderer_name, store_name, order_date, order_time, bank_name, account_number, account_holder, created_at';

function getManagePin() {
  return document.getElementById('managePin').value.trim();
}

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
  const { data: order, error } = await supabaseClient
    .from('orders')
    .select(`${ORDER_COLUMNS}, participants(*)`)
    .eq('id', orderId)
    .order('id', { foreignTable: 'participants', ascending: true })
    .single();

  if (error || !order) {
    storeNameEl.textContent = '주문을 찾을 수 없어요.';
    console.error(error);
    return;
  }
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
  order.participants.forEach((p, i) => {
    if (p.amount) total += p.amount;
    const row = document.createElement('div');
    row.className = 'participant-row';
    row.style.setProperty('--i', i);
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
    const prevValue = input.value;
    input.addEventListener('change', async () => {
      const pin = getManagePin();
      if (!/^\d{4}$/.test(pin)) {
        showToast('아래 관리 비밀번호(4자리)를 먼저 입력해주세요.');
        input.value = prevValue;
        return;
      }

      const pid = input.dataset.pid;
      const amount = input.value === '' ? null : Number(input.value);
      const { error } = await supabaseClient.rpc('update_participant_amount', {
        p_participant_id: Number(pid),
        p_order_id: Number(orderId),
        p_pin: pin,
        p_amount: amount,
      });

      if (error) {
        showToast(
          error.message.includes('INVALID_PIN') ? '관리 비밀번호가 틀렸어요.' : '저장에 실패했어요.'
        );
        console.error(error);
        return;
      }
      await loadOrder();
      showToast('정산금액이 저장되었어요.');
    });
  });

  participantListEl.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('참여자를 삭제할까요?')) return;
      const pid = btn.dataset.remove;
      const { error } = await supabaseClient.from('participants').delete().eq('id', pid);

      if (error) {
        showToast('삭제에 실패했어요.');
        console.error(error);
        return;
      }
      await loadOrder();
      showToast('삭제되었어요.');
    });
  });
}

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  joinError.classList.remove('show');

  const name = document.getElementById('joinName').value.trim();
  const menu = document.getElementById('joinMenu').value.trim();

  if (!name || !menu) {
    joinError.textContent = '이름과 메뉴를 입력해주세요.';
    joinError.classList.add('show');
    return;
  }

  const { error } = await supabaseClient
    .from('participants')
    .insert({ order_id: orderId, name, menu });

  if (error) {
    joinError.textContent = error.message.includes('MAX_PARTICIPANTS_REACHED')
      ? '참여자는 최대 10명까지 가능해요.'
      : '참여에 실패했어요.';
    joinError.classList.add('show');
    console.error(error);
    return;
  }

  joinForm.reset();
  await loadOrder();
  showToast('참여가 등록되었어요!');
});

settleForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const pin = getManagePin();
  if (!/^\d{4}$/.test(pin)) {
    showToast('관리 비밀번호(4자리)를 먼저 입력해주세요.');
    return;
  }

  const { error } = await supabaseClient.rpc('update_settlement', {
    p_order_id: Number(orderId),
    p_pin: pin,
    p_bank_name: document.getElementById('bankName').value.trim(),
    p_account_holder: document.getElementById('accountHolder').value.trim(),
    p_account_number: document.getElementById('accountNumber').value.trim(),
  });

  if (error) {
    showToast(
      error.message.includes('INVALID_PIN') ? '관리 비밀번호가 틀렸어요.' : '저장에 실패했어요.'
    );
    console.error(error);
    return;
  }
  await loadOrder();
  showToast('정산 계좌가 저장되었어요.');
});
