const params = new URLSearchParams(window.location.search);
const orderIdRaw = params.get('id');
const orderId = /^\d+$/.test(orderIdRaw || '') ? Number(orderIdRaw) : null;

const storeNameEl = document.getElementById('storeName');
const infoRowEl = document.getElementById('infoRow');
const orderStatusEl = document.getElementById('orderStatus');
const orderBodyEl = document.getElementById('orderBody');
const createdNoteEl = document.getElementById('createdNote');
const shareBtn = document.getElementById('shareBtn');
const participantListEl = document.getElementById('participantList');
const participantEmptyEl = document.getElementById('participantEmpty');
const countBadgeEl = document.getElementById('countBadge');
const joinForm = document.getElementById('joinForm');
const joinError = document.getElementById('joinError');
const joinBtn = document.getElementById('joinBtn');
const settleForm = document.getElementById('settleForm');
const settleBtn = document.getElementById('settleBtn');
const settleSummaryEl = document.getElementById('settleSummary');
const deleteOrderBtn = document.getElementById('deleteOrderBtn');
const managePinEl = document.getElementById('managePin');
const ownerEntryEl = document.getElementById('ownerEntry');
const ownerLoginForm = document.getElementById('ownerLoginForm');
const ownerLoginBtn = document.getElementById('ownerLoginBtn');
const ownerLoginError = document.getElementById('ownerLoginError');
const ownerPanelEl = document.getElementById('ownerPanel');
const ownerBadgeEl = document.getElementById('ownerBadge');

const MAX_PARTICIPANTS = 10;
const PIN_KEY = `bt:pin:${orderId}`;
const MINE_KEY = `bt:mine:${orderId}`;

// pin_hash/quiz_answer_hash/계좌 정보는 절대 일반 조회로 내려받지 않도록
// 컬럼을 명시적으로 지정 (계좌는 reveal_settlement() 함수로 퀴즈를 맞혀야만 받아옴)
const ORDER_COLUMNS =
  'id, orderer_name, store_name, order_date, order_time, quiz_question, created_at';

let currentOrder = null;
// 서버에서 확인된 관리 비밀번호. 값이 있으면 주문자 화면을 보여준다.
// 화면을 나누는 것은 편의일 뿐이고, 실제 권한 검사는 매번 서버 함수가 비밀번호로 한다.
let ownerPin = null;
// 퀴즈로 계좌를 한 번 열람하면 이 페이지에 있는 동안은 다시 가리지 않음
let revealedAccount = null;

function shareUrl() {
  return `${window.location.origin}${window.location.pathname}?id=${orderId}`;
}

function formatWon(n) {
  return `${Number(n).toLocaleString('ko-KR')}원`;
}

function isOwner() {
  return ownerPin !== null;
}

