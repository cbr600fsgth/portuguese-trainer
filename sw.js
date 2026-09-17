// オフラインで開けるようにアプリ本体をキャッシュする。
// 現地で電波が無くてもフレーズブックを引けることが目的。
//
// キャッシュ名に版番号を持たせ、変わったら古いキャッシュを丸ごと捨てる。
// コードを変えたら js/app.js の APP_VERSION とこの VERSION を同じ値に揃えて上げる。
// 揃っていないと、設定画面に出る版番号と実際に配信される中身がずれる。

const VERSION = 'phase3-r3';
const CACHE = `pt-trainer-${VERSION}`;

// 相対パスで書く。GitHub Pages のサブディレクトリ配信でもそのまま動く。
// audio/*.mp3 と data/audio-manifest.json はまだ無いので入れない（あっても実行時に拾う）。
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/srs.js',
  'js/store.js',
  'js/audio.js',
  'data/phrases.json',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' で必ずネットワークから取る。
  // GitHub Pages は max-age=600 を返すため、既定のままだとブラウザのHTTPキャッシュに
  // 残った古いファイルをそのまま焼き付けてしまい、版番号を上げるまで直せなくなる。
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュを先に返し、裏で取り直して次回に備える。
// 表示の速さと圏外での確実さを優先する。更新は次に開いたときに反映される。
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    // ?today=YYYY-MM-DD を付けて開いてもトップと同じものを返す
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);

      return hit || net.then((res) => res || new Response('', { status: 504 }));
    })
  );
});
