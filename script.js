// ========== 状態変数 ==========
let player = null;
let reverseRafId = null;
let reverseState = null;
let pollTimer = null;
let abLoopActive = false;
let A = null;
let B = null;
let mirrorRequested = false;

const STORAGE_KEY = 'youtubeFlipPresets';
const HISTORY_KEY = 'youtubeFlipRecentVideos';
const HISTORY_LIMIT = 5;

let historyBlurTimer = null;
let draggingPresetIndex = null;
let dragArmed = false;

const REVERSE_SEEK_FPS = 30;

// ========== DOM 要素の参照 ==========
const urlInput = document.getElementById('urlInput');
const urlClearBtn = document.getElementById('urlClearBtn');
const loadBtn = document.getElementById('loadBtn');
const unloadBtn = document.getElementById('unloadBtn');
const historySuggestions = document.getElementById('historySuggestions');
const iframeBox = document.getElementById('iframeBox');
const playPauseBtn = document.getElementById('playPauseBtn');
const reverseBtn = document.getElementById('reverseBtn');
const mirrorBtn = document.getElementById('mirrorBtn');
const loopChk = document.getElementById('loopChk');
const speedSelect = document.getElementById('speedSelect');
const speedActive = document.getElementById('speedActive');
const posSlider = document.getElementById('posSlider');
const timeLabel = document.getElementById('timeLabel');
const pointA = document.getElementById('pointA');
const pointB = document.getElementById('pointB');
const setAFromCurrent = document.getElementById('setAFromCurrent');
const setBFromCurrent = document.getElementById('setBFromCurrent');
const setAB = document.getElementById('setAB');
const clearAB = document.getElementById('clearAB');
const abLoopControls = setAB ? setAB.closest('.controls') : null;
const presetName = document.getElementById('presetName');
const savePresetBtn = document.getElementById('savePresetBtn');
const clearPresetsBtn = document.getElementById('clearPresetsBtn');
const presetsContainer = document.getElementById('presetsContainer');

// ========== ユーティリティ関数 ==========

/**
 * YouTubeのURLまたはIDから動画IDを抽出
 */
function extractVideoID(input) {
  if (!input) return null;
  const patterns = [
    /(?:v=|&v=)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /embed\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * 秒数を「分:秒」形式にフォーマット
 */
function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

/**
 * 「分:秒」形式の文字列を秒数に変換
 */
function parseTimeStr(str) {
  if (!str) return null;
  str = str.trim();
  const parts = str.split(':');
  if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    return isNaN(s) ? null : s;
  } else if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  return null;
}

/**
 * URL入力をプレーヤー読込向けに正規化
 */
function normalizeVideoInput(input) {
  let normalized = (input || '').trim();

  if (normalized.includes('shorts/')) {
    const id = normalized.split('shorts/')[1].split('?')[0];
    normalized = 'https://www.youtube.com/watch?v=' + id;
  }

  if (normalized.includes('live/')) {
    const id = normalized.split('live/')[1].split('?')[0];
    normalized = 'https://www.youtube.com/watch?v=' + id;
  }

  return normalized;
}

/**
 * 速度セレクトのオプションを構築
 */
function buildSpeedOptions() {
  const speeds = [
    0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0,
    1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.7, 1.75, 1.8, 1.9, 2.0
  ];

  speedSelect.innerHTML = '';

  speeds.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.toFixed(2);
    // 0.25倍数は星印で表示
    const isQuarter = Math.abs(s * 4 - Math.round(s * 4)) < 1e-6;
    opt.textContent = isQuarter ? `${s.toFixed(2)}x ★` : `${s.toFixed(2)}x`;
    speedSelect.appendChild(opt);
  });

  speedSelect.value = "1.00";
  speedActive.textContent = "1.00x";
  speedActive.style.fontWeight = '900';
}

/**
 * 現在の設定を取得
 */