// 이 기기에서 등록한 참여 건. 참여자는 자기 것만 취소 버튼이 보인다.
function myParticipantIds() {
  try {
    return JSON.parse(safeStore.get('localStorage', MINE_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function setMyParticipantIds(ids) {
  safeStore.set('localStorage', MINE_KEY, JSON.stringify(ids));
}

function pinErrorMessage(error, fallback) {
  if (error && error.message && error.message.includes('INVALID_PIN')) {
    return '관리 비밀번호가 틀렸어요.';
  }
  if (error && error.message === 'TIMEOUT') return connectionErrorMessage(error);
  return fallback;
}

function forgetPin() {
  try {
    window.localStorage.removeItem(PIN_KEY);
  } catch (e) {
    /* 무시 */
  }
}

// 관리 비밀번호를 서버에서 확인하고, 맞으면 주문자 화면으로 바꾼다.
// 성공 시 저장된 계좌도 함께 받아와 퀴즈 없이 보여주고 수정 칸에 채운다.
async function enterOwnerMode(pin, { silent = false } = {}) {
  const { data, error } = await withTimeout(
    supabaseClient.rpc('verify_order_pin', { p_order_id: orderId, p_pin: pin }).maybeSingle()
  );
  if (error) {
    console.error(error);
    if (error.message && error.message.includes('INVALID_PIN')) forgetPin();
    if (!silent) {
      ownerLoginError.textContent = pinErrorMessage(error, '확인에 실패했어요. 잠시 후 다시 시도해주세요.');
      ownerLoginError.classList.remove('show');
      void ownerLoginError.offsetWidth;
      ownerLoginError.classList.add('show');
    }
    return false;
  }
  ownerPin = pin;
  safeStore.set('localStorage', PIN_KEY, pin);
  const account = data || {};
  revealedAccount = {
    bank_name: account.bank_name || null,
    account_holder: account.account_holder || null,
    account_number: account.account_number || null,
  };
  document.getElementById('bankName').value = revealedAccount.bank_name || '';
  document.getElementById('accountHolder').value = revealedAccount.account_holder || '';
  document.getElementById('accountNumber').value = revealedAccount.account_number || '';
  managePinEl.value = '';
  ownerLoginError.classList.remove('show');
  if (currentOrder) render();
  return true;
}

function exitOwnerMode() {
  ownerPin = null;
  revealedAccount = null;
  forgetPin();
  ['bankName', 'accountHolder', 'accountNumber'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  ownerLoginForm.hidden = true;
  render();
  showToast('참여자 화면으로 돌아왔어요.');
}

// 주문자 모드 중 비밀번호가 서버에서 거절되면 모드를 해제한다.
function handleOwnerError(error, fallback) {
  if (error && error.message && error.message.includes('INVALID_PIN')) {
    ownerPin = null;
    revealedAccount = null;
    forgetPin();
    render();
    return '관리 비밀번호가 맞지 않아 주문자 모드를 해제했어요.';
  }
  return pinErrorMessage(error, fallback);
}

function setOrderStatus(msg, { retry = false } = {}) {
  orderStatusEl.className = `status-bar ${msg ? 'show error' : ''}`;
  orderStatusEl.innerHTML = msg ? `<span>${escapeHtml(msg)}</span>` : '';
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent = '다시 시도';
    btn.addEventListener('click', loadOrder);
    orderStatusEl.appendChild(btn);
  }
}

// ── 확인 창 (브라우저 기본 confirm 대신 앱 스타일 모달)
const confirmBackdrop = document.getElementById('confirmBackdrop');
function askConfirm(message, okLabel = '삭제') {
  return new Promise((resolve) => {
    document.getElementById('confirmMsg').textContent = message;
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    okBtn.textContent = okLabel;
    confirmBackdrop.classList.remove('hidden');
    document.body.classList.add('modal-open');
    okBtn.focus();

    const done = (result) => {
      confirmBackdrop.classList.add('hidden');
      document.body.classList.remove('modal-open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBackdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onBackdrop = (e) => {
      if (e.target === confirmBackdrop) done(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    confirmBackdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

async function loadOrder() {
  if (!supabaseClient) {
    setOrderStatus(connectionErrorMessage());
    storeNameEl.textContent = '밥투게더';
    return;
  }

  const { data: order, error } = await withTimeout(
    supabaseClient
      .from('orders')
      .select(`${ORDER_COLUMNS}, participants(id, name, menu, amount, created_at)`)
      .eq('id', orderId)
      .order('id', { referencedTable: 'participants', ascending: true })
      .maybeSingle()
  );

  if (error) {
    console.error(error);
    // 이미 화면에 주문이 떠 있으면 그대로 두고 안내만 한다.
    if (!currentOrder) storeNameEl.textContent = '주문을 불러오지 못했어요';
    setOrderStatus(connectionErrorMessage(error), { retry: true });
    return;
  }
  if (!order) {
    storeNameEl.textContent = '주문을 찾을 수 없어요';
    infoRowEl.innerHTML = '<span>삭제된 주문이거나 잘못된 링크예요.</span>';
    orderBodyEl.hidden = true;
    shareBtn.hidden = true;
    createdNoteEl.hidden = true;
    return;
  }

  setOrderStatus('');
  currentOrder = order;
  render();
}

function render() {
  const order = currentOrder;
  document.title = `${order.store_name} - 밥투게더`;
  storeNameEl.textContent = order.store_name;
  infoRowEl.innerHTML = `
    <span>👤 주문자 ${escapeHtml(order.orderer_name)}</span>
    <span>📅 ${escapeHtml(formatKoreanDate(order.order_date))}</span>
    <span>🕒 ${escapeHtml(formatKoreanTime(order.order_time))}</span>
  `;
  shareBtn.hidden = false;
  orderBodyEl.hidden = false;
  ownerBadgeEl.hidden = !isOwner();
  ownerPanelEl.hidden = !isOwner();
  ownerEntryEl.hidden = isOwner();

  renderParticipants();
  renderSettlement();
}

function renderParticipants() {
  const participants = currentOrder.participants;
  const full = participants.length >= MAX_PARTICIPANTS;
  const owner = isOwner();
  const mine = myParticipantIds();
  countBadgeEl.textContent = `${participants.length}/${MAX_PARTICIPANTS}명`;
  participantEmptyEl.hidden = participants.length > 0;
  participantListEl.innerHTML = '';

  participants.forEach((p, i) => {
    const isMine = mine.includes(p.id);
    const canRemove = owner || isMine;
    const row = document.createElement('div');
    row.className = 'participant-row' + (isMine ? ' mine' : '');
    row.style.setProperty('--i', i);
    const amountCell = owner
      ? `<input type="number" inputmode="numeric" min="0" step="100" placeholder="금액"
          value="${p.amount ?? ''}" aria-label="${escapeHtml(p.name)} 정산금액" />`
      : `<span class="amount ${p.amount == null ? 'empty' : ''}">${
          p.amount == null ? '미정' : formatWon(p.amount)
        }</span>`;
    row.innerHTML = `
      <span class="name">${escapeHtml(p.name)}${isMine ? ' <small class="me">나</small>' : ''}</span>
      <span class="menu">${escapeHtml(p.menu)}</span>
      ${amountCell}
      ${
        canRemove
          ? `<button type="button" class="remove-btn" title="참여 취소" aria-label="${escapeHtml(p.name)} 참여 취소">✕</button>`
          : '<span class="remove-spacer"></span>'
      }
    `;
    const input = row.querySelector('input');
    if (input) {
      input.addEventListener('change', () => saveAmount(p, input));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }
    const removeBtn = row.querySelector('.remove-btn');
    if (removeBtn) removeBtn.addEventListener('click', () => removeParticipant(p));
    participantListEl.appendChild(row);
  });

  joinBtn.disabled = full;
  joinBtn.textContent = full ? `참여 마감 (${MAX_PARTICIPANTS}/${MAX_PARTICIPANTS})` : '참여하기';
  joinForm.querySelectorAll('input').forEach((el) => (el.disabled = full));
}

function settlementTotals() {
  const participants = currentOrder.participants;
  const total = participants.reduce((sum, p) => sum + (p.amount || 0), 0);
  const missing = participants.filter((p) => p.amount == null).length;
  return { total, missing };
}

function renderSettlement() {
  const order = currentOrder;
  const { total, missing } = settlementTotals();

  let accountHtml;
  if (revealedAccount) {
    const emptyMsg = isOwner()
      ? '아직 등록하지 않았어요. 아래 주문자 관리에서 등록해주세요.'
      : '아직 등록되지 않았어요';
    accountHtml = revealedAccount.account_number
      ? `<div class="row account">
           <span class="label">입금 계좌</span>
           <span class="value">${escapeHtml(revealedAccount.bank_name || '')} ${escapeHtml(
             revealedAccount.account_number
           )}<br /><small>예금주 ${escapeHtml(revealedAccount.account_holder || '-')}</small></span>
         </div>
         <button type="button" class="btn full secondary" id="copyAccountBtn">계좌번호 복사</button>`
      : `<div class="row account"><span class="label">입금 계좌</span><span class="value muted">${emptyMsg}</span></div>`;
  } else {
    accountHtml = `
      <div class="reveal-box">
        <p class="hint">🔒 계좌 정보는 주문자가 낸 퀴즈를 맞히면 볼 수 있어요.</p>
        <label for="revealAnswer">${escapeHtml(order.quiz_question || '퀴즈 질문')}</label>
        <input type="text" id="revealAnswer" maxlength="30" placeholder="정답 입력" autocomplete="off" />
        <p class="error-text" id="revealError"></p>
        <button type="button" class="btn full secondary" id="revealBtn">계좌 확인</button>
      </div>`;
  }

  settleSummaryEl.innerHTML = `
    <div class="settle-summary">
      <div class="row"><span class="label">참여자 합계</span><strong id="totalAmount">${formatWon(total)}</strong></div>
      <div class="row sub" id="missingRow" ${missing ? '' : 'hidden'}>
        <span class="label">금액 미입력</span><span id="missingCount">${missing}명</span>
      </div>
    </div>
    ${accountHtml}
  `;

  const copyBtn = document.getElementById('copyAccountBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(revealedAccount.account_number.replace(/[^\d]/g, ''));
      showToast(ok ? '계좌번호를 복사했어요.' : '복사에 실패했어요. 길게 눌러 복사해주세요.');
    });
  }

  const revealBtn = document.getElementById('revealBtn');
  if (revealBtn) {
    const answerEl = document.getElementById('revealAnswer');
    revealBtn.addEventListener('click', () => reveal(revealBtn, answerEl));
    answerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') reveal(revealBtn, answerEl);
    });
  }
}

// 금액만 바뀐 경우 전체를 다시 그리지 않고 합계만 갱신한다 (입력칸 포커스 유지)
function refreshTotals() {
  const { total, missing } = settlementTotals();
  const totalEl = document.getElementById('totalAmount');
  if (totalEl) totalEl.textContent = formatWon(total);
  const missingRow = document.getElementById('missingRow');
  if (missingRow) {
    missingRow.hidden = !missing;
    document.getElementById('missingCount').textContent = `${missing}명`;
  }
}

async function reveal(btn, answerEl) {
  const answer = answerEl.value.trim();
  const revealError = document.getElementById('revealError');
  revealError.classList.remove('show');

  if (!answer) {
    revealError.textContent = '정답을 입력해주세요.';
    revealError.classList.add('show');
    return;
  }

  await withBusy(btn, '확인 중...', async () => {
    const { data, error } = await withTimeout(
      supabaseClient.rpc('reveal_settlement', { p_order_id: orderId, p_quiz_answer: answer }).single()
    );

    if (error) {
      console.error(error);
      revealError.textContent = error.message.includes('WRONG_ANSWER')
        ? '정답이 아니에요. 주문자에게 물어보세요.'
        : connectionErrorMessage(error);
      revealError.classList.add('show');
      return;
    }
    revealedAccount = data;
  });
  if (revealedAccount) renderSettlement();
}

async function saveAmount(p, input) {
  const prev = p.amount ?? '';
  const raw = input.value.trim();
  const amount = raw === '' ? null : Math.round(Number(raw));

  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    showToast('금액은 0 이상의 숫자로 입력해주세요.');
    input.value = prev;
    return;
  }
  const pin = ownerPin;
  if (!pin) {
    input.value = prev;
    return;
  }

  input.disabled = true;
  const { error } = await withTimeout(
    supabaseClient.rpc('update_participant_amount', {
      p_participant_id: p.id,
      p_order_id: orderId,
      p_pin: pin,
      p_amount: amount,
    })
  );
  input.disabled = false;

  if (error) {
    console.error(error);
    input.value = prev;
    showToast(handleOwnerError(error, '저장에 실패했어요.'));
    return;
  }
  p.amount = amount;
  input.value = amount ?? '';
  refreshTotals();
  showToast(`${p.name} 님 금액을 저장했어요.`);
}

async function removeParticipant(p) {
  const ok = await askConfirm(`${p.name} 님의 참여를 취소할까요?`, '참여 취소');
  if (!ok) return;

  const { error } = await withTimeout(
    supabaseClient.from('participants').delete().eq('id', p.id)
  );
  if (error) {
    console.error(error);
    showToast(error.message === 'TIMEOUT' ? connectionErrorMessage(error) : '삭제에 실패했어요.');
    return;
  }
  setMyParticipantIds(myParticipantIds().filter((id) => id !== p.id));
  await loadOrder();
  showToast('참여를 취소했어요.');
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
  if (currentOrder.participants.some((p) => p.name === name && p.menu === menu)) {
    joinError.textContent = '같은 이름과 메뉴로 이미 참여했어요.';
    joinError.classList.add('show');
    return;
  }

  let joined = false;
  await withBusy(joinBtn, '등록 중...', async () => {
    const { data, error } = await withTimeout(
      supabaseClient.from('participants').insert({ order_id: orderId, name, menu }).select('id').single()
    );
    if (error) {
      console.error(error);
      joinError.textContent = error.message.includes('MAX_PARTICIPANTS_REACHED')
        ? `참여자는 최대 ${MAX_PARTICIPANTS}명까지 가능해요.`
        : connectionErrorMessage(error);
      joinError.classList.add('show');
      return;
    }
    joined = true;
    if (data && data.id) setMyParticipantIds([...myParticipantIds(), data.id]);
  });

  // 버튼 상태(마감 여부)는 새로 불러온 뒤 다시 정해지므로 withBusy 밖에서 갱신한다.
  await loadOrder();
  if (joined) {
    safeStore.set('localStorage', 'bt:myName', name);
    document.getElementById('joinMenu').value = '';
    showToast('참여가 등록되었어요!');
  }
});

settleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = ownerPin;
  if (!pin) return;

  const bank = document.getElementById('bankName').value.trim();
  const holder = document.getElementById('accountHolder').value.trim();
  const number = document.getElementById('accountNumber').value.trim();
  if (!bank || !holder || !number) {
    showToast('은행명, 예금주, 계좌번호를 모두 입력해주세요.');
    return;
  }

  await withBusy(settleBtn, '저장 중...', async () => {
    const { error } = await withTimeout(
      supabaseClient.rpc('update_settlement', {
        p_order_id: orderId,
        p_pin: pin,
        p_bank_name: bank,
        p_account_holder: holder,
        p_account_number: number,
      })
    );

    if (error) {
      console.error(error);
      showToast(handleOwnerError(error, '저장에 실패했어요.'));
      return;
    }
    revealedAccount = { bank_name: bank, account_holder: holder, account_number: number };
    renderSettlement();
    showToast('정산 계좌가 저장되었어요.');
  });
});

deleteOrderBtn.addEventListener('click', async () => {
  const pin = ownerPin;
  if (!pin) return;
  const ok = await askConfirm('정말 이 주문을 삭제할까요? 참여자 정보도 모두 함께 사라져요.');
  if (!ok) return;

  await withBusy(deleteOrderBtn, '삭제 중...', async () => {
    const { error } = await withTimeout(
      supabaseClient.rpc('delete_order', { p_order_id: orderId, p_pin: pin })
    );
    if (error) {
      console.error(error);
      showToast(handleOwnerError(error, '삭제에 실패했어요.'));
      return;
    }
    forgetPin();
    safeStore.set('localStorage', MINE_KEY, '[]');
    window.location.href = 'index.html';
  });
});

shareBtn.addEventListener('click', async () => {
  const url = shareUrl();
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: `${currentOrder.store_name} 같이 주문해요`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url);
  showToast(ok ? '링크를 복사했어요. 함께 먹을 사람들에게 보내주세요.' : '복사에 실패했어요.');
});

managePinEl.addEventListener('input', () => {
  managePinEl.value = managePinEl.value.replace(/\D/g, '').slice(0, 4);
});

document.getElementById('ownerEntryToggle').addEventListener('click', () => {
  ownerLoginForm.hidden = !ownerLoginForm.hidden;
  if (!ownerLoginForm.hidden) managePinEl.focus();
});

ownerLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = managePinEl.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    ownerLoginError.textContent = '숫자 4자리를 입력해주세요.';
    ownerLoginError.classList.add('show');
    return;
  }
  let ok = false;
  await withBusy(ownerLoginBtn, '확인 중', async () => {
    ok = await enterOwnerMode(pin);
  });
  if (ok) {
    showToast('주문자 모드로 전환했어요.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

document.getElementById('ownerLogoutBtn').addEventListener('click', exitOwnerMode);

// 다른 사람이 참여했을 수 있으니, 탭으로 돌아오면 다시 불러온다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && orderId && currentOrder) loadOrder();
});

if (!orderId) {
  storeNameEl.textContent = '잘못된 접근입니다';
  infoRowEl.innerHTML = '<span>주문 링크를 다시 확인해주세요.</span>';
} else {
  const savedName = safeStore.get('localStorage', 'bt:myName');
  if (savedName) document.getElementById('joinName').value = savedName;

  if (params.get('created') === '1') {
    createdNoteEl.hidden = false;
    // 주소창에서 created 표시를 지워, 이 주소를 그대로 공유해도 안내가 뜨지 않게 한다.
    history.replaceState(null, '', `?id=${orderId}`);
  }
  // 이 기기에 주문자 비밀번호가 저장돼 있으면 조용히 확인해서 주문자 화면으로 연다.
  const savedPin = safeStore.get('localStorage', PIN_KEY);
  const ownerCheck = savedPin && supabaseClient ? enterOwnerMode(savedPin, { silent: true }) : null;
  loadOrder().then(async () => {
    if (ownerCheck && (await ownerCheck) && currentOrder) render();
  });
}
