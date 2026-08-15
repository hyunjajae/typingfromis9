/* =========================================================================
   마이크 입력 (응원법 음성 모드)
   =========================================================================

   무엇을 말했는지는 보지 않습니다. 소리 지르는 발성은 인식률이 낮아서
   믿을 수 없기 때문입니다. 대신 "얼마나 크게, 언제 소리를 냈는지"만 봅니다.

   흐름
     마이크 → 저역 제거 → 음량(RMS) 측정 → 부드럽게 다듬기 → 기준선과 비교

   기준선은 시작 전에 조용한 상태를 2초 재서 정합니다.
   방마다 소음이 다르기 때문에, 고정값을 쓰면 어떤 방에서는 숨소리에도 반응하고
   어떤 방에서는 소리를 질러도 반응하지 않습니다.
   ========================================================================= */

const Voice = (() => {

  /* ---- 조정할 수 있는 값들 ----
     실제로 해보고 빠듯하거나 널널하면 이 숫자들을 고치면 됩니다. */
  const CFG = {
    // 환경 소음보다 이만큼은 커야 "외쳤다" 로 봅니다.
    // 보통 말소리가 배경 소음보다 10~15dB 크고, 외치는 소리는 20dB 이상 큽니다.
    MARGIN_DB: 12,

    // 아무리 조용한 방이어도 이보다 작은 소리는 인정하지 않습니다.
    // 없으면 아주 조용한 방에서 기준선이 너무 낮아져 숨소리에도 반응합니다.
    ABS_FLOOR_DB: -42,

    // 음량이 튀지 않게 다듬는 정도 (작을수록 부드럽고 반응이 느립니다)
    SMOOTH: 0.25,

    // 환경 소음을 재는 시간
    CALIB_MS: 2000,

    // 배경음이 마이크로 들어오는 만큼 기준을 올려줍니다.
    // 배경음 볼륨 100% 일 때 이만큼 올리고, 볼륨에 비례해 줄입니다.
    BGM_COMP_DB: 10,

    // 게이지에 표시할 음량 범위
    VIEW_MIN_DB: -60,
    VIEW_MAX_DB: -6
  };

  let audioCtx = null;
  let stream = null;
  let analyser = null;
  let buf = null;
  let level = -100;          // 다듬어진 현재 음량(dB)
  let noiseFloor = -60;      // 측정된 환경 소음
  let userAdjust = 0;        // 사용자가 슬라이더로 더하거나 뺀 값(dB)
  let opened = false;

  /* ---- 마이크 열기 ----
     반드시 사용자가 버튼을 누른 흐름 안에서 불러야 합니다.
     (iOS 는 그렇지 않으면 소리 장치를 열어주지 않습니다) */
  async function open() {
    if (opened) return true;

    /* 브라우저는 "안전한 주소" 에서만 마이크를 내줍니다.
       https:// 와 localhost 는 되고, 파일을 더블클릭해서 여는 file:// 은 안 됩니다.
       이때 navigator.mediaDevices 자체가 없어서, 허용을 눌러도 아무 일이 안 일어납니다.
       원인을 알 수 있게 따로 알려줍니다. */
    if (location.protocol === "file:") {
      const e = new Error("file: 주소에서는 마이크를 쓸 수 없습니다.");
      e.code = "INSECURE";
      throw e;
    }
    if (!window.isSecureContext) {
      const e = new Error("안전한 주소(https 또는 localhost)가 아니라 마이크를 쓸 수 없습니다.");
      e.code = "INSECURE";
      throw e;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const e = new Error("이 브라우저는 마이크를 지원하지 않습니다.");
      e.code = "UNSUPPORTED";
      throw e;
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // 스피커 소리가 마이크로 들어오는 걸 줄여줍니다
        noiseSuppression: true,
        // 자동 볼륨 조절은 반드시 꺼야 합니다.
        // 켜두면 브라우저가 음량을 알아서 맞춰버려서 크게 외쳤는지 알 수 없습니다.
        autoGainControl: false
      }
    });

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const src = audioCtx.createMediaStreamSource(stream);

    // 배경음의 낮은 소리(드럼·베이스)를 걸러냅니다. 목소리는 그대로 지나갑니다.
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 100;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;   // 다듬는 건 아래에서 직접 합니다

    src.connect(highpass);
    highpass.connect(analyser);
    // 스피커로는 내보내지 않습니다 (내보내면 하울링이 납니다)

    buf = new Float32Array(analyser.fftSize);
    level = -100;
    opened = true;
    return true;
  }

  function close() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
    stream = null; audioCtx = null; analyser = null; buf = null;
    opened = false;
    level = -100;
  }

  /* ---- 지금 이 순간의 음량(dB) ----
     RMS(제곱평균)를 씁니다. 순간 최대값은 잡음에 튀지만
     RMS 는 사람이 느끼는 크기에 가깝습니다. */
  function readDb() {
    if (!analyser) return -100;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    return rms > 1e-7 ? 20 * Math.log10(rms) : -100;
  }

  /** 매 프레임 불러서 음량을 갱신합니다 */
  function update() {
    if (!opened) return level;
    const db = readDb();
    // 부드럽게 따라가게 합니다 (갑자기 튀는 값 억제)
    level = level + (db - level) * CFG.SMOOTH;
    return level;
  }

  /* ---- 환경 소음 재기 ----
     조용한 상태를 잠깐 재서 기준선을 잡습니다.
     평균이 아니라 위쪽 10% 값을 쓰는 이유는, 가끔 나는 소음까지
     흡수해야 게임 중에 잘못 반응하지 않기 때문입니다. */
  function calibrate(onProgress) {
    return new Promise((done) => {
      const samples = [];
      const t0 = performance.now();

      // 화면 갱신(rAF)이 아니라 타이머로 잽니다.
      // 창이 뒤에 가려지면 rAF 는 멈춰버려서, 재는 게 영영 안 끝날 수 있습니다.
      const timer = setInterval(() => {
        const passed = performance.now() - t0;
        samples.push(readDb());
        if (onProgress) onProgress(Math.min(1, passed / CFG.CALIB_MS));
        if (passed < CFG.CALIB_MS) return;

        clearInterval(timer);
        samples.sort((a, b) => a - b);
        const p90 = samples[Math.floor(samples.length * 0.9)] || -60;
        noiseFloor = Math.max(-80, Math.min(-20, p90));
        level = noiseFloor;
        done(noiseFloor);
      }, 25);
    });
  }

  /* ---- 이 정도는 넘어야 "외쳤다" 로 보는 기준 ---- */
  function threshold() {
    // 배경음이 클수록 마이크에도 그만큼 들어오므로 기준을 같이 올립니다
    const bgm = (typeof Audio9 !== "undefined" && !Audio9.paused)
      ? CFG.BGM_COMP_DB * Audio9.volume
      : 0;
    const fromNoise = noiseFloor + CFG.MARGIN_DB + bgm;
    return Math.max(fromNoise, CFG.ABS_FLOOR_DB) + userAdjust;
  }

  const isLoud = () => opened && level > threshold();

  /* ---- 게이지 그리기 ---- */
  const toPct = (db) => {
    const p = (db - CFG.VIEW_MIN_DB) / (CFG.VIEW_MAX_DB - CFG.VIEW_MIN_DB);
    return Math.max(0, Math.min(1, p)) * 100;
  };

  function paintGauge(barEl, zoneEl, hintEl) {
    if (!barEl) return;
    const pct = toPct(level);
    barEl.style.width = pct.toFixed(1) + "%";
    barEl.classList.toggle("is-loud", isLoud());

    if (zoneEl) {
      // 기준선부터 위쪽이 "충분히 큰" 구간입니다
      const from = toPct(threshold());
      zoneEl.style.left = from.toFixed(1) + "%";
      zoneEl.style.width = (100 - from).toFixed(1) + "%";
    }
    if (hintEl) {
      const quiet = !isLoud() && level < threshold() - 6;
      hintEl.textContent = quiet ? "더 크게!" : "";
      hintEl.classList.toggle("is-on", quiet);
    }
  }

  /* ---- 사용자 미세조정 ----
     환경이 특이해서 기본값이 안 맞을 때 씁니다.
     +로 갈수록 더 크게 외쳐야 인정됩니다. */
  function setAdjust(db) { userAdjust = db; }
  const getAdjust = () => userAdjust;

  return {
    CFG,
    open, close, update, calibrate,
    threshold, isLoud, paintGauge,
    setAdjust, getAdjust,
    get level() { return level; },
    get noiseFloor() { return noiseFloor; },
    get opened() { return opened; }
  };
})();