function getCurrentSettings() {
  return {
    videoUrl: urlInput.value.trim(),
    speed: speedSelect.value,
    loop: loopChk.checked,
    mirror: mirrorRequested,
    pointA: pointA.value || null,
    pointB: pointB.value || null,
    timestamp: new Date().toLocaleString('ja-JP')
  };
}

/**
 * ローカルストレージから設定を取得
 */
function getPresetsFromStorage() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * 設定をローカルストレージに保存
 */
function savePresetsToStorage(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function movePreset(fromIndex, toIndex) {
  const presets = getPresetsFromStorage();
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= presets.length ||
    toIndex >= presets.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const [moved] = presets.splice(fromIndex, 1);
  presets.splice(toIndex, 0, moved);
  savePresetsToStorage(presets);
  renderPresets();
}

function getRecentVideosFromStorage() {
  const data = localStorage.getItem(HISTORY_KEY);
  if (!data) return [];
  try {
    const list = JSON.parse(data);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveRecentVideosToStorage(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

async function fetchVideoTitle(videoId) {
  const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
  const endpoint = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(watchUrl) + '&format=json';
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error('title fetch failed');
  const data = await res.json();
  return data.title || ('動画 ' + videoId);
}

function renderHistorySuggestions(filterText = '') {
  if (!historySuggestions) return;
  const list = getRecentVideosFromStorage();
  const q = filterText.trim().toLowerCase();
  const filtered = q ? list.filter(v => (v.title || '').toLowerCase().includes(q) || (v.url || '').toLowerCase().includes(q)) : list;

  historySuggestions.innerHTML = '';
  filtered.slice(0, HISTORY_LIMIT).forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item';
    btn.textContent = item.title;
    btn.title = item.title;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    btn.addEventListener('click', () => {
      urlInput.value = item.url;
      updateUrlClearButtonState();
      closeHistorySuggestions();
      loadVideoFromInput(true);
    });
    historySuggestions.appendChild(btn);
  });

  syncHistoryDropdownVisibility();
}

async function updateRecentVideoHistory(videoId) {
  const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
  let title = '動画 ' + videoId;
  try {
    title = await fetchVideoTitle(videoId);
  } catch (e) { }

  const list = getRecentVideosFromStorage().filter(v => v.videoId !== videoId);
  list.unshift({ videoId, url: watchUrl, title, timestamp: Date.now() });
  saveRecentVideosToStorage(list.slice(0, HISTORY_LIMIT));
  renderHistorySuggestions(urlInput.value);
}

function updateUrlClearButtonState() {
  if (!urlClearBtn) return;
  const hasText = urlInput.value.trim().length > 0;
  urlClearBtn.classList.toggle('hidden', !hasText);
}

function updateAbLoopVisualState() {
  if (abLoopControls) {
    abLoopControls.classList.toggle('ab-loop-active', abLoopActive);
  }
  if (setAB) {
    setAB.classList.toggle('ab-loop-on', abLoopActive);
  }
}

function isUrlInputFocused() {
  return document.activeElement === urlInput;
}

function closeHistorySuggestions() {
  if (!historySuggestions) return;
  historySuggestions.classList.remove('open');
}

function syncHistoryDropdownVisibility() {
  if (!historySuggestions) return;
  const hasItems = historySuggestions.childElementCount > 0;
  const shouldShow = hasItems && isUrlInputFocused();
  historySuggestions.classList.toggle('open', shouldShow);
}

// ========== YouTube IFrame API Callback ==========

function onYouTubeIframeAPIReady() {
  // API読み込み完了
}

// ========== プレーヤーの生成・破棄 ==========

/**
 * コントロールをリセット
 */
function resetControls() {
  speedSelect.value = "1.00";
  speedActive.textContent = "1.00x";
  speedActive.style.fontWeight = "900";

  playPauseBtn.textContent = "▶ 再生";
  loopChk.checked = false;

  abLoopActive = false;
  A = null;
  B = null;
  pointA.value = "";
  pointB.value = "";
  updateAbLoopVisualState();

  posSlider.value = 0;
  timeLabel.textContent = "0:00 / 0:00";

  mirrorRequested = false;
  mirrorBtn.classList.remove('mirror-active');
  iframeBox.style.scale = "1";
}

/**
 * プレーヤーを生成または読み込み
 */
function createOrLoadPlayer(videoId, preset = null) {
  destroyPlayer();
  resetControls();

  if (preset) {
    speedSelect.value = preset.speed;
    speedActive.textContent = preset.speed + 'x';
    const isQuarter = Math.abs(preset.speed * 4 - Math.round(preset.speed * 4)) < 1e-6;
    speedActive.style.fontWeight = isQuarter ? '900' : '400';
    loopChk.checked = preset.loop;
    mirrorRequested = preset.mirror;
    mirrorBtn.classList.toggle('mirror-active', mirrorRequested);
    if (preset.pointA && preset.pointB) {
      pointA.value = preset.pointA;
      pointB.value = preset.pointB;
    }
  }

  const div = document.createElement('div');
  div.id = 'ytplayer';
  div.style.width = '100%';
  div.style.height = '100%';
  iframeBox.appendChild(div);

  player = new YT.Player('ytplayer', {
    width: '100%',
    height: '100%',
    videoId: videoId,
    playerVars: { rel: 0, playsinline: 1, origin: window.location.origin, enablejsapi: 1 },
    events: {
      onReady: (e) => {
        try {
          player.setPlaybackRate(parseFloat(speedSelect.value));
        } catch (e) { }
        applyMirrorIfNeeded();
        startPoll();
      },
      onStateChange: onPlayerStateChange
    }
  });
}

/**
 * プレーヤーを破棄
 */
function destroyPlayer() {
  stopReverseIfOn();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (player && typeof player.destroy === 'function') {
    try {
      player.destroy();
    } catch (e) { }
  }
  player = null;
  iframeBox.innerHTML = '';
  posSlider.value = 0;
  timeLabel.textContent = '0:00 / 0:00';
  abLoopActive = false;
  A = B = null;
  updateAbLoopVisualState();
}

// ========== ボタンイベント：読み込み ==========

function loadVideoFromInput(silent = false) {
  const normalized = normalizeVideoInput(urlInput.value);
  const id = extractVideoID(normalized);
  if (!id) {
    if (!silent) {
      alert('動画IDが見つかりません。URLまたはIDを確認してください。');
    }
    return false;
  }

  urlInput.value = normalized;
  updateUrlClearButtonState();
  createOrLoadPlayer(id);
  updateRecentVideoHistory(id);
  return true;
}

loadBtn.addEventListener('click', () => {
  loadVideoFromInput(false);
});

urlInput.addEventListener('paste', () => {
  setTimeout(() => {
    updateUrlClearButtonState();
    renderHistorySuggestions(urlInput.value);
    loadVideoFromInput(true);
  }, 0);
});

urlInput.addEventListener('input', () => {
  updateUrlClearButtonState();
  renderHistorySuggestions(urlInput.value);
});

urlInput.addEventListener('focus', () => {
  if (historyBlurTimer) {
    clearTimeout(historyBlurTimer);
    historyBlurTimer = null;
  }
  renderHistorySuggestions(urlInput.value);
});

urlInput.addEventListener('blur', () => {
  historyBlurTimer = setTimeout(() => {
    closeHistorySuggestions();
    historyBlurTimer = null;
  }, 120);
});

if (urlClearBtn) {
  urlClearBtn.addEventListener('click', () => {
    urlInput.value = '';
    updateUrlClearButtonState();
    renderHistorySuggestions('');
    urlInput.focus();
  });
}

unloadBtn.addEventListener('click', destroyPlayer);

// ========== ボタンイベント：再生・停止 ==========

function togglePlayPause() {
  if (!player) return;
  const state = player.getPlayerState ? player.getPlayerState() : -1;
  if (state === 1) {
    // playing -> pause
    try {
      player.pauseVideo();
    } catch (e) { }
    playPauseBtn.textContent = '▶ 再生';
  } else {
    stopReverseIfOn();
    try {
      player.playVideo();
    } catch (e) { }
    playPauseBtn.textContent = '⏸ 停止';
  }
}

playPauseBtn.addEventListener('click', togglePlayPause);

// ========== ボタンイベント：逆再生 ==========

function toggleReverse() {
  if (!player) return;
  if (reverseRafId !== null) {
    stopReverseIfOn();
    return;
  }
  startReverse();
}

reverseBtn.addEventListener('click', toggleReverse);

function startReverse() {
  stopReverseIfOn();
  try {
    player.pauseVideo();
  } catch (e) { }

  let startTime = 0;
  try {
    startTime = player.getCurrentTime();
  } catch (e) {
    startTime = 0;
  }

  reverseState = {
    virtualTime: Math.max(0, startTime),
    lastFrameTs: 0,
    lastSeekTs: 0
  };

  const reverseSpeed = Math.max(0.5, parseFloat(speedSelect.value) || 1);
  const minSeekIntervalMs = 1000 / REVERSE_SEEK_FPS;

  function reverseFrame(ts) {
    if (!player || reverseState === null) return;

    if (!reverseState.lastFrameTs) {
      reverseState.lastFrameTs = ts;
      reverseState.lastSeekTs = ts;
    }

    const elapsed = Math.min(0.08, Math.max(0, (ts - reverseState.lastFrameTs) / 1000));
    reverseState.lastFrameTs = ts;
    reverseState.virtualTime = Math.max(0, reverseState.virtualTime - elapsed * reverseSpeed);

    if (ts - reverseState.lastSeekTs >= minSeekIntervalMs || reverseState.virtualTime === 0) {
      try {
        // allowSeekAhead=false でネットワーク再バッファを抑え、逆再生時の体感を改善
        player.seekTo(reverseState.virtualTime, false);
      } catch (e) { }
      reverseState.lastSeekTs = ts;
    }

    if (reverseState.virtualTime <= 0) {
      stopReverseIfOn();
      return;
    }

    reverseRafId = requestAnimationFrame(reverseFrame);
  }

  reverseRafId = requestAnimationFrame(reverseFrame);
}

function stopReverseIfOn() {
  if (reverseRafId !== null) {
    cancelAnimationFrame(reverseRafId);
    reverseRafId = null;
  }
  reverseState = null;
}

// ========== ボタンイベント：鏡像反転 ==========

function toggleMirror() {
  mirrorRequested = !mirrorRequested;
  mirrorBtn.classList.toggle('mirror-active', mirrorRequested);
  applyMirrorIfNeeded();
}

mirrorBtn.addEventListener('click', toggleMirror);

function applyMirrorIfNeeded() {
  const ytplayer = document.getElementById('ytplayer');
  if (ytplayer) {
    ytplayer.style.scale = mirrorRequested ? '-1 1' : '1';
  }
}

// ========== イベント：速度制御 ==========

speedSelect.addEventListener('change', () => {
  const v = parseFloat(speedSelect.value);
  speedActive.textContent = v.toFixed(2) + 'x';
  const isQuarter = Math.abs(v * 4 - Math.round(v * 4)) < 1e-6;
  speedActive.style.fontWeight = isQuarter ? '900' : '400';
  if (player && typeof player.setPlaybackRate === 'function') {
    try {
      player.setPlaybackRate(v);
    } catch (e) { }
  }
});

function adjustSpeedByStep(delta) {
  const currentIndex = speedSelect.selectedIndex;
  if (currentIndex < 0) return;
  const nextIndex = Math.max(0, Math.min(speedSelect.options.length - 1, currentIndex + delta));
  if (nextIndex === currentIndex) return;
  speedSelect.selectedIndex = nextIndex;
  speedSelect.dispatchEvent(new Event('change'));
}

// ========== イベント：シーク ==========

posSlider.addEventListener('input', () => {
  if (!player || typeof player.getDuration !== 'function') return;
  const pct = parseFloat(posSlider.value);
  const dur = player.getDuration() || 0;
  const t = dur * (pct / 100);
  try {
    player.seekTo(t, true);
  } catch (e) { }
  updateTimeLabel(t, dur);
});

function startPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!player || typeof player.getDuration !== 'function') return;
    const dur = player.getDuration() || 0;
    const cur = player.getCurrentTime ? player.getCurrentTime() : 0;
    if (dur > 0) posSlider.value = (cur / dur) * 100;
    updateTimeLabel(cur, dur);
    // A-Bループ監視
    if (abLoopActive && A != null && B != null && cur > B) {
      try {
        player.seekTo(A, true);
      } catch (e) { }
    }
  }, 250);
}

