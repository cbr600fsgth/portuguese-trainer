import * as srs from './srs.js';
import * as store from './store.js';
import * as audio from './audio.js';

// 画面の不具合がキャッシュ由来かを切り分けるための版番号。コードを変えたら上げる。
// sw.js の VERSION と同じ値に揃える（ずれるとこの表示と配信される中身が食い違う）
const APP_VERSION = 'phase3-r2';

const SCENE_LABELS = {
  greet: 'あいさつ',
  basic: '基本',
  numero: '数字・時刻',
  pedir: '頼む・尋ねる',
  restaurante: 'レストラン',
  cafe: 'カフェ',
  transporte: '移動',
  hotel: '宿',
  compras: '買い物・チケット',
  problema: '困ったとき',
};

const $ = (id) => document.getElementById(id);

const state = {
  today: null,
  phrases: [],
  byId: {},
  cards: {},
  meta: null,
  trip: null,     // { departure: 'YYYY-MM-DD' } 端末のlocalStorageにのみ保存する
  favs: [],       // 旅行モードでよく使うフレーズのID配列
  queue: [],      // [{id, kind: 'review'|'new'}]
  index: 0,
  revealed: false,
  slow: false,
  session: null,
  tripScene: null,  // null は「すべて」。FAV_SCENE はよく使う
  tripQuery: '',
  showId: null,     // 大きく表示しているフレーズ
};

// ---- 基準日 ----

function resolveToday() {
  const q = new URLSearchParams(location.search).get('today');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return srs.isoFromDate(new Date());
}

// ---- 画面切替 ----

