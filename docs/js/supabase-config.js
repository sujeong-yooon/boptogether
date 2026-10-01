// Supabase 프로젝트 설정 (Settings > API 에서 확인)
// 아래 두 값을 자신의 프로젝트 값으로 바꿔주세요.
const SUPABASE_URL = 'https://jjapxlrnmlbxxugquflk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tipPz5hO2efvLT-wcggPvQ_Be-xDJpu';

// CDN 스크립트가 막히거나 늦게 떠도 페이지 전체가 멈추지 않도록,
// 클라이언트를 못 만들면 null로 두고 각 화면에서 안내 문구를 띄운다.
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// 네트워크가 끊기거나 Supabase 프로젝트가 일시정지된 경우 요청이 오래 매달리지 않도록
// 일정 시간이 지나면 실패로 처리한다.
function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: 'TIMEOUT' } }), ms)
    ),
  ]);
}

// 사용자에게 보여줄 연결 실패 안내
function connectionErrorMessage(error) {
  if (!supabaseClient) return '서버 라이브러리를 불러오지 못했어요. 새로고침해주세요.';
  if (error && error.message === 'TIMEOUT') {
    return '서버 응답이 없어요. 잠시 후 다시 시도해주세요.';
  }
  return '서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.';
}

// 브라우저 저장소는 사생활 보호 모드 등에서 막힐 수 있어 항상 감싸서 쓴다.
const safeStore = {
  get(storage, key) {
    try {
      return window[storage].getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(storage, key, value) {
    try {
      window[storage].setItem(key, value);
    } catch (e) {
      /* 저장 실패는 무시 */
    }
  },
};

// 기억한 이름이 있으면 이름 칸을 숨기고 그 이름으로 바로 쓴다. 바꿀 때만 칸을 다시 연다.
function applyKnownName(input, note, verb) {
  const name = safeStore.get('localStorage', 'bt:myName') || '';
  const field = input.closest('div');
  input.value = name;
  field.hidden = Boolean(name);
  note.hidden = !name;
  input.form.classList.toggle('named', Boolean(name));
  if (!name) return;
  note.innerHTML = `<b>${escapeHtml(name)}</b> 님으로 ${verb}. <button type="button" class="link-btn muted">이름 바꾸기</button>`;
  note.querySelector('button').addEventListener('click', () => {
    field.hidden = false;
    note.hidden = true;
    input.form.classList.remove('named');
    input.focus();
    input.select();
  });
}

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → '9월 30일 (수)'
function formatKoreanDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${m}월 ${d}일 (${DOW_LABELS[dow]})`;
}

// '12:00' 또는 '12:00:00' → '오후 12:00'
function formatKoreanTime(timeStr) {
  if (!timeStr) return '';
  const [hh, mm] = timeStr.split(':').map(Number);
  if (Number.isNaN(hh)) return timeStr;
  const ampm = hh < 12 ? '오전' : '오후';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${ampm} ${h12}:${String(mm || 0).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// 버튼을 누르는 동안 비활성화해서 중복 제출을 막는다.
async function withBusy(button, busyText, fn) {
  if (button.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
