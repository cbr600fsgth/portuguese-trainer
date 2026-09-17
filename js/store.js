// localStorage の読み書き。iOSのPWAは長期未使用でストレージが破棄されうるため
// エクスポート/インポートを必ず用意する。

const CARDS_KEY = 'pt.cards';
const META_KEY = 'pt.meta';
// 出発日はここだけに持つ。ソースには入れない（公開リポジトリに旅行時期を残さないため）
const TRIP_KEY = 'pt.trip';
// 旅行モードでよく使うフレーズのID配列
const FAVS_KEY = 'pt.favs';

const DEFAULT_META = {
  streak: 0,
  lastDone: null,      // 最後にセッションを完了した日 'YYYY-MM-DD'
  totalSessions: 0,
  modeOverride: null,  // 'study' | 'sweep' | 'trip' | null（nullなら日付で自動判定）
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`${key} の読み込みに失敗。初期値を使う`, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`${key} の保存に失敗`, e);
    return false;
  }
}

export function loadCards() {
  return read(CARDS_KEY, {});
}

export function saveCards(cards) {
  return write(CARDS_KEY, cards);
}

export function loadMeta() {
  return { ...DEFAULT_META, ...read(META_KEY, {}) };
}

export function saveMeta(meta) {
  return write(META_KEY, meta);
}

/** { departure: 'YYYY-MM-DD' } または未設定なら null */
export function loadTrip() {
  return read(TRIP_KEY, null);
}

export function saveTrip(trip) {
  return write(TRIP_KEY, trip);
}

/** よく使うフレーズのID配列。未設定なら空配列 */
export function loadFavs() {
  const v = read(FAVS_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function saveFavs(ids) {
  return write(FAVS_KEY, ids);
}

/** セッション完了を記録し、更新後のmetaを返す。同じ日に2回完了してもストリークは増えない */
export function recordSession(meta, today, yesterday) {
  if (meta.lastDone === today) return meta;

  const next = {
    ...meta,
    lastDone: today,
    totalSessions: (meta.totalSessions || 0) + 1,
    streak: meta.lastDone === yesterday ? (meta.streak || 0) + 1 : 1,
  };
  saveMeta(next);
  return next;
}

// ---- エクスポート / インポート ----

export function exportJSON() {
  return JSON.stringify(
    {
      version: 3,
      exportedAt: new Date().toISOString(),
      cards: loadCards(),
      meta: loadMeta(),
      trip: loadTrip(),
      favs: loadFavs(),
    },
    null,
    2
  );
}

/** 成功したら true。形式が違えば例外を投げる */
export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data.cards !== 'object' || data.cards === null) {
    throw new Error('cards が見つかりません。このアプリのエクスポートファイルではありません');
  }
  saveCards(data.cards);
  if (data.meta) saveMeta({ ...DEFAULT_META, ...data.meta });
  if (data.trip) saveTrip(data.trip);
  if (Array.isArray(data.favs)) saveFavs(data.favs);
  return true;
}

/** 進捗のみ消す。出発日と「よく使う」は学習の進捗ではないので残す */
export function resetProgress() {
  localStorage.removeItem(CARDS_KEY);
  localStorage.removeItem(META_KEY);
}

export function resetAll() {
  resetProgress();
  localStorage.removeItem(TRIP_KEY);
  localStorage.removeItem(FAVS_KEY);
}