function show(name) {
  ['setup', 'home', 'session', 'done', 'trip', 'show', 'settings'].forEach((s) => {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
}

/** 学習期・スイープ期はホーム、出発日以降はフレーズブックへ戻る */
function goHome() {
  if (srs.modeFor(state.today, state.trip) === 'trip') {
    renderTrip();
    show('trip');
  } else {
    renderHome();
    show('home');
  }
}

// ---- 初回セットアップ ----

/**
 * 出発日を保存する。妥当でなければエラー文を返し、成功なら null を返す。
 * 出発日をソースに持たないため、この入力が唯一の設定経路になる。
 */
function applyDeparture(value) {
  const trip = { departure: value };
  if (!srs.isValidTrip(trip)) return '出発日を選んでください';
  if (srs.diffDays(state.today, value) < 0) return '出発日は今日以降にしてください';

  state.trip = trip;
  store.saveTrip(trip);
  return null;
}

function showSetup() {
  $('input-departure').value = state.trip ? state.trip.departure : '';
  $('setup-error').classList.add('hidden');
  show('setup');
}

// ---- ホーム ----

function renderHome() {
  const left = srs.daysUntilDeparture(state.today, state.trip);
  const mode = srs.modeFor(state.today, state.trip);

  $('days-left').textContent = left > 0 ? left : 0;
  $('streak').textContent = state.meta.streak || 0;

  const retained = Object.values(state.cards).filter(srs.isRetained).length;
  $('retained').textContent = retained;
  $('total').textContent = state.phrases.length;
  $('progress').style.width = `${(retained / state.phrases.length) * 100}%`;

  // ボタンは常に1つ。その日の必須分が残っていればそれを、終わっていれば再挑戦を出す。
  // 「完了」で操作を打ち切らない。区切りを宣言させないため。
  const doneToday = state.meta.lastDone === state.today;
  const s = srs.buildSession(state.today, state.cards, state.phrases, state.trip);
  const pending = s.reviewIds.length + s.newIds.length;
  const replayCount =
    mode === 'trip' ? 0 : srs.buildReplay(state.today, state.cards).length;

  $('btn-start').disabled = false;

  if (mode === 'trip') {
    $('departure-note').textContent = '旅行中';
    $('days-left').textContent = '0';
    $('btn-start').textContent = 'フレーズブックを開く';
    $('home-today').textContent = '';
  } else if (pending > 0) {
    $('btn-start').textContent = '今日の10分をはじめる';
    const parts = [];
    if (s.reviewIds.length) parts.push(`復習 ${s.reviewIds.length}`);
    if (s.newIds.length) parts.push(`新規 ${s.newIds.length}`);
    const modeLabel = mode === 'sweep' ? '最終スイープ' : null;
    $('home-today').textContent = [modeLabel, parts.join(' / ')].filter(Boolean).join('・');
  } else if (replayCount > 0) {
    $('btn-start').textContent = `もう一度やる（${replayCount}枚）`;
    $('home-today').textContent = doneToday
      ? '今日の分は完了。何回でも復習できる'
      : '今日の新規は出しきった。復習は何回でもできる';
  } else {
    $('btn-start').textContent = '今日の出題はなし';
    $('btn-start').disabled = true;
    $('home-today').textContent = '';
  }

  const warn = audio.warningText();
  $('audio-warning').textContent = warn || '';
  $('audio-warning').classList.toggle('hidden', !warn);
}

// ---- セッション ----

function startSession() {
  const s = srs.buildSession(state.today, state.cards, state.phrases, state.trip);
  state.session = s;
  state.isReplay = false;
  state.queue = [
    ...s.reviewIds.map((id) => ({ id, kind: 'review' })),
    ...s.newIds.map((id) => ({ id, kind: 'new' })),
  ];
  state.index = 0;

  if (state.queue.length === 0) return;
  show('session');
  renderCard();
}

/** その日の分をもう一度。新規は投入せず、今日さわったカードだけを出す */
function startReplay() {
  const ids = srs.buildReplay(state.today, state.cards);
  if (ids.length === 0) return;

  state.session = { reviewIds: ids, newIds: [], overflow: 0 };
  state.isReplay = true;
  state.queue = ids.map((id) => ({ id, kind: 'review' }));
  state.index = 0;

  show('session');
  renderCard();
}

function currentItem() {
  return state.queue[state.index];
}

function renderCard() {
  const item = currentItem();
  const p = state.byId[item.id];

  state.revealed = item.kind === 'new';
  state.slow = false;

  // 「だめ」で末尾に再出題されるとキューが伸びるため、分母は常に現在のキュー長を使う
  const total = state.queue.length;
  $('session-progress').style.width = `${(state.index / total) * 100}%`;
  const stage = item.kind === 'new' ? '新規' : state.isReplay ? '再挑戦' : '復習';
  $('session-stage').textContent = `${stage} ${state.index + 1}/${total}`;

  $('card-scene').textContent = SCENE_LABELS[p.scene] || p.scene;
  $('card-jp').textContent = p.jp;
  $('card-pt').textContent = p.pt;
  $('card-kana').textContent = p.kana;
  $('card-it').textContent = p.it;
  $('card-note').textContent = p.note;

  $('card-back').classList.toggle('hidden', !state.revealed);
  $('btn-reveal').classList.toggle('hidden', state.revealed);
  $('grade-row').classList.toggle('hidden', item.kind === 'new' || !state.revealed);
  $('btn-next').classList.toggle('hidden', item.kind !== 'new');

  if (state.revealed) audio.speak(p, 1.0);
}

function reveal() {
  if (state.revealed) return;
  state.revealed = true;
  $('card-back').classList.remove('hidden');
  $('btn-reveal').classList.add('hidden');
  $('grade-row').classList.remove('hidden');
  audio.speak(state.byId[currentItem().id], 1.0);
}

function grade(g) {
  const item = currentItem();
  if (item.kind !== 'review' || !state.revealed) return;

  const card = state.cards[item.id];
  state.cards[item.id] = srs.nextState(card, g, state.today);
  store.saveCards(state.cards);

  // だめ だったカードは当日セッションの末尾に再出題する
  if (g === 'again') {
    state.queue.push({ id: item.id, kind: 'review' });
  }
  advance();
}

function nextNew() {
  const item = currentItem();
  if (item.kind !== 'new') return;
  state.cards[item.id] = srs.introduce(item.id, state.today);
  store.saveCards(state.cards);
  advance();
}

function advance() {
  audio.stop();
  state.index += 1;
  if (state.index >= state.queue.length) {
    finishSession();
    return;
  }
  renderCard();
}

function finishSession() {
  // 1枚も出題していないセッションでストリークを加算しない
  if (state.queue.length > 0) {
    state.meta = store.recordSession(state.meta, state.today, srs.addDays(state.today, -1));
  }
  const meta = state.meta;

  $('done-streak').textContent = meta.streak || 0;

  const s = state.session || { reviewIds: [], newIds: [], overflow: 0 };
  const parts = [];
  if (s.reviewIds.length) {
    parts.push(`${state.isReplay ? '再挑戦' : '復習'} ${s.reviewIds.length}枚`);
  }
  if (s.newIds.length) parts.push(`新規 ${s.newIds.length}枚`);
  $('done-summary').textContent = parts.length ? parts.join(' / ') : '今日の出題はありませんでした';

  // 今日1回でも間違えたカードは、あとで正解しても明日また出る
  const carry = Object.values(state.cards).filter(
    (c) => c.gradedOn === state.today && c.dayWorst === 'again'
  ).length;
  $('done-carry').classList.toggle('hidden', carry === 0);
  if (carry > 0) {
    $('done-carry').textContent = `間違えた ${carry}枚は明日また出ます`;
  }

  // 150枚を1日30枚で回す以上、詰まる日は出る。失敗ではないので中立に伝える
  const hasOverflow = (s.overflow || 0) > 0;
  $('done-overflow').classList.toggle('hidden', !hasOverflow);
  if (hasOverflow) {
    $('done-overflow').textContent = `残り ${s.overflow}枚は明日にまわしました`;
  }

  show('done');
}

// ---- 旅行モード（実戦フレーズブック） ----
//
// 出発日以降は学習を止め、150文を引くための道具に切り替える。
// 現地で使う場面を想定し、操作は「探す・聞く・見せる」の3つだけに絞る。

const FAV_SCENE = '__fav';

/** 検索用に正規化する。アクセント記号を落として小文字に揃える */
function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** 現在の絞り込み条件に合うフレーズ。順序は phrases.json のまま */
function tripPhrases() {
  const q = normalize(state.tripQuery.trim());
  const favs = new Set(state.favs);

  return state.phrases.filter((p) => {
    if (state.tripScene === FAV_SCENE) {
      if (!favs.has(p.id)) return false;
    } else if (state.tripScene && p.scene !== state.tripScene) {
      return false;
    }
    if (!q) return true;
    return normalize([p.jp, p.pt, p.kana, p.it, p.note].join(' ')).includes(q);
  });
}

function isFav(id) {
  return state.favs.includes(id);
}

/** よく使うの出し入れ。並びは phrases.json 順に揃え直す */
function toggleFav(id) {
  const set = new Set(state.favs);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  state.favs = state.phrases.map((p) => p.id).filter((i) => set.has(i));
  store.saveFavs(state.favs);
}

function renderTrip() {
  const day = srs.diffDays(state.trip.departure, state.today) + 1;
  $('trip-day').textContent = day > 0 ? day : 1;

  renderSceneChips();
  renderTripList();

  const warn = audio.warningText();
  $('trip-audio-warning').textContent = warn || '';
  $('trip-audio-warning').classList.toggle('hidden', !warn);
}

function renderSceneChips() {
  const row = $('trip-scenes');
  const left = row.scrollLeft;

  const order = Object.keys(SCENE_LABELS);
  const scenes = [...new Set(state.phrases.map((p) => p.scene))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );

  // 最後の1件を外したときに、選べないチップが選ばれたままにならないようにする
  if (state.tripScene === FAV_SCENE && state.favs.length === 0) state.tripScene = null;

  const items = [{ key: null, label: 'すべて' }];
  if (state.favs.length > 0) {
    items.push({ key: FAV_SCENE, label: `★ よく使う ${state.favs.length}` });
  }
  scenes.forEach((sc) => items.push({ key: sc, label: SCENE_LABELS[sc] || sc }));

  row.replaceChildren(
    ...items.map((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${state.tripScene === it.key ? ' on' : ''}`;
      b.textContent = it.label;
      b.addEventListener('click', () => {
        state.tripScene = it.key;
        renderSceneChips();
        renderTripList();
      });
      return b;
    })
  );

  row.scrollLeft = left;
}

function renderTripList() {
  const list = $('trip-list');
  const top = list.scrollTop;
  const found = tripPhrases();

  const frag = document.createDocumentFragment();
  let lastScene = null;

  found.forEach((p) => {
    if (p.scene !== lastScene) {
      lastScene = p.scene;
      const head = document.createElement('li');
      head.className = 'phrase-head';
      head.textContent = SCENE_LABELS[p.scene] || p.scene;
      frag.appendChild(head);
    }

    const li = document.createElement('li');
    li.className = 'phrase-row';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'phrase-main';
    [['phrase-jp', p.jp], ['phrase-pt', p.pt], ['phrase-kana', p.kana]].forEach(
      ([cls, text]) => {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        main.appendChild(span);
      }
    );
    main.addEventListener('click', () => openShow(p.id));

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'phrase-icon';
    play.textContent = '♪';
    play.setAttribute('aria-label', `${p.jp} を再生`);
    play.addEventListener('click', () => audio.speak(p, 1.0));

    const fav = document.createElement('button');
    fav.type = 'button';
    const paintFav = () => {
      const on = isFav(p.id);
      fav.className = `phrase-icon fav${on ? ' on' : ''}`;
      fav.textContent = on ? '★' : '☆';
      fav.setAttribute('aria-label', `${p.jp} をよく使う${on ? 'から外す' : 'に入れる'}`);
    };
    paintFav();
    fav.addEventListener('click', () => {
      toggleFav(p.id);
      renderSceneChips();
      // よく使う一覧を見ているときは、外した行がその場で消えないと混乱する
      if (state.tripScene === FAV_SCENE) {
        renderTripList();
        return;
      }
      paintFav();
    });

    li.append(main, play, fav);
    frag.appendChild(li);
  });

  list.replaceChildren(frag);
  list.scrollTop = top;
  $('trip-empty').classList.toggle('hidden', found.length > 0);
}

// ---- 見せる用の大きい表示 ----

function openShow(id) {
  state.showId = id;
  state.slow = false;
  renderShow();
  show('show');
  audio.speak(state.byId[id], 1.0);
}

function renderShow() {
  const p = state.byId[state.showId];

  $('show-scene').textContent = SCENE_LABELS[p.scene] || p.scene;
  $('show-pt').textContent = p.pt;
  $('show-kana').textContent = p.kana;
  $('show-jp').textContent = p.jp;
  $('show-it').textContent = p.it;
  $('show-note').textContent = p.note;

  $('btn-show-slow').textContent = state.slow ? '標準の速さ' : 'ゆっくり';
  $('btn-show-fav').textContent = isFav(p.id) ? 'よく使うから外す' : 'よく使うに入れる';
}

function closeShow() {
  audio.stop();
  state.showId = null;
  renderSceneChips();
  renderTripList();
  show('trip');
}

// ---- 設定 ----

function renderSettings() {
  const st = audio.status();
  const statusText = {
    ptpt: 'ヨーロッパポルトガル語（pt-PT）の音声を使用中',
    ptbr: 'pt-PT音声なし。ブラジル音声で代用中',
    none: 'ポルトガル語の音声が見つかりません',
    unsupported: 'この端末は音声合成に未対応',
    unknown: '判定中',
  }[st.voiceStatus];

  $('voice-status').textContent =
    `${statusText}${st.voiceName ? `: ${st.voiceName}` : ''} / MP3 ${st.mp3Count}件`;

  const voices = audio.listPortugueseVoices();
  $('voice-list').textContent = voices.length
    ? `端末の音声: ${voices.join(' , ')}`
    : '端末の音声: なし';

  const cards = Object.values(state.cards);
  const boxes = [1, 2, 3, 4, 5].map(
    (b) => `箱${b}:${cards.filter((c) => (c.box || 1) === b).length}`
  );
  $('progress-detail').textContent =
    `投入 ${cards.length}/${state.phrases.length} / ${boxes.join(' ')} / ` +
    `連続 ${state.meta.streak || 0}日 / セッション ${state.meta.totalSessions || 0}回`;

  $('input-departure-edit').value = state.trip ? state.trip.departure : '';
  $('btn-departure-save').textContent = '出発日を保存';

  $('app-version').textContent = APP_VERSION;
  offlineStatus().then((t) => {
    $('offline-status').textContent = t;
  });
  $('today-value').textContent = state.today;
  $('mode-value').textContent = {
    study: '学習',
    sweep: '最終スイープ',
    trip: '旅行',
  }[srs.modeFor(state.today, state.trip)];
}

// ---- 配線 ----

function wire() {
  $('btn-setup-save').addEventListener('click', () => {
    const err = applyDeparture($('input-departure').value);
    if (err) {
      $('setup-error').textContent = err;
      $('setup-error').classList.remove('hidden');
      return;
    }
    goHome();
  });

  $('btn-departure-save').addEventListener('click', () => {
    const err = applyDeparture($('input-departure-edit').value);
    $('btn-departure-save').textContent = err || '保存しました';
    if (!err) renderSettings();
  });

  // 必須分が残っていれば通常セッション、終わっていれば再挑戦へ
  $('btn-start').addEventListener('click', () => {
    if (srs.modeFor(state.today, state.trip) === 'trip') {
      renderTrip();
      show('trip');
      return;
    }
    const s = srs.buildSession(state.today, state.cards, state.phrases, state.trip);
    if (s.reviewIds.length + s.newIds.length > 0) startSession();
    else startReplay();
  });
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-next').addEventListener('click', nextNew);

  document.querySelectorAll('.grade').forEach((b) => {
    b.addEventListener('click', () => grade(b.dataset.grade));
  });

  $('btn-replay').addEventListener('click', (e) => {
    e.stopPropagation();
    audio.speak(state.byId[currentItem().id], state.slow ? 0.75 : 1.0);
  });

  $('btn-slow').addEventListener('click', (e) => {
    e.stopPropagation();
    state.slow = !state.slow;
    $('btn-slow').textContent = state.slow ? '標準の速さ' : 'ゆっくり';
    audio.speak(state.byId[currentItem().id], state.slow ? 0.75 : 1.0);
  });

  $('btn-quit').addEventListener('click', () => {
    audio.stop();
    goHome();
  });

  $('btn-home').addEventListener('click', goHome);

  // ---- 旅行モード ----

  $('trip-search').addEventListener('input', (e) => {
    state.tripQuery = e.target.value;
    // 絞り込み中のシーンに無い語を打つと空振りするので、探すときは全体から探す
    if (state.tripQuery.trim() && state.tripScene !== null) {
      state.tripScene = null;
      renderSceneChips();
    }
    renderTripList();
  });

  $('btn-trip-settings').addEventListener('click', () => {
    renderSettings();
    show('settings');
  });

  $('btn-show-close').addEventListener('click', closeShow);

  $('btn-show-play').addEventListener('click', () => {
    audio.speak(state.byId[state.showId], state.slow ? 0.75 : 1.0);
  });

  $('btn-show-slow').addEventListener('click', () => {
    state.slow = !state.slow;
    renderShow();
    audio.speak(state.byId[state.showId], state.slow ? 0.75 : 1.0);
  });

  $('btn-show-fav').addEventListener('click', () => {
    toggleFav(state.showId);
    renderShow();
  });

  $('btn-copy').addEventListener('click', async () => {
    const line = `- [x] [[ポルトガル語]] ✅ ${state.today}`;
    try {
      await navigator.clipboard.writeText(line);
      $('btn-copy').textContent = 'コピーしました';
    } catch (e) {
      $('btn-copy').textContent = line;
    }
  });

  $('btn-settings').addEventListener('click', () => {
    renderSettings();
    show('settings');
  });

  $('btn-settings-close').addEventListener('click', goHome);

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portuguese-trainer-${state.today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('input-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      state.cards = store.loadCards();
      state.meta = store.loadMeta();
      state.favs = store.loadFavs();
      const trip = store.loadTrip();
      if (srs.isValidTrip(trip)) state.trip = trip;
      renderSettings();
      alert('読み込みました');
    } catch (err) {
      alert(`読み込みに失敗: ${err.message}`);
    }
    e.target.value = '';
  });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('進捗をすべて消します。元に戻せません。')) return;
    store.resetProgress();
    state.cards = {};
    state.meta = store.loadMeta();
    renderSettings();
  });

  // Macでのキーボード操作
  document.addEventListener('keydown', (e) => {
    if (!$('screen-show').classList.contains('hidden')) {
      if (e.key === 'Escape') closeShow();
      if (e.key === ' ') {
        e.preventDefault();
        audio.speak(state.byId[state.showId], state.slow ? 0.75 : 1.0);
      }
      return;
    }
    if ($('screen-session').classList.contains('hidden')) return;
    const item = currentItem();
    if (!item) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (item.kind === 'new') nextNew();
      else if (!state.revealed) reveal();
      return;
    }
    if (item.kind === 'review' && state.revealed) {
      if (e.key === '1') grade('again');
      if (e.key === '2') grade('vague');
      if (e.key === '3') grade('good');
    }
  });
}

// ---- オフライン対応 ----

/**
 * Service Worker を登録する。失敗してもアプリは通常どおり動く。
 *
 * localhost では登録しない。tools/serve.py の no-store と噛み合わず、
 * 更新したはずのコードが古いまま出る事故を招くため。オフラインの確認は
 * 公開URLを機内モードで開いて行う。
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  navigator.serviceWorker.register('sw.js').catch((e) => {
    console.warn('Service Workerの登録に失敗。オフラインでは開けない', e);
  });
}

/** 設定画面に出すオフラインの状態 */
async function offlineStatus() {
  if (!('serviceWorker' in navigator)) return 'この端末はオフライン保存に未対応';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return '開発中（localhost）のため無効';
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !navigator.serviceWorker.controller) return '準備中。一度リロードすると有効になる';

  const keys = await caches.keys();
  const name = keys.find((k) => k.startsWith('pt-trainer-'));
  if (!name) return '準備中。一度リロードすると有効になる';

  const files = (await (await caches.open(name)).keys()).length;
  return `オフラインで開ける（${name} / ${files}件）`;
}

// ---- 起動 ----

async function main() {
  // 出発日が未設定の経路でも登録したいので、分岐より前に置く
  registerServiceWorker();

  state.today = resolveToday();
  state.cards = store.loadCards();
  state.meta = store.loadMeta();
  state.favs = store.loadFavs();

  const trip = store.loadTrip();
  state.trip = srs.isValidTrip(trip) ? trip : null;

  const res = await fetch('data/phrases.json', { cache: 'no-cache' });
  const data = await res.json();
  state.phrases = data.phrases;
  state.byId = Object.fromEntries(state.phrases.map((p) => [p.id, p]));

  wire();

  // 出発日が未設定なら学習画面を出さずに入力を求める
  if (!state.trip) {
    showSetup();
    await audio.init();
    return;
  }

  goHome();

  await audio.init();
  goHome(); // 音声の判定結果を反映
}

main().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'padding:20px;white-space:pre-wrap';
  pre.textContent =
    `起動に失敗しました\n\n${e.message}\n\n` +
    'file:// で開いていませんか。python3 tools/serve.py で配信してください。';
  document.body.replaceChildren(pre);
});
