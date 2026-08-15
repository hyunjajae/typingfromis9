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
    // 환경 소음보다 이만큼 크면 확실히 "외쳤다" 로 봅니다.
    // 단, 마이크가 약해서 이만큼 못 올라가는 경우가 많습니다. 아래 참고.
    MARGIN_DB: 12,

    // 마이크가 약할 때 쓰는 값들.
    //
    // 노트북 내장 마이크는 자동 볼륨 조절(AGC)에 기대도록 만들어져 있어서,
    // 그걸 끄면 소리를 질러도 외장 마이크보다 20dB 넘게 작게 들어옵니다.
    // 그래서 "몇 dB 이상" 같은 절대 기준을 쓰면 내장 마이크는 아무리 질러도
    // 기준을 못 넘습니다. (실제로 이것 때문에 인식이 아예 안 됐습니다)
    //
    // 그래서 기준을 절대값이 아니라 "이 사람이 실제로 낸 소리" 기준으로 잡습니다.
    // 조용할 때와 지를 때의 차이를 재서, 그 사이 이만큼 지점을 기준으로 씁니다.
    LOUD_RATIO: 0.45,
    MIN_MARGIN_DB: 4,      // 그래도 소음보다는 이만큼은 커야 합니다

    // 신호가 아예 죽은 게 아닌지만 보는 아주 낮은 하한
    ABS_FLOOR_DB: -75,

    /* 음량 다듬기 — 올라갈 때와 내려갈 때를 다르게 합니다.
       똑같이 두면 "소리를 질렀는데 한 박자 늦게 반응하는" 느낌이 납니다.
       올라갈 때는 거의 바로 따라가고(ATTACK), 내려갈 때만 천천히 빠집니다. */
    ATTACK: 0.65,
    RELEASE: 0.12,

    /* 한 번 소리가 올라가면 이 시간 동안은 계속 내는 것으로 봅니다.
       "이·새·롬" 처럼 또박또박 외치면 글자 사이에 순간적으로 소리가 끊기는데,
       그걸 매번 "멈췄다" 로 보면 글자가 안 채워집니다. */
    HOLD_MS: 180,

    // 환경 소음을 재는 시간
    CALIB_MS: 2000,

    // 배경음이 마이크로 들어오는 만큼 기준을 올려줍니다.
    // 배경음 볼륨 100% 일 때 이만큼 올리고, 볼륨에 비례해 줄입니다.
    BGM_COMP_DB: 10
  };

  let audioCtx = null;
  let stream = null;
  let analyser = null;
  let buf = null;
  let level = -100;          // 다듬어진 현재 음량(dB)
  let noiseFloor = -60;      // 측정된 환경 소음
  let peak = -100;           // 이 사람이 실제로 낸 제일 큰 소리
  let loudUntil = 0;         // 이 시각까지는 계속 내는 것으로 봄
  let userAdjust = 0;        // 사용자가 슬라이더로 더하거나 뺀 값(dB)
  let opened = false;
  let curId = "";            // 지금 쓰고 있는 마이크

  /* ---- 마이크 열기 ----
     반드시 사용자가 버튼을 누른 흐름 안에서 불러야 합니다.
     (iOS 는 그렇지 않으면 소리 장치를 열어주지 않습니다) */
  async function open(deviceId) {
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

    /* 조건은 전부 "되면 좋고"(ideal) 로 겁니다.
       required 로 걸면 그걸 못 맞추는 마이크에서 아예 실패해버립니다.
       autoGainControl 은 특히 중요합니다. 켜져 있으면 브라우저가 음량을
       알아서 맞춰버려서, 크게 외쳤는지 아닌지를 판단할 수가 없습니다.
       noiseSuppression 은 껐습니다. 잡음을 지우는 과정에서 음량 자체가
       깎여서, 우리가 재려는 값이 망가집니다. */
    const want = {
      echoCancellation: { ideal: true },   // 스피커 소리가 마이크로 들어오는 걸 줄여줍니다
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false }
    };
    // 쓸 마이크를 직접 고른 경우
    if (deviceId) want.deviceId = { exact: deviceId };

    stream = await navigator.mediaDevices.getUserMedia({ audio: want });

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
    // 스피커로는 내보내지 않습니다 (내보내면 하울링이 납니다).
    // 분석기만 매달아둬도 크롬은 이 가지를 계산해줍니다 — 확인했습니다.

    buf = new Float32Array(analyser.fftSize);
    level = -100;
    opened = true;
    curId = deviceId || "";
    return true;
  }

  /* ---- 쓸 수 있는 마이크 목록 ----
     이름은 마이크 권한을 받은 뒤에야 보입니다. 그래서 open() 다음에 부릅니다.

     윈도우에서는 크롬이 "기본 장치" 가 아니라 "통신용 기본 장치" 를 잡는 일이
     자주 있습니다. 거기에 안 쓰는 헤드셋이나 스테레오 믹스가 걸려 있으면
     권한은 멀쩡히 받았는데 소리는 하나도 안 들어옵니다.
     그때 직접 고를 수 있어야 합니다. */
  async function listMics() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ id: d.deviceId, label: d.label || "마이크 " + (i + 1) }));
  }

  const currentId = () => curId;

  /** 마이크가 열려는 있는데 소리가 하나도 안 들어오는 상태인지 */
  const isSilent = () => opened && readDb() <= -99;

  /** 지금 어떤 마이크를 쓰고 있는지 (문제 생겼을 때 보여주려고) */
  function deviceLabel() {
    if (!stream) return "";
    const t = stream.getAudioTracks()[0];
    return t ? (t.label || "이름 없는 장치") : "";
  }

  function close() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
    stream = null; audioCtx = null; analyser = null; buf = null;
    opened = false;
    level = -100;
    peak = -100;
    loudUntil = 0;
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
    // 탭을 옮겨다니다 보면 소리 장치가 잠들어 있을 때가 있습니다
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    const db = readDb();

    // 커질 때는 빠르게, 작아질 때는 천천히.
    // 그래야 지른 순간 바로 반응하면서도 값이 덜덜 떨리지 않습니다.
    const k = db > level ? CFG.ATTACK : CFG.RELEASE;
    level = level + (db - level) * k;

    // 이 사람이 낼 수 있는 최대치를 계속 배웁니다 (기준을 여기 맞춥니다)
    if (level > peak) peak = level;
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
        // 약한 마이크는 소음이 -85dB 근처까지 내려갑니다. 하한을 넉넉히 둡니다.
        noiseFloor = Math.max(-90, Math.min(-20, p90));
        level = noiseFloor;
        peak = noiseFloor;          // 목소리 크기는 이제부터 다시 배웁니다
        loudUntil = 0;
        done(noiseFloor);
      }, 25);
    });
  }

  /* ---- 이 정도는 넘어야 "외쳤다" 로 보는 기준 ----

     기본은 "환경 소음 + 12dB" 입니다. 외장 마이크는 이걸 쉽게 넘습니다.

     그런데 노트북 내장 마이크는 소리를 질러도 소음보다 8~10dB 밖에 안 커집니다.
     그 상태에서 12dB 를 요구하면 아무리 질러도 인식이 안 됩니다.
     그래서 이 사람이 실제로 낸 제일 큰 소리(peak)를 보고,
     소음과 그 사이의 중간쯤을 기준으로 낮춰 잡습니다.

     기준이 기본값(+12dB)보다 높아지는 일은 없습니다. 쉬워지기만 합니다. */
  function threshold() {
    let margin = CFG.MARGIN_DB;

    const gap = peak - noiseFloor;
    if (gap > 3) {
      margin = Math.min(margin, Math.max(CFG.MIN_MARGIN_DB, gap * CFG.LOUD_RATIO));
    }

    // 배경음이 클수록 마이크에도 그만큼 들어오므로 기준을 같이 올립니다
    const bgm = (typeof Audio9 !== "undefined" && !Audio9.paused)
      ? CFG.BGM_COMP_DB * Audio9.volume
      : 0;

    return Math.max(noiseFloor + margin + bgm, CFG.ABS_FLOOR_DB) + userAdjust;
  }

  /* ---- 지금 소리를 내고 있는가 ----
     한 번 올라가면 잠깐(HOLD_MS)은 계속 내는 것으로 봅니다.
     또박또박 외칠 때 글자 사이에 나는 짧은 끊김을 메꾸기 위해서입니다. */
  function isLoud() {
    if (!opened) return false;
    if (level > threshold()) {
      loudUntil = performance.now() + CFG.HOLD_MS;
      return true;
    }
    return performance.now() < loudUntil;
  }

  /* ---- 게이지 그리기 ----
     보여줄 범위도 마이크에 맞춥니다.
     고정 범위(-60~-6dB)를 쓰면, 약한 마이크로는 소리를 질러도
     막대가 눈곱만큼만 움직여서 "안 되는구나" 싶어집니다. */
  function viewRange() {
    const lo = noiseFloor - 6;
    const hi = Math.max(threshold() + 10, peak + 3, lo + 14);
    return [lo, hi];
  }

  const toPct = (db) => {
    const [lo, hi] = viewRange();
    const p = (db - lo) / Math.max(1, hi - lo);
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
    isSilent, deviceLabel, readDb, listMics, currentId,
    get level() { return level; },
    get noiseFloor() { return noiseFloor; },
    get peak() { return peak; },
    get opened() { return opened; }
  };
})();
