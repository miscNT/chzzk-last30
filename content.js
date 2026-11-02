// 치지직 마지막 30초 가리개
// 영상이 끝나기 N초 전(기본 30초)부터 영상 화면을 검게 만듭니다. 소리와 플레이어 버튼은 그대로 둡니다.
(() => {
  'use strict';
  if (window.__czzLast30) return;

  // 치지직 페이지, 또는 치지직 안에 들어있는 프레임(같이보기 플레이어가 iframe일 수 있음)에서만 동작
  const CHZZK = /(^|\.)chzzk\.naver\.com$/;
  const inChzzk = CHZZK.test(location.hostname)
    || Array.from(location.ancestorOrigins || []).some((o) => {
      try { return CHZZK.test(new URL(o).hostname); } catch (e) { return false; }
    });
  if (!inChzzk) return;
  window.__czzLast30 = true;
  const IS_TOP = window === window.top;

  // skipPaths: 이 주소(페이지)에서는 가리지 않음 (마지막 화처럼 예고편이 없는 화). 기본: 신삼국지 95화
  const DEFAULT_SKIP = ['/video/15772635'];
  let settings = { on: true, seconds: 30, open: false, skipPaths: DEFAULT_SKIP.slice() };
  let video = null;
  let covered = false, manual = false;
  let skipKey = null;        // "보기"를 누른 영상은 다시 가리지 않음
  let childHasVideo = false; // 최상위 프레임: iframe 안에 영상이 있으면 패널을 iframe 쪽에만 표시
  let lastPost = 0;
  let parentPath = null;     // iframe 안일 때 바깥 페이지가 알려준 주소

  const save = () => { try { chrome.storage.local.set({ last30: settings }); } catch (e) { /* noop */ } };
  const fmt = (s) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
  };
  // 광고(짧은 영상)는 무시하고, 길이를 아는 5분 넘는 영상만
  const hasLength = (v) => !!v && isFinite(v.duration) && v.duration > 300;
  const keyOf = (v) => (hasLength(v) ? Math.round(v.duration) : null);

  // ---------- 주소로 제외 ----------
  // 치지직 다시보기는 화마다 주소가 다름 (예: /video/15772635). 페이지 이동 없이 주소만 바뀌어도 매번 다시 확인
  // 영상이 iframe 안이면 바깥 페이지 주소를 씀
  const cleanPath = (p) => String(p || '').replace(/\/+$/, '') || '/';
  const pagePath = () => cleanPath(IS_TOP ? location.pathname : (parentPath || location.pathname));
  const isExcluded = () => (settings.skipPaths || []).some((p) => cleanPath(p) === pagePath());

  function findVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area && v.readyState > 0) { best = v; area = r.width * r.height; }
    }
    return best;
  }
  const isBig = (v) => { if (!v) return false; const r = v.getBoundingClientRect(); return r.width >= 320 && r.height >= 180; };
  const host = () => { const fs = document.fullscreenElement; return fs && fs.tagName !== 'VIDEO' ? fs : document.body; };

  // ---------- 가리기 ----------
  // 화면 위에 판을 덮으면 플레이어 버튼(다음 화, 재생바)까지 가려지므로,
  // 영상 화면 자체만 검게 만듦. 플레이어 버튼은 그대로 보이고 눌림.
  const FONT = 'font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;';
  const badge = document.createElement('div');
  badge.style.cssText = 'position:fixed;z-index:2147483647;display:none;pointer-events:none;';
  const cr = badge.attachShadow({ mode: 'open' });
  cr.innerHTML = `
    <style>
      .b{${FONT}display:inline-flex;align-items:center;gap:8px;background:rgba(30,30,32,.9);color:#eee;border-radius:8px;padding:6px 8px 6px 10px;font-size:12.5px;box-shadow:0 2px 10px rgba(0,0,0,.4)}
      button{all:unset;pointer-events:auto;cursor:pointer;padding:3px 8px;border-radius:6px;background:#3a3a3d;color:#ddd;font-size:12px}
      button:hover{background:#4a4a4e}
    </style>
    <div class="b"><span id="s"></span><button id="show">그냥 보기</button></div>`;
  cr.getElementById('show').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!manual) skipKey = keyOf(video);
    uncover();
  });

  let hiddenVideo = null, oldFilter = '', oldFilterPrio = '';
  function hideVideo(v) {
    hiddenVideo = v;
    oldFilter = v.style.getPropertyValue('filter');
    oldFilterPrio = v.style.getPropertyPriority('filter');
    v.style.setProperty('filter', 'brightness(0)', 'important');
  }
  function showVideo() {
    if (!hiddenVideo) return;
    if (oldFilter) hiddenVideo.style.setProperty('filter', oldFilter, oldFilterPrio);
    else hiddenVideo.style.removeProperty('filter');
    hiddenVideo = null;
  }

  // 소리는 건드리지 않음 (플레이어가 음소거를 기억해서 다음 화까지 꺼지는 문제 방지)
  function doCover(isManual) {
    if (covered || !video) return;
    covered = true; manual = isManual;
    hideVideo(video);
    badge.style.display = 'block';
    place();
  }
  function uncover() {
    if (!covered) return;
    covered = false; manual = false;
    showVideo();
    badge.style.display = 'none';
  }
  function place() {
    const h = host();
    if (badge.parentNode !== h) h.appendChild(badge);
    // 플레이어가 필터를 지우면 다시 적용
    if (hiddenVideo && hiddenVideo.style.getPropertyValue('filter') !== 'brightness(0)') {
      hiddenVideo.style.setProperty('filter', 'brightness(0)', 'important');
    }
    // 안내는 영상 왼쪽 위에 작게 (아래쪽 플레이어 버튼을 피해서)
    const r = video && video.getBoundingClientRect();
    const x = r && r.width > 50 ? r.left + 12 : 12;
    const y = r && r.height > 50 ? r.top + 12 : 12;
    Object.assign(badge.style, { left: x + 'px', top: y + 'px' });
    cr.getElementById('s').textContent = manual
      ? '🛡 수동으로 가렸어요 · Alt+B로 풀기'
      : `🛡 예고편 가리는 중 (마지막 ${settings.seconds}초). 다음화 넘기기 버튼으로 커서를 옮기면 클릭 가능`;
  }

  // ---------- 작은 패널 ----------
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;z-index:2147483647;left:16px;bottom:16px;display:none;';
  const pr = panel.attachShadow({ mode: 'open' });
  pr.innerHTML = `
    <style>
      .p{${FONT}background:rgba(20,20,22,.92);color:#ddd;border:1px solid #333;border-radius:10px;font-size:12px;padding:6px 10px;max-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
      .row{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
      .dot{width:8px;height:8px;border-radius:4px;background:#555;flex:none}
      .set{display:none;margin-top:8px;border-top:1px solid #333;padding-top:8px}
      .open .set{display:block}
      label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0}
      input[type=number]{width:56px;background:#111;color:#eee;border:1px solid #444;border-radius:6px;padding:2px 4px}
      .hint{color:#888;font-size:11px;line-height:1.4;margin-top:4px}
    </style>
    <div class="p" id="p">
      <div class="row" id="row"><span class="dot" id="dot"></span><span id="txt"></span></div>
      <div class="set">
        <label><span>켜기</span><input type="checkbox" id="on"></label>
        <label><span>끝에서 몇 초 가릴지</span><input type="number" id="sec" min="5" max="600" step="1"></label>
        <label><span>이 페이지(화)는 가리지 않기</span><input type="checkbox" id="ex"></label>
        <div class="hint" id="exHint"></div>
        <div class="hint">Alt+B: 지금 바로 가리기/풀기</div>
      </div>
    </div>`;
  const $ = (id) => pr.getElementById(id);
  $('row').addEventListener('click', () => { settings.open = !settings.open; save(); render(); });
  $('on').addEventListener('change', (e) => { settings.on = e.target.checked; save(); if (!settings.on && !manual) uncover(); });
  $('ex').addEventListener('change', (e) => {
    const here = pagePath();
    const rest = (settings.skipPaths || []).filter((p) => cleanPath(p) !== here);
    settings.skipPaths = e.target.checked ? [...rest, here] : rest;
    save();
    if (e.target.checked && covered && !manual) uncover();
    render();
  });
  $('sec').addEventListener('change', (e) => {
    const v = Math.round(+e.target.value);
    if (v >= 5 && v <= 600) { settings.seconds = v; save(); } else e.target.value = settings.seconds;
  });

  function render() {
    const h = host();
    if (panel.parentNode !== h) h.appendChild(panel);
    const show = IS_TOP ? (isBig(video) || !childHasVideo) : isBig(video);
    panel.style.display = show && video ? 'block' : 'none';
    $('p').className = 'p' + (settings.open ? ' open' : '');
    $('on').checked = settings.on;
    if (document.activeElement !== $('sec') && pr.activeElement !== $('sec')) $('sec').value = settings.seconds;
    let txt, color;
    if (!settings.on) { txt = '꺼짐'; color = '#555'; }
    else if (covered) { txt = '가리는 중'; color = '#ff5a5a'; }
    else if (!hasLength(video)) { txt = '이 영상은 길이를 알 수 없어서(라이브) 가릴 수 없어요'; color = '#d9a400'; }
    else if (isExcluded()) { txt = '이 페이지는 가리지 않아요 (제외 목록)'; color = '#555'; }
    else if (skipKey === keyOf(video)) { txt = '이 영상은 가리지 않기로 했어요'; color = '#555'; }
    else { txt = `마지막 ${settings.seconds}초 가림 · ${fmt(video.duration - video.currentTime - settings.seconds)} 후`; color = '#00c73c'; }
    $('txt').textContent = '🛡 ' + txt;
    $('ex').checked = isExcluded();
    const n = (settings.skipPaths || []).length;
    $('exHint').textContent = `지금 주소: ${pagePath()}${n ? ` · 제외한 페이지 ${n}개` : ''}`;
    $('dot').style.background = color;
  }

  // ---------- 메인 루프 ----------
  setInterval(() => {
    const v = findVideo();
    if (v !== video) {
      if (covered) uncover();
      video = v;
    }
    // 바깥 페이지는 자기 주소를 iframe(플레이어)에 알려줌
    if (IS_TOP) {
      for (const f of document.querySelectorAll('iframe')) {
        try { f.contentWindow.postMessage({ __czz30: 1, type: 'path', path: location.pathname }, '*'); } catch (e) { /* noop */ }
      }
    }
    if (video && settings.on && !manual) {
      const inEnd = hasLength(video) && video.duration - video.currentTime <= settings.seconds && !video.ended;
      if (inEnd && !covered && skipKey !== keyOf(video) && !isExcluded()) doCover(false);
      // 되감거나 다음 화로 넘어가거나 제외한 페이지면 풀기
      if (covered && (!inEnd || isExcluded())) uncover();
    }
    if (covered) place();
    if (!IS_TOP && isBig(video) && Date.now() - lastPost > 2000) {
      lastPost = Date.now();
      try { window.top.postMessage({ __czz30: 1, type: 'has-video' }, '*'); } catch (e) { /* noop */ }
    }
    render();
  }, 200);

  // 영상이 끝나면 풀기 (다음 화가 같은 영상 요소에서 시작될 때 대비)
  document.addEventListener('ended', (e) => { if (e.target === video && covered && !manual) uncover(); }, true);

  // ---------- 프레임 간 연결 / 단축키 ----------
  function toggle() { if (!video) return false; if (covered) uncover(); else doCover(true); return true; }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.__czz30 !== 1) return;
    if (d.type === 'has-video' && IS_TOP) childHasVideo = true;
    if (d.type === 'path' && !IS_TOP && e.source === window.parent && typeof d.path === 'string') parentPath = d.path;
    if (d.type === 'toggle' && !toggle()) {
      for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow.postMessage({ __czz30: 1, type: 'toggle' }, '*'); } catch (err) { /* noop */ } }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') {
      e.preventDefault(); e.stopPropagation();
      if (!toggle()) {
        for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow.postMessage({ __czz30: 1, type: 'toggle' }, '*'); } catch (err) { /* noop */ } }
      }
    }
  }, true);

  try {
    chrome.storage.local.get('last30', (d) => {
      if (d && d.last30) settings = { ...settings, ...d.last30 };
      if (!Array.isArray(settings.skipPaths)) settings.skipPaths = [];
      // 기본 제외 주소는 처음 한 번만 넣음 (사용자가 체크를 풀면 그대로 둠)
      if (!settings.defaultsAdded) {
        for (const p of DEFAULT_SKIP) if (!settings.skipPaths.includes(p)) settings.skipPaths.push(p);
        settings.defaultsAdded = true;
        save();
      }
      delete settings.skip; delete settings.skipTitles; // 이전 버전 설정 정리
      render();
    });
  } catch (e) { /* noop */ }
  document.body.appendChild(panel);
  document.body.appendChild(badge);
})();