function updateTimeLabel(cur, dur) {
  timeLabel.textContent = fmtTime(cur) + ' / ' + fmtTime(dur);
}

// ========== イベント：通常ループ ==========

loopChk.addEventListener('change', () => {
  // onPlayerStateChange で処理
});

// ========== イベント：A-B 区間ループ ==========

setAFromCurrent.addEventListener('click', () => {
  if (!player || typeof player.getCurrentTime !== 'function') return;
  const cur = player.getCurrentTime();
  pointA.value = fmtTime(cur);
});

setBFromCurrent.addEventListener('click', () => {
  if (!player || typeof player.getCurrentTime !== 'function') return;
  const cur = player.getCurrentTime();
  pointB.value = fmtTime(cur);
});

setAB.addEventListener('click', () => {
  const a = parseTimeStr(pointA.value);
  const b = parseTimeStr(pointB.value);
  if (a === null || b === null || a >= b) {
    alert('A < B で設定してください（形式: 分:秒 例: 1:30）');
    return;
  }
  A = a;
  B = b;
  abLoopActive = true;
  updateAbLoopVisualState();
  if (player && typeof player.seekTo === 'function') {
    try {
      player.seekTo(A, true);
    } catch (e) { }
  }
});

clearAB.addEventListener('click', () => {
  abLoopActive = false;
  A = B = null;
  updateAbLoopVisualState();
});

