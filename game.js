(() => {
  'use strict';

  // -------- Config --------
  const SPEED_TARGET = 50;
  const SURVIVAL_START_TIME = 30;
  const SURVIVAL_PER_POP = 0.5;
  const SURVIVAL_GOLD_BONUS = 5;
  const SURVIVAL_POISON_PENALTY = 3;
  const SURVIVAL_LEVEL_THRESHOLD = 25;
  const SURVIVAL_MIN_BUBBLES = 8;
  const BEST_SPEED_KEY = 'snapbubbles.bestTime.v1';
  const BEST_SURVIVAL_KEY = 'snapbubbles.bestSurvival.v1';

  // Per-level Survival config: drain rate, gold %, poison %, bubble min size, count multiplier
  function levelConfig(level) {
    const drainRate = Math.min(1.0 + (level - 1) * 0.1, 2.5);
    let goldPct = 0;
    let poisonPct = 0;
    if (level >= 2) goldPct = 0.015;
    if (level >= 3) goldPct = 0.025;
    if (level >= 5) poisonPct = 0.08;
    if (level >= 6) poisonPct = 0.12;
    if (level >= 8) poisonPct = 0.16;
    if (level >= 10) poisonPct = 0.20;
    const bubbleMinPx = level >= 4 ? 46 : 54;
    const bubbleCountFactor = Math.max(0.4, 1.0 - (level - 1) * 0.06);
    return { drainRate, goldPct, poisonPct, bubbleMinPx, bubbleCountFactor };
  }

  // -------- DOM refs --------
  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayBody = $('overlay-body');
  const overlayAgain = $('overlay-again');
  const newSheetBtn = $('new-sheet');
  const poppedEl = $('popped');
  const timerEl = $('timer');
  const targetEl = $('target');
  const bestEl = $('best');
  const levelEl = $('level');
  const scoreEl = $('score');
  const countdown = $('countdown');
  const countdownFill = countdown.querySelector('.countdown-fill');
  const countdownSeconds = $('countdown-seconds');
  const levelToast = $('level-toast');
  const modeToast = $('mode-toast');
  let modeToastTimer = null;

  const MODE_INFO = {
    zen: { title: 'Zen', desc: 'Just pop bubbles. The sheet refills itself — no goal, no timer.' },
    speed: { title: 'Speed', desc: 'Race to pop 50 bubbles. Your best time saves automatically.' },
    survival: { title: 'Survival', desc: 'Beat the countdown. Blue +0.5s, gold +5s, green poison −3s.' },
  };
  const statTimer = document.querySelector('[data-stat="timer"]');
  const statTarget = document.querySelector('[data-stat="target"]');
  const statBest = document.querySelector('[data-stat="best"]');
  const statLevel = document.querySelector('[data-stat="level"]');
  const statScore = document.querySelector('[data-stat="score"]');
  const modeButtons = document.querySelectorAll('.mode-btn');

  // -------- State --------
  const state = {
    mode: 'zen',
    popped: 0,           // total pops in current run
    levelPops: 0,        // pops at current level (resets on level up)
    score: 0,            // survival score
    level: 1,
    timeLeft: SURVIVAL_START_TIME,  // survival countdown
    startTime: null,                // speed mode timer start
    rafId: null,
    drainLastTs: null,
    bubbleCount: 0,
    isOver: false,
  };

  // -------- Audio --------
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) { audioCtx = null; }
    return audioCtx;
  }

  function playPop(variant) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // Variant-specific pitch + amplitude scaling
    const params = (variant === 'gold')
      ? { pitchMul: 1.55, ampMul: 1.0,  dur: 0.06 }
      : (variant === 'poison')
      ? { pitchMul: 0.55, ampMul: 0.95, dur: 0.075 }
      : { pitchMul: 1.0,  ampMul: 0.9,  dur: 0.055 };

    // 1. Main "pop" body — broadband noise burst with rapid lowpass sweep
    //    Mimics the membrane snap of real bubble wrap: bright at attack, darkens fast.
    const dur = params.dur;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 1.6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const startHz = 7000 * params.pitchMul;
    const endHz = 480 * params.pitchMul;
    lp.frequency.setValueAtTime(startHz, now);
    lp.frequency.exponentialRampToValueAtTime(endHz, now + dur * 0.55);
    lp.Q.value = 1.6;

    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = (1300 + Math.random() * 500) * params.pitchMul;
    peak.gain.value = 6;
    peak.Q.value = 3.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.7 * params.ampMul, now + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(lp).connect(peak).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur);

    // 2. Click transient — brief, highpass-filtered noise burst for the initial snap
    const tDur = 0.005;
    const tBufSize = Math.max(1, Math.floor(ctx.sampleRate * tDur));
    const tBuf = ctx.createBuffer(1, tBufSize, ctx.sampleRate);
    const tData = tBuf.getChannelData(0);
    for (let i = 0; i < tBufSize; i++) tData[i] = Math.random() * 2 - 1;
    const tSrc = ctx.createBufferSource();
    tSrc.buffer = tBuf;
    const tHP = ctx.createBiquadFilter();
    tHP.type = 'highpass';
    tHP.frequency.value = 2400;
    const tGain = ctx.createGain();
    tGain.gain.setValueAtTime(0.22 * params.ampMul, now);
    tGain.gain.exponentialRampToValueAtTime(0.001, now + tDur);
    tSrc.connect(tHP).connect(tGain).connect(ctx.destination);
    tSrc.start(now);
    tSrc.stop(now + tDur);

    // 3. Gold sparkle — short ascending chirp on top
    if (variant === 'gold') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2400, now + 0.02);
      o.frequency.exponentialRampToValueAtTime(3600, now + 0.14);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, now + 0.02);
      og.gain.exponentialRampToValueAtTime(0.14, now + 0.025);
      og.gain.exponentialRampToValueAtTime(0.0005, now + 0.16);
      o.connect(og).connect(ctx.destination);
      o.start(now + 0.02);
      o.stop(now + 0.18);
    }
  }

  // -------- Grid build --------
  function computeBubbleCount(minPx) {
    const rect = grid.getBoundingClientRect();
    const cs = getComputedStyle(grid);
    const gap = parseFloat(cs.gap) || 8;
    const minSize = minPx || (window.innerWidth >= 720 ? 64 : 54);
    const cols = Math.max(1, Math.floor((rect.width + gap) / (minSize + gap)));
    const colWidth = (rect.width - gap * (cols - 1)) / cols;
    const availableHeight = rect.height || window.innerHeight * 0.7;
    const rows = Math.max(4, Math.floor((availableHeight + gap) / (colWidth + gap)));
    return cols * rows;
  }

  function pickBubbleType(cfg) {
    const r = Math.random();
    if (r < cfg.poisonPct) return 'poison';
    if (r < cfg.poisonPct + cfg.goldPct) return 'gold';
    return 'blue';
  }

  function buildGrid() {
    const cfg = state.mode === 'survival'
      ? levelConfig(state.level)
      : { goldPct: 0, poisonPct: 0, bubbleMinPx: null, bubbleCountFactor: 1 };
    if (cfg.bubbleMinPx) {
      grid.style.setProperty('--bubble-min', `${cfg.bubbleMinPx}px`);
    } else {
      grid.style.removeProperty('--bubble-min');
    }

    let count = computeBubbleCount(cfg.bubbleMinPx);
    if (state.mode === 'survival') {
      count = Math.max(SURVIVAL_MIN_BUBBLES, Math.round(count * cfg.bubbleCountFactor));
    }
    state.bubbleCount = count;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bubble';
      const type = state.mode === 'survival' ? pickBubbleType(cfg) : 'blue';
      if (type === 'gold') {
        b.classList.add('is-gold');
        b.dataset.type = 'gold';
        b.setAttribute('aria-label', 'Gold bonus bubble');
      } else if (type === 'poison') {
        b.classList.add('is-poison');
        b.dataset.type = 'poison';
        b.setAttribute('aria-label', 'Poison bubble — avoid');
      } else {
        b.dataset.type = 'blue';
        b.setAttribute('aria-label', 'Pop bubble');
      }
      frag.appendChild(b);
    }
    grid.replaceChildren(frag);
  }

  // -------- Mode UI --------
  function showModeToast(mode) {
    const info = MODE_INFO[mode];
    if (!info) return;
    modeToast.innerHTML = `<strong>${info.title}</strong>${info.desc}`;
    modeToast.hidden = false;
    modeToast.style.animation = 'none';
    void modeToast.offsetWidth;
    modeToast.style.animation = '';
    if (modeToastTimer) clearTimeout(modeToastTimer);
    modeToastTimer = setTimeout(() => { modeToast.hidden = true; }, 3000);
  }

  function applyMode(mode, showToast) {
    state.mode = mode;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    statTimer.hidden = (mode !== 'speed' && mode !== 'survival');
    statTarget.hidden = (mode !== 'speed');
    statBest.hidden = (mode !== 'speed' && mode !== 'survival');
    statLevel.hidden = (mode !== 'survival');
    statScore.hidden = (mode !== 'survival');
    countdown.hidden = (mode !== 'survival');

    if (mode === 'speed') {
      targetEl.textContent = String(SPEED_TARGET);
      renderBest('speed');
    }
    if (mode === 'survival') {
      renderBest('survival');
    }
    resetRound();
    if (showToast) showModeToast(mode);
  }

  function renderBest(which) {
    if (which === 'speed') {
      const raw = localStorage.getItem(BEST_SPEED_KEY);
      bestEl.textContent = raw ? `${parseFloat(raw).toFixed(2)}s` : '—';
    } else {
      const raw = localStorage.getItem(BEST_SURVIVAL_KEY);
      if (!raw) { bestEl.textContent = '—'; return; }
      try {
        const obj = JSON.parse(raw);
        bestEl.textContent = `${obj.score} · L${obj.level}`;
      } catch (_) { bestEl.textContent = '—'; }
    }
  }

  // -------- Timers --------
  function startSpeedTimer() {
    state.startTime = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - state.startTime) / 1000;
      timerEl.textContent = `${elapsed.toFixed(2)}s`;
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function startSurvivalTimer() {
    state.drainLastTs = performance.now();
    const tick = (now) => {
      if (state.isOver) return;
      const dt = (now - state.drainLastTs) / 1000;
      state.drainLastTs = now;
      const cfg = levelConfig(state.level);
      state.timeLeft = Math.max(0, state.timeLeft - dt * cfg.drainRate);
      renderCountdown();
      if (state.timeLeft <= 0) { finishSurvivalRound(); return; }
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function renderCountdown() {
    const pct = Math.max(0, Math.min(1, state.timeLeft / SURVIVAL_START_TIME));
    countdownFill.style.transform = `scaleX(${pct})`;
    countdownSeconds.textContent = state.timeLeft.toFixed(1);
    countdown.classList.toggle('is-warning', state.timeLeft <= 10 && state.timeLeft > 5);
    countdown.classList.toggle('is-danger', state.timeLeft <= 5);
  }

  function stopTimer() {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }

  // -------- Round lifecycle --------
  function resetRound() {
    stopTimer();
    state.popped = 0;
    state.levelPops = 0;
    state.score = 0;
    state.level = 1;
    state.timeLeft = SURVIVAL_START_TIME;
    state.startTime = null;
    state.drainLastTs = null;
    state.isOver = false;
    poppedEl.textContent = '0';
    if (state.mode === 'speed') timerEl.textContent = '0.00s';
    if (state.mode === 'survival') {
      timerEl.textContent = `${SURVIVAL_START_TIME.toFixed(1)}s`;
      levelEl.textContent = '1';
      scoreEl.textContent = '0';
      renderCountdown();
    }
    overlay.hidden = true;
    buildGrid();
  }

  function showFloat(target, text, kind) {
    const rect = target.getBoundingClientRect();
    const gameRect = grid.parentElement.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float-text' + (kind ? ` is-${kind}` : '');
    el.textContent = text;
    el.style.left = `${rect.left - gameRect.left + rect.width / 2}px`;
    el.style.top = `${rect.top - gameRect.top}px`;
    grid.parentElement.appendChild(el);
    setTimeout(() => el.remove(), 720);
  }

  function showLevelToast(level) {
    levelToast.textContent = `Level ${level}`;
    levelToast.hidden = false;
    levelToast.style.animation = 'none';
    void levelToast.offsetWidth;
    levelToast.style.animation = '';
    setTimeout(() => { levelToast.hidden = true; }, 2100);
  }

  // -------- Pop logic --------
  function onPop(e) {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('bubble')) return;
    if (target.classList.contains('is-popped')) return;
    if (state.isOver) return;

    const type = target.dataset.type || 'blue';
    target.classList.add('is-popped');
    if (type === 'poison') target.classList.add('was-poison');
    if (type === 'gold') target.classList.add('was-gold');
    target.setAttribute('aria-label', 'Popped');
    playPop(type);

    if (state.mode === 'survival') {
      handleSurvivalPop(target, type);
    } else if (state.mode === 'speed') {
      handleSpeedPop();
    } else {
      handleZenPop();
    }
  }

  function handleZenPop() {
    state.popped += 1;
    poppedEl.textContent = String(state.popped);
    if (state.popped >= state.bubbleCount * 0.95) {
      setTimeout(() => {
        if (state.mode === 'zen') {
          state.popped = 0;
          poppedEl.textContent = '0';
          buildGrid();
        }
      }, 400);
    }
  }

  function handleSpeedPop() {
    state.popped += 1;
    poppedEl.textContent = String(state.popped);
    if (state.popped === 1) startSpeedTimer();
    if (state.popped >= SPEED_TARGET) finishSpeedRound();
  }

  function handleSurvivalPop(target, type) {
    if (state.popped === 0) startSurvivalTimer();
    state.popped += 1;
    state.levelPops += 1;
    poppedEl.textContent = String(state.popped);

    if (type === 'gold') {
      state.timeLeft = Math.min(SURVIVAL_START_TIME, state.timeLeft + SURVIVAL_GOLD_BONUS);
      state.score += 5;
      showFloat(target, `+${SURVIVAL_GOLD_BONUS}s`, 'bonus');
    } else if (type === 'poison') {
      state.timeLeft = Math.max(0, state.timeLeft - SURVIVAL_POISON_PENALTY);
      showFloat(target, `−${SURVIVAL_POISON_PENALTY}s`, 'penalty');
    } else {
      state.timeLeft = Math.min(SURVIVAL_START_TIME, state.timeLeft + SURVIVAL_PER_POP);
      state.score += 1;
      if (state.popped % 5 === 0) showFloat(target, `+${SURVIVAL_PER_POP}s`, 'bonus');
    }

    scoreEl.textContent = String(state.score);
    renderCountdown();

    if (state.timeLeft <= 0) { finishSurvivalRound(); return; }

    if (state.levelPops >= SURVIVAL_LEVEL_THRESHOLD) {
      state.level += 1;
      state.levelPops = 0;
      levelEl.textContent = String(state.level);
      showLevelToast(state.level);
      buildGrid();
      return;
    }

    // Regenerate sheet if mostly popped
    const popped = grid.querySelectorAll('.is-popped').length;
    if (popped >= state.bubbleCount * 0.85) {
      buildGrid();
    }
  }

  function finishSpeedRound() {
    stopTimer();
    state.isOver = true;
    const elapsed = (performance.now() - state.startTime) / 1000;
    timerEl.textContent = `${elapsed.toFixed(2)}s`;

    const prevBest = parseFloat(localStorage.getItem(BEST_SPEED_KEY) || 'Infinity');
    const isNewBest = elapsed < prevBest;
    if (isNewBest) {
      localStorage.setItem(BEST_SPEED_KEY, elapsed.toFixed(3));
      renderBest('speed');
    }

    overlayTitle.textContent = isNewBest ? 'New Best!' : 'Nice Run';
    overlayBody.textContent = isNewBest
      ? `You popped ${SPEED_TARGET} bubbles in ${elapsed.toFixed(2)}s.`
      : `You popped ${SPEED_TARGET} in ${elapsed.toFixed(2)}s. Best: ${prevBest.toFixed(2)}s.`;
    overlay.hidden = false;
  }

  function finishSurvivalRound() {
    stopTimer();
    state.isOver = true;
    state.timeLeft = 0;
    renderCountdown();

    const prev = JSON.parse(localStorage.getItem(BEST_SURVIVAL_KEY) || 'null');
    const isNewBest = !prev || state.score > prev.score;
    if (isNewBest) {
      localStorage.setItem(BEST_SURVIVAL_KEY, JSON.stringify({ score: state.score, level: state.level }));
      renderBest('survival');
    }

    overlayTitle.textContent = isNewBest ? 'New High Score!' : 'Game Over';
    overlayBody.textContent = `Score: ${state.score} · Level ${state.level} · ${state.popped} bubbles popped${prev && !isNewBest ? ` · Best: ${prev.score}` : ''}`;
    overlay.hidden = false;
  }

  // -------- Wire up --------
  grid.addEventListener('pointerdown', onPop);
  modeButtons.forEach((btn) => btn.addEventListener('click', () => applyMode(btn.dataset.mode, true)));
  newSheetBtn.addEventListener('click', resetRound);
  overlayAgain.addEventListener('click', resetRound);
  document.addEventListener('pointerdown', ensureAudio, { once: true });

  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (state.mode === 'zen' || (state.popped === 0 && !state.isOver)) buildGrid();
    });
  });

  // Init
  applyMode('zen');
})();
