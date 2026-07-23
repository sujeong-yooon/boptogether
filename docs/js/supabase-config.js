// Supabase 프로젝트 설정 (Settings > API 에서 확인)
// 아래 두 값을 자신의 프로젝트 값으로 바꿔주세요.
const SUPABASE_URL = 'https://jjapxlrnmlbxxugquflk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tipPz5hO2efvLT-wcggPvQ_Be-xDJpu';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