// ========== プレーヤー状態変更 ==========

function onPlayerStateChange(e) {
  // 動画終了時の通常ループ処理
  if (e.data === YT.PlayerState.ENDED) {
    if (loopChk.checked) {
      if (player && typeof player.seekTo === 'function') {
        try {
          player.seekTo(0, true);
          player.playVideo();
        } catch (e) { }
      }
    } else {
      stopReverseIfOn();
      playPauseBtn.textContent = '▶ 再生';
    }
  }
}

// ========== イベント：プリセット保存 ==========

savePresetBtn.addEventListener('click', () => {
  const name = presetName.value.trim();
  if (!name) {
    alert('設定名を入力してください');
    return;
  }

  const settings = getCurrentSettings();
  if (!settings.videoUrl) {
    alert('動画URLを入力してください');
    return;
  }

  const presets = getPresetsFromStorage();
  const existingIndex = presets.findIndex(p => p.name === name);
  if (existingIndex >= 0) {
    if (!confirm(`「${name}」は既に存在します。上書きしていいですか？`)) return;
    presets[existingIndex] = { name, ...settings };
  } else {
    presets.push({ name, ...settings });
  }

  savePresetsToStorage(presets);
  presetName.value = '';
  renderPresets();
});

// ========== イベント：プリセット全削除 ==========

clearPresetsBtn.addEventListener('click', () => {
  if (!confirm('保存した設定を全て削除していいですか？')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderPresets();
});

// ========== プリセット表示（レンダリング） ==========

function renderPresets() {
  const presets = getPresetsFromStorage();
  presetsContainer.innerHTML = '';

  if (presets.length === 0) {
    presetsContainer.innerHTML = '<p style="color:#999;font-size:12px;">保存された設定がありません</p>';
    return;
  }

  const title = document.createElement('div');
  title.style.fontWeight = 'bold';
  title.style.marginBottom = '8px';
  title.textContent = `保存済み設定 (${presets.length})`;
  presetsContainer.appendChild(title);

  presets.forEach((preset, index) => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    item.draggable = true;
    item.dataset.index = String(index);

    item.addEventListener('dragstart', (e) => {
      if (!dragArmed) {
        e.preventDefault();
        return;
      }
      draggingPresetIndex = index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    item.addEventListener('dragover', (e) => {
      if (draggingPresetIndex === null || draggingPresetIndex === index) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const fromIndex = draggingPresetIndex;
      if (fromIndex === null || fromIndex === index) return;
      movePreset(fromIndex, index);
    });

    item.addEventListener('dragend', () => {
      draggingPresetIndex = null;
      dragArmed = false;
      document.querySelectorAll('.preset-item').forEach((el) => {
        el.classList.remove('dragging', 'drag-over');
      });
    });

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'preset-drag-handle';
    dragHandle.title = 'ドラッグして並び替え';
    dragHandle.textContent = '☰';
    dragHandle.addEventListener('mousedown', () => {
      dragArmed = true;
    });
    dragHandle.addEventListener('mouseup', () => {
      dragArmed = false;
    });
    dragHandle.addEventListener('mouseleave', () => {
      dragArmed = false;
    });
    item.appendChild(dragHandle);

    const info = document.createElement('div');
    info.className = 'preset-info';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'preset-info-title';
    titleDiv.textContent = preset.name;
    info.appendChild(titleDiv);

    const details = document.createElement('div');
    details.className = 'preset-info-details';
    let detailText = `速度: ${preset.speed}x | ループ: ${preset.loop ? 'ON' : 'OFF'} | 反転: ${preset.mirror ? 'ON' : 'OFF'}`;
    if (preset.pointA && preset.pointB) {
      detailText += ` | 区間: ${preset.pointA}-${preset.pointB}`;
    }
    if (preset.timestamp) {
      detailText += ` | ${preset.timestamp}`;
    }
    details.textContent = detailText;
    info.appendChild(details);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '📂 読込';
    loadBtn.addEventListener('click', () => {
      loadPreset(preset);
    });
    actions.appendChild(loadBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = '❌ 削除';
    delBtn.addEventListener('click', () => {
      if (!confirm(`「${preset.name}」を削除していいですか？`)) return;
      const allPresets = getPresetsFromStorage();
      allPresets.splice(index, 1);
      savePresetsToStorage(allPresets);
      renderPresets();
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);
    presetsContainer.appendChild(item);
  });
}

// ========== プリセット読み込み ==========

function loadPreset(preset) {
  urlInput.value = preset.videoUrl;
  const id = extractVideoID(preset.videoUrl);
  if (id) {
    destroyPlayer();
    createOrLoadPlayer(id, preset);
  }
}

// ========== 初期化 ==========

buildSpeedOptions();
renderPresets();
updateUrlClearButtonState();
renderHistorySuggestions();

// ========== グローバルイベント ==========

document.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
  if (typing) return;

  const key = e.key.toLowerCase();

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayPause();
    return;
  }

  if (key === 'r') {
    e.preventDefault();
    toggleReverse();
    return;
  }

  if (key === 'f') {
    e.preventDefault();
    toggleMirror();
    return;
  }

  if (key === 'a') {
    e.preventDefault();
    adjustSpeedByStep(-1);
    return;
  }

  if (key === 'd') {
    e.preventDefault();
    adjustSpeedByStep(1);
  }
});

document.addEventListener('fullscreenchange', () => {
  applyMirrorIfNeeded();
});

window.addEventListener('beforeunload', () => {
  destroyPlayer();
});
