/* =========================================================================
   fromis_9 TYPING — 게임 로직
   -------------------------------------------------------------------------
   구성
     0. 짧은 도우미 함수
     1. 한글 자모 분해 (타이핑 판정의 핵심)
     2. 화면 전환 / 테마
     3. 오디오 매니저 (구간 재생 · 파일 없을 때 처리)
     4. 모드 1 : 가사 타이핑
     5. 모드 2 : 인트로 퀴즈
     6. 시작 화면 · 초기화
   ========================================================================= */

/* ======================= 0. 짧은 도우미 함수 ======================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** 초 → "12.3s" 또는 "1:02.4" 형태 문자열 */
function fmtTime(sec) {
  if (sec < 60) return sec.toFixed(1) + "s";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

/** 초 → "3:07" (오디오 재생 위치 표시용) */
function fmtMmSs(sec) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + String(s).padStart(2, "0");
}

/** 초 → "00:12.3" (퀴즈 타이머용, 자리수 고정) */
function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return String(m).padStart(2, "0") + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
}

/** 배열을 무작위로 섞습니다 (Fisher–Yates) */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 정답 비교용 정규화: 소문자 + 공백/특수문자 모두 제거
 *  "Talk & Talk" → "talktalk"  →  "talk talk" 로 쳐도 정답 처리 */
function normalizeAnswer(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\s　]/g, "")          // 모든 공백 제거
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, ""); // 한글/영문/숫자만 남김
}

/* ======================= 1. 한글 자모 분해 =======================
   한글은 "ㅇ → 아 → 안 → 안녕" 처럼 글자가 조합되면서 완성됩니다.
   그래서 조합 중인 글자를 그냥 비교하면 "아직 다 안 쳤을 뿐인데 틀림"으로
   잘못 판정돼요. 그래서 글자를 자모(키보드로 실제 누른 순서)로 쪼개서
   "목표 글자의 앞부분과 같은가?"를 확인합니다.                          */

const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

/* 두 번 눌러야 나오는 겹자모 → 실제 키 순서로 쪼개기
   (ㅘ 는 ㅗ 다음 ㅏ 를 눌러야 나오므로 2타로 셉니다) */
const COMPOUND = {
  "ㅘ":["ㅗ","ㅏ"], "ㅙ":["ㅗ","ㅐ"], "ㅚ":["ㅗ","ㅣ"],
  "ㅝ":["ㅜ","ㅓ"], "ㅞ":["ㅜ","ㅔ"], "ㅟ":["ㅜ","ㅣ"], "ㅢ":["ㅡ","ㅣ"],
  "ㄳ":["ㄱ","ㅅ"], "ㄵ":["ㄴ","ㅈ"], "ㄶ":["ㄴ","ㅎ"], "ㄺ":["ㄹ","ㄱ"],
  "ㄻ":["ㄹ","ㅁ"], "ㄼ":["ㄹ","ㅂ"], "ㄽ":["ㄹ","ㅅ"], "ㄾ":["ㄹ","ㅌ"],
  "ㄿ":["ㄹ","ㅍ"], "ㅀ":["ㄹ","ㅎ"], "ㅄ":["ㅂ","ㅅ"]
};

/** 겹자모면 쪼개고, 아니면 그대로 (배열로 반환) */
function splitCompound(jamo) {
  return COMPOUND[jamo] ? COMPOUND[jamo].slice() : [jamo];
}

/** 글자 하나 → 실제 키를 누른 순서의 자모 배열
 *  "값" → ["ㄱ","ㅏ","ㅂ","ㅅ"] (4타)
 *  "A"  → ["A"] (1타) */
function toJamo(ch) {
  const code = ch.charCodeAt(0);

  // 완성형 한글 (가 ~ 힣)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const idx = code - 0xac00;
    const cho = Math.floor(idx / 588);
    const jung = Math.floor((idx % 588) / 28);
    const jong = idx % 28;

    let out = [CHO[cho]];
    out = out.concat(splitCompound(JUNG[jung]));
    if (jong > 0) out = out.concat(splitCompound(JONG[jong]));
    return out;
  }

  // 홀로 있는 자모 (ㄱ, ㅏ 같은 조합 중간 상태)
  if (code >= 0x3131 && code <= 0x3163) return splitCompound(ch);

  // 그 외(영문·숫자·기호·공백)는 1타
  return [ch];
}

/* ---- 인트로 퀴즈용 "너그러운" 한국어 판정 ----
   사람마다 외래어를 다르게 적습니다. (필굿 / 삘굿 / 필 굿 / 필굳 …)
   그래서 퀴즈에서는 발음이 같아지는 글자들을 하나로 합쳐서 비교합니다.
   ※ 가사 타이핑 모드는 이걸 쓰지 않고 정확하게 판정합니다.        */

// 초성: 된소리·거센소리를 예사소리로 (ㅃ·ㅍ → ㅂ)
const CHO_LOOSE = {
  "ㄲ": "ㄱ", "ㅋ": "ㄱ",
  "ㄸ": "ㄷ", "ㅌ": "ㄷ",
  "ㅃ": "ㅂ", "ㅍ": "ㅂ",
  "ㅆ": "ㅅ",
  "ㅉ": "ㅈ", "ㅊ": "ㅈ"
};

// 중성: 사람마다 다르게 적는 모음끼리 합치기
//  - ㅐ/ㅔ 처럼 요즘 구분이 거의 사라진 것
//  - 외래어를 적을 때 흔들리는 것 (슈퍼 / 수퍼, 쥬스 / 주스, 텔레비젼 / 텔레비전)
//    → ㅑㅕㅛㅠ 를 ㅏㅓㅗㅜ 로 합칩니다
const JUNG_LOOSE = {
  "ㅐ": "ㅔ", "ㅒ": "ㅔ", "ㅖ": "ㅔ",
  "ㅙ": "ㅚ", "ㅞ": "ㅚ",
  "ㅢ": "ㅣ",
  "ㅑ": "ㅏ", "ㅕ": "ㅓ", "ㅛ": "ㅗ", "ㅠ": "ㅜ"
};

// 종성: 한국어 "끝소리 규칙" — 받침은 실제로 7가지 소리로만 납니다.
// (굿 / 굳 / 궂 / 궃 은 전부 같은 소리라서 같은 것으로 봅니다)
const JONG_LOOSE = {
  "":  "",
  "ㄱ": "ㄱ", "ㄲ": "ㄱ", "ㅋ": "ㄱ", "ㄳ": "ㄱ", "ㄺ": "ㄱ",
  "ㄴ": "ㄴ", "ㄵ": "ㄴ", "ㄶ": "ㄴ",
  "ㄷ": "ㄷ", "ㅅ": "ㄷ", "ㅆ": "ㄷ", "ㅈ": "ㄷ", "ㅊ": "ㄷ", "ㅌ": "ㄷ", "ㅎ": "ㄷ",
  "ㄹ": "ㄹ", "ㄼ": "ㄹ", "ㄽ": "ㄹ", "ㄾ": "ㄹ", "ㅀ": "ㄹ",
  "ㅁ": "ㅁ", "ㄻ": "ㅁ",
  "ㅂ": "ㅂ", "ㅄ": "ㅂ", "ㅍ": "ㅂ",
  "ㅇ": "ㅇ"
};

/** 퀴즈 정답 비교용 "느슨한 열쇠"를 만듭니다.
 *  "필굿" · "삘굿" · "필 굿" · "삘굳"  →  전부 같은 값이 됩니다. */
function looseKey(str) {
  const base = normalizeAnswer(str);   // 소문자 + 공백/특수문자 제거
  let out = "";

  for (const ch of base) {
    const code = ch.charCodeAt(0);

    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      const cho = CHO[Math.floor(idx / 588)];
      const jung = JUNG[Math.floor((idx % 588) / 28)];
      const jong = JONG[idx % 28];
      out += (CHO_LOOSE[cho] || cho) + (JUNG_LOOSE[jung] || jung) + (JONG_LOOSE[jong] || "");
    } else {
      out += ch;   // 영문·숫자는 그대로
    }
  }
  return out;
}

/* ---- 글자 칸 그리기 (가사 타이핑 · 응원법 공용) ----
   칸 안에는 "내가 실제로 친 글자"가 들어갑니다.
   아직 안 친 칸은 쳐야 할 글자를 흐리게 보여주고,
   틀린 칸은 위쪽에 원래 글자를 작게 알려줍니다. */
function renderTypingCells(el, target, value, composing) {
  // 조합 중이면 마지막 글자는 아직 "확정 안 된" 글자입니다
  const settledLen = composing ? Math.max(0, value.length - 1) : value.length;
  const frag = document.createDocumentFragment();
  const total = Math.max(target.length, value.length);

  const wantHint = (ch) => {
    const hint = document.createElement("i");
    hint.className = "ch__want";
    hint.textContent = ch === " " ? "␣" : ch;
    return hint;
  };

  for (let i = 0; i < total; i++) {
    const wantCh = target[i];
    const gotCh = value[i];

    const span = document.createElement("span");
    span.className = "ch";
    if (wantCh === " ") span.classList.add("ch--space");

    if (i >= target.length) {
      span.classList.add("ch--extra");
      span.textContent = gotCh;

    } else if (i < settledLen) {
      span.textContent = gotCh;
      if (sameChar(gotCh, wantCh)) {
        span.classList.add("ch--ok");
      } else {
        span.classList.add("ch--ng");
        span.appendChild(wantHint(wantCh));
      }

    } else if (composing && i === settledLen && gotCh) {
      span.textContent = gotCh;
      if (isPartialMatch(gotCh, wantCh)) {
        span.classList.add("ch--partial");
      } else {
        span.classList.add("ch--ng");
        span.appendChild(wantHint(wantCh));
      }

    } else {
      span.textContent = wantCh;
      span.classList.add("ch--todo");
      if (i === settledLen) span.classList.add("ch--cursor");
    }

    frag.appendChild(span);
  }

  el.replaceChildren(frag);
}

/** 가사 타이핑용 글자 비교 — 영문 대소문자는 구분하지 않습니다.
 *  (Shift 를 안 눌러도 맞은 것으로 처리) */
function sameChar(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** 줄 전체가 같은지 (역시 대소문자 무시) */
function sameLine(a, b) {
  return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

/** 글자 하나의 타수 (한글은 2~4타, 나머지는 1타) */
function strokeCount(ch) {
  return toJamo(ch).length;
}

/** 문자열 전체의 타수 */
function strokesOf(str) {
  let n = 0;
  for (const ch of str) n += strokeCount(ch);
  return n;
}

/** 조합 중인 글자가 목표 글자의 "앞부분"인지 확인
 *  예: 목표 "안", 지금 "아" → true (계속 치면 맞음)
 *      목표 "안", 지금 "바" → false (이미 틀림)                  */
function isPartialMatch(typedCh, targetCh) {
  if (typedCh === targetCh) return true;
  const t = toJamo(typedCh);
  const g = toJamo(targetCh);
  if (t.length > g.length) return false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== g[i]) return false;
  }
  return true;
}

/* ======================= 2. 화면 전환 / 테마 ======================= */

/** id 에 해당하는 화면만 보여줍니다 */
/** 기능이 공개된 상태인지 확인합니다. (data/features.js)
 *  설정 파일이 없거나 값이 없으면 "공개"로 봅니다. */
function feature(name) {
  if (typeof FEATURES === "undefined") return true;
  return FEATURES[name] !== false;
}

/** 아직 공개하지 않은 기능을 화면에서 감춥니다. */
function applyFeatureFlags() {
  // ── 인트로 퀴즈 ──
  if (!feature("quiz")) {
    $("#btnModeQuiz").hidden = true;
    $("#tabQuiz").hidden = true;      // 랭킹 화면의 퀴즈 탭
  }

  // ── 노래 맞춰주기 ──
  if (!feature("autoWait")) {
    $("#btnAutoWait").hidden = true;
    $("#waitBadge").hidden = true;
  }

  // ── 응원법 ──
  // 스위치가 꺼져 있거나, 응원법이 등록된 곡이 아예 없으면 감춥니다
  const hasChants = typeof SONGS !== "undefined" &&
                    SONGS.some((s) => s.chants && s.chants.length > 0);
  if (!feature("chant") || !hasChants) {
    $("#btnModeChant").hidden = true;
  }

  // NEW 배지는 따로 끌 수 있게 해둡니다
  if (!feature("chantIsNew")) $("#chantNewBadge").hidden = true;

  // 보이는 카드 수에 맞춰 배치를 바꿉니다
  const shown = $$(".mode-card").filter((c) => !c.hidden).length;
  const grid = $(".mode-grid");
  grid.classList.toggle("mode-grid--single", shown === 1);
  grid.classList.toggle("mode-grid--pair", shown === 2);
}

/** 각 화면에서 "뒤로" 를 누르면 갈 곳 */
const BACK_TO = {
  "screen-select": "screen-home",
  "screen-lyrics": "screen-select",
  "screen-lyrics-result": "screen-select",
  "screen-quiz-intro": "screen-home",
  "screen-quiz": "screen-quiz-intro",
  "screen-quiz-result": "screen-quiz-intro",
  "screen-ranking": "screen-home",
  "screen-chant-select": "screen-home",
  "screen-chant": "screen-chant-select",
  "screen-chant-result": "screen-chant-select"
};

let currentScreen = "screen-home";

function showScreen(id) {
  currentScreen = id;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));

  // 플레이 화면에서는 배경 스크롤을 잠급니다.
  // (모바일에서는 키보드가 올라오면 스크롤이 필요해서 잠그지 않습니다)
  const playing = id === "screen-lyrics" || id === "screen-quiz" || id === "screen-chant";
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  document.body.classList.toggle("is-playing", playing && !narrow);
  $("#hud").hidden = !playing;

  // 시작 화면에서는 뒤로 가기를 숨깁니다
  $("#btnBack").hidden = !BACK_TO[id];

  window.scrollTo(0, 0);
}

/** 지금 화면 기준으로 한 단계 뒤로 갑니다 */
function goBack() {
  const to = BACK_TO[currentScreen];
  if (!to) return;

  // 게임 중이었다면 정리부터
  if (currentScreen === "screen-lyrics") Lyrics.quit();
  if (currentScreen === "screen-quiz") Quiz.quit();
  if (currentScreen === "screen-chant") Chant.quit();
  if (currentScreen === "screen-lyrics-result" || currentScreen === "screen-chant-result") setStageBg("");

  if (to === "screen-home") { goHome(); return; }
  if (to === "screen-quiz-intro") { Quiz.showIntro(); return; }
  showScreen(to);
}

/* ---- 작은 커버(썸네일) ----
   커버 원본은 800px 인데 시작 화면 띠(108px)나 곡 목록(약 200px)에서는
   그렇게 클 필요가 없습니다. 그래서 covers/thumb/ 의 400px 짜리를 씁니다.
   (16장 기준 1.66MB → 0.45MB)

   썸네일이 없는 곡은 자동으로 원본을 씁니다. 그러니 곡을 새로 추가할 때
   썸네일을 안 만들어도 그냥 동작합니다. */

/** 커버 경로 → 썸네일 경로 (covers/dm.jpg → covers/thumb/dm.jpg) */
function thumbOf(cover) {
  if (!cover) return "";
  const name = cover.split("/").pop().replace(/\.[^.]+$/, "");
  return "covers/thumb/" + name + ".jpg";
}

/** 썸네일을 먼저 쓰고, 없으면 원본으로 되돌아가는 <img> 를 만듭니다 */
function makeCoverImg(cover) {
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.dataset.full = cover;
  img.addEventListener("error", function onErr() {
    // 썸네일이 없으면 원본으로 한 번 다시 시도
    if (img.dataset.full && img.src.indexOf("/thumb/") !== -1) {
      img.src = img.dataset.full;
    } else {
      img.remove();
    }
  });
  return img;
}

/** SONG_ORDER 에 적힌 순서대로 곡을 정렬합니다.
 *  목록에 없는 곡은 맨 뒤로 보냅니다. */
function orderedSongs() {
  const order = (typeof SONG_ORDER !== "undefined") ? SONG_ORDER : [];
  const rank = (s) => {
    const i = order.indexOf(s.id);
    return i === -1 ? order.length + 999 : i;
  };
  return SONGS.slice().sort((a, b) => rank(a) - rank(b));
}

/* ---- 앨범 커버 미리 불러오기 ----
   퀴즈에서 정답을 맞힌 순간 커버가 바로 떠야 합니다.
   그때 가서 불러오면 대체 이미지가 잠깐 깜빡이므로,
   게임을 켤 때 미리 전부 받아서 브라우저 캐시에 넣어둡니다. */

const coverCache = {};   // { 경로: { img, ok } }

function preloadCovers() {
  SONGS.forEach((s) => {
    if (!s.cover || coverCache[s.cover]) return;
    const entry = { img: new Image(), ok: false };
    entry.img.onload = () => { entry.ok = true; };
    entry.img.onerror = () => { entry.ok = false; };
    entry.img.src = s.cover;
    coverCache[s.cover] = entry;
  });
}

/** 커버가 지금 당장 그릴 수 있는 상태인지 (미리 로딩이 끝났는지) */
function isCoverReady(path) {
  const e = coverCache[path];
  return !!(e && e.ok && e.img.complete && e.img.naturalWidth > 0);
}

/** 앨범 커버를 화면 뒤에 흐리게 깔거나(경로 전달) 지웁니다(빈 값 전달) */
function setStageBg(coverPath) {
  const bg = $("#stageBg");
  if (!coverPath) {
    bg.classList.remove("is-on");
    return;
  }
  // 이미지가 실제로 있을 때만 켭니다 (없으면 회색 덩어리만 남으므로)
  const probe = new Image();
  probe.onload = () => {
    bg.style.backgroundImage = 'url("' + coverPath + '")';
    bg.classList.add("is-on");
  };
  probe.onerror = () => bg.classList.remove("is-on");
  probe.src = coverPath;
}

const THEME_KEY = "f9typing_theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  $("#themeIcon").textContent = theme === "dark" ? "☾" : "◐";
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  $("#btnTheme").addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme");
    applyTheme(now === "dark" ? "light" : "dark");
  });
}

/* ======================= 3. 오디오 매니저 =======================
   - mp3 파일이 없어도 게임이 멈추면 안 되므로 실패를 모두 감싸둡니다.
   - 인트로 퀴즈는 "start 초부터 duration 초만" 정확히 재생해야 해서
     currentTime 으로 이동한 뒤 requestAnimationFrame 으로 감시하다가
     끝나는 지점에서 멈춥니다. (setTimeout 도 보조로 같이 겁니다) */

const Audio9 = (() => {
  const el = new Audio();
  el.preload = "auto";

  let segRaf = null;      // 구간 재생 감시용 rAF id
  let segTimer = null;    // 보조 setTimeout id
  let failCb = null;      // 로드 실패시 호출할 함수
  let endCb = null;       // 구간 재생이 끝났을 때 호출할 함수

  /* 재생 요청 번호.
     파일을 새로 걸면 "준비될 때까지" 기다렸다가 재생하는데,
     그 사이 다른 요청이 들어오면 먼저 기다리던 요청이 뒤늦게 깨어나
     엉뚱한 위치로 옮기거나 새 재생을 멈춰버립니다.
     그래서 요청마다 번호를 매기고, 번호가 바뀌었으면 무시합니다. */
  let seq = 0;

  el.addEventListener("error", () => { if (failCb) failCb(); });

  function clearSeg() {
    if (segRaf) cancelAnimationFrame(segRaf);
    if (segTimer) clearTimeout(segTimer);
    segRaf = null;
    segTimer = null;
  }

  /** 재생 완전 정지 */
  function stop() {
    seq++;                 // 기다리던 이전 요청을 무효화
    clearSeg();
    try { el.pause(); } catch (e) {}
  }

  /** 메타데이터(길이 정보)가 준비되면 콜백 실행.
   *  기다리는 사이 새 요청이 들어왔으면 이 요청은 버립니다. */
  function whenReady(fn) {
    const mine = seq;
    const run = () => { if (mine === seq) fn(); };
    if (el.readyState >= 1) run();
    else el.addEventListener("loadedmetadata", run, { once: true });
  }

  /** 곡 파일을 걸어둡니다. onFail = 파일이 없을 때 부를 함수 */
  function load(src, onFail) {
    stop();
    failCb = onFail || null;
    if (!src) { if (failCb) failCb(); return; }
    el.src = src;
    el.load();
  }

  /** 처음부터(또는 from 초부터) 그냥 재생 */
  function play(from) {
    clearSeg();
    seq++;
    whenReady(() => {
      try { if (typeof from === "number") el.currentTime = from; } catch (e) {}
      el.play().catch(() => { /* 자동재생 차단 등 — 조용히 무시 */ });
    });
  }

  /** start 초부터 duration 초만 재생하고 멈춤 */
  function playSegment(start, duration, onEnd) {
    clearSeg();
    seq++;
    endCb = onEnd || null;
    const stopAt = start + duration;

    whenReady(() => {
      try { el.currentTime = start; } catch (e) {}
      el.play().catch(() => {});

      // 주 감시: 매 프레임 현재 위치를 확인 (가장 정확)
      const watch = () => {
        if (el.currentTime >= stopAt || el.ended) {
          stop();
          if (endCb) endCb();
          return;
        }
        segRaf = requestAnimationFrame(watch);
      };
      segRaf = requestAnimationFrame(watch);

      // 보조 안전장치: 혹시 rAF가 멈춰도(탭 전환 등) 시간이 지나면 정지
      segTimer = setTimeout(() => {
        stop();
        if (endCb) endCb();
      }, duration * 1000 + 300);
    });
  }

  /** 일시정지 (구간 감시는 유지하지 않고 그냥 멈춥니다) */
  function pause() {
    seq++;                 // 기다리던 재생 요청도 취소
    clearSeg();
    try { el.pause(); } catch (e) {}
  }

  /** 멈춘 자리에서 이어서 재생 */
  function resume() {
    el.play().catch(() => {});
  }

  /** 재생 위치만 옮깁니다 (재생/정지 상태는 그대로) */
  function seek(sec) {
    whenReady(() => { try { el.currentTime = Math.max(0, sec); } catch (e) {} });
  }

  return {
    el,
    load,
    seek,
    play,
    playSegment,
    stop,
    pause,
    resume,
    get time() { return el.currentTime; },
    get duration() { return isFinite(el.duration) ? el.duration : 0; },
    get paused() { return el.paused; },
    get hasFile() { return !!el.src && !el.error; },
    get volume() { return el.volume; },
    set volume(v) { el.volume = Math.max(0, Math.min(1, v)); }
  };
})();

/* ---- 볼륨 설정은 브라우저에 저장해 다음에도 유지합니다 ---- */
const VOL_KEY = "f9typing_volume";

function initVolume() {
  const slider = $("#volume");
  const icon = $("#volIcon");
  const saved = parseInt(localStorage.getItem(VOL_KEY), 10);
  const start = isNaN(saved) ? 80 : saved;

  const apply = (v) => {
    Audio9.volume = v / 100;
    icon.textContent = v === 0 ? "🔇" : v < 45 ? "🔉" : "🔊";
    localStorage.setItem(VOL_KEY, String(v));
  };

  slider.value = start;
  apply(start);
  slider.addEventListener("input", () => apply(parseInt(slider.value, 10)));
}

/* ======================= 4. 모드 1 : 가사 타이핑 ======================= */

const Lyrics = (() => {
  // 현재 게임 상태
  let song = null;        // 지금 치고 있는 곡
  let lines = [];         // 가사 줄 배열
  let idx = 0;            // 지금 쳐야 할 줄 번호
  let target = "";        // 지금 줄의 목표 문자열
  let settled = 0;        // 조합이 끝나 "확정된" 글자 수
  let composing = false;  // 지금 한글 조합 중인지
  // 타이머는 "누적 시간 + 지금 구간"으로 관리합니다.
  // 이래야 일시정지했을 때 시간이 멈춥니다.
  let elapsedMs = 0;      // 지금까지 쌓인 시간
  let runSince = 0;       // 현재 구간 시작 시각 (0이면 시간이 안 흐르는 중)
  let hasStarted = false; // 첫 타이핑을 했는지
  let paused = false;     // 사용자가 직접 멈춘 상태
  let waiting = false;    // 노래가 나를 기다리느라 멈춘 상태
  let audioEnded = false; // 곡이 끝까지 재생됐는지
  let hasTimes = false;   // 이 곡의 가사에 쓸만한 시간 정보가 있는지
  let running = false;
  let hudRaf = null;
  let history = [];       // 되돌리기용 기록 (줄을 넘길 때마다 쌓임)
  // 브라우저는 조합이 끝날 때 compositionend 와 input 을 연달아 보냅니다.
  // 그래서 줄넘김이 두 번 실행되지 않도록 잠금 장치를 둡니다.
  let advancing = false;

  // 통계
  let stat = { typed: 0, wrong: 0, strokes: 0 };

  // "노래 맞춰주기" 켜짐 여부 (브라우저에 저장돼서 다음에도 유지됩니다)
  const AUTOWAIT_KEY = "f9typing_autowait";
  // 아직 공개하지 않은 기능이면 켜져 있어도 동작하지 않습니다
  const autoWaitOn = () => feature("autoWait") && localStorage.getItem(AUTOWAIT_KEY) !== "off";

  function initAutoWaitToggle() {
    if (!feature("autoWait")) return;   // 아직 공개 전이면 버튼을 켜지 않습니다
    const btn = $("#btnAutoWait");
    const paint = () => btn.classList.toggle("is-on", autoWaitOn());
    paint();
    btn.addEventListener("click", () => {
      localStorage.setItem(AUTOWAIT_KEY, autoWaitOn() ? "off" : "on");
      paint();
      if (!autoWaitOn()) setWaiting(false);   // 끄면 즉시 다시 재생
      input.focus();
    });
  }

  const elCur = $("#lineCurrent");
  const elPrev = $("#linePrev");
  const elNext = $("#lineNext");
  const elNext2 = $("#lineNext2");
  const input = $("#typeInput");

  /* ---- 곡별 최고 기록 (내 브라우저에 저장) ---- */
  const BEST_KEY = "f9typing_lyrics_best_";

  function loadBest(id) {
    try {
      const raw = localStorage.getItem(BEST_KEY + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveBest(id, rec) {
    try { localStorage.setItem(BEST_KEY + id, JSON.stringify(rec)); } catch (e) {}
  }

  /* ---- 곡 목록 그리기 ---- */
  function renderSongList() {
    const grid = $("#songGrid");
    const playable = orderedSongs().filter((s) => s.lyrics && s.lyrics.length > 0);

    if (playable.length === 0) {
      grid.innerHTML =
        '<div class="empty-note">가사가 등록된 곡이 없습니다.<br />' +
        "<code>data/songs.js</code> 의 <code>lyrics</code> 에 가사를 넣어주세요.</div>";
      return;
    }

    grid.innerHTML = "";
    playable.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "song-card";
      btn.innerHTML =
        '<div class="song-card__cover">' +
          '<div class="song-card__fallback"></div>' +
          '<span class="song-card__play">▶</span>' +
        "</div>" +
        '<div class="song-card__title"></div>' +
        '<div class="song-card__album"></div>' +
        '<div class="song-card__meta"></div>';

      const coverBox = btn.querySelector(".song-card__cover");
      const fallback = btn.querySelector(".song-card__fallback");
      fallback.textContent = s.title.slice(0, 2).toUpperCase();
      // 커버가 뜨기 전 회색 네모 대신 곡 대표색을 깔아둡니다
      if (s.color) coverBox.style.backgroundColor = s.color;

      // 커버 이미지가 있으면 얹고, 로드에 실패하면 대체 썸네일을 그대로 둡니다
      if (s.cover) {
        const img = makeCoverImg(s.cover);
        img.src = thumbOf(s.cover);
        coverBox.insertBefore(img, fallback.nextSibling);
      }

      btn.querySelector(".song-card__title").textContent = s.title;
      btn.querySelector(".song-card__album").textContent = s.album || "";
      const best = loadBest(s.id);
      btn.querySelector(".song-card__meta").textContent =
        best ? "내 최고 " + best.cpm + " CPM" : s.lyrics.length + "줄";
      btn.addEventListener("click", () => start(s));
      grid.appendChild(btn);
    });
  }

  /* ---- 게임 시작 ---- */
  function start(s) {
    song = s;
    lines = s.lyrics.slice().sort((a, b) => a.time - b.time);
    idx = 0;
    stat = { typed: 0, wrong: 0, strokes: 0 };
    elapsedMs = 0;
    runSince = 0;
    hasStarted = false;
    running = true;
    waiting = false;
    audioEnded = false;
    history = [];
    hideSkipToast();
    $("#waitBadge").hidden = true;

    // 가사에 쓸만한 시간 정보가 있어야 "기다려주기"가 동작합니다
    hasTimes = lines.length > 1 && lines.some((l, i) => i > 0 && l.time > 0);
    $("#btnAutoWait").disabled = !hasTimes;
    $("#btnAutoWait").title = hasTimes
      ? "켜두면 내 타자 속도에 맞춰 노래가 멈춰서 기다려줍니다"
      : "이 곡은 가사에 시간 정보가 없어서 쓸 수 없습니다";

    $("#playSongTitle").textContent = s.title;
    $("#noAudioBadge").hidden = true;

    // 앨범 커버 : 상단 썸네일 + 흐린 배경
    const cover = $("#playCover");
    cover.hidden = true;
    if (s.cover) {
      cover.onerror = () => { cover.hidden = true; };
      cover.onload = () => { cover.hidden = false; };
      cover.src = s.cover;
    }
    setStageBg(s.cover);

    showScreen("screen-lyrics");
    loadLine();

    // 오디오 준비 (없으면 배지만 띄우고 게임은 계속)
    Audio9.load(s.audio, () => { $("#noAudioBadge").hidden = false; });
    Audio9.play(0);
    setPaused(false);          // 오디오를 건 뒤에 재생 상태로 맞춥니다

    input.value = "";
    input.focus();
    tickHud();
  }

  /** 일시정지 흔적을 지웁니다 (게임을 끝내거나 나갈 때) */
  function resetPauseUi() {
    paused = false;
    waiting = false;
    audioEnded = false;
    input.disabled = false;
    $("#lyricStage").classList.remove("is-paused");
    $("#waitBadge").hidden = true;
    updatePlayButton();
  }

  /* 기다려주기 판정은 오디오 자체 이벤트로도 확인합니다.
     화면 갱신(rAF)은 탭이 가려지면 멈춰버리는데, timeupdate 는 계속 오기 때문에
     다른 창을 보고 있다가 돌아와도 노래가 엉뚱하게 앞서가 있지 않습니다. */
  Audio9.el.addEventListener("timeupdate", () => {
    if (running) checkAutoWait();
  });

  // 곡이 끝나면 재생 버튼이 "다시 재생(↺)" 으로 바뀝니다
  Audio9.el.addEventListener("ended", () => {
    if (!running) return;
    audioEnded = true;
    setWaiting(false);
    updatePlayButton();
  });

  /* ---- 타이머 도우미 ---- */

  /** 지금까지 흐른 시간(초) */
  function elapsedSec() {
    return (elapsedMs + (runSince ? performance.now() - runSince : 0)) / 1000;
  }
  function timerResume() { if (!runSince) runSince = performance.now(); }
  function timerPause() {
    if (runSince) { elapsedMs += performance.now() - runSince; runSince = 0; }
  }

  /** 지금 상태에 맞게 오디오를 틀거나 멈춥니다.
   *  - 내가 직접 멈췄거나(paused)
   *  - 노래가 나를 기다리는 중이면(waiting)  → 정지
   *  - 곡이 끝났으면 "다시 재생"을 눌러야 다시 틉니다 */
  function syncAudioPlayback() {
    if (!Audio9.hasFile) return;
    if (paused || waiting || audioEnded) { Audio9.pause(); return; }
    Audio9.resume();
  }

  /** 일시정지 켜기/끄기 — 오디오와 타이머와 입력을 함께 멈춥니다 */
  function setPaused(on) {
    paused = on;
    updatePlayButton();
    $("#lyricStage").classList.toggle("is-paused", on);
    input.disabled = on;

    if (on) timerPause();
    else {
      // 첫 타이핑 전에는 타이머를 굴리지 않습니다
      if (hasStarted) timerResume();
      input.focus();
    }
    syncAudioPlayback();
  }

  /** 재생 버튼 모양 : ❚❚ 재생중 / ▶ 멈춤 / ↺ 곡이 끝남 */
  function updatePlayButton() {
    const btn = $("#btnPlayPause");
    if (audioEnded) {
      btn.textContent = "↺";
      btn.title = "처음부터 다시 재생";
      btn.classList.add("is-paused");
    } else {
      btn.textContent = paused ? "▶" : "❚❚";
      btn.title = paused ? "다시 재생 (F2)" : "일시정지 (F2)";
      btn.classList.toggle("is-paused", paused);
    }
  }

  function togglePause() {
    if (!running) return;
    // 곡이 끝난 상태면 버튼이 "다시 재생" 역할을 합니다
    if (audioEnded) { replayFromStart(); return; }
    setPaused(!paused);
  }

  /** 곡을 처음부터 다시 틉니다 (타이핑 진행과 기록은 그대로) */
  function replayFromStart() {
    if (!Audio9.hasFile) return;
    audioEnded = false;
    setWaiting(false);
    if (paused) setPaused(false);   // 멈춰 있었다면 재생 상태로 되돌립니다
    Audio9.play(0);
    updatePlayButton();
    input.focus();
  }

  /* ---- 노래가 나를 기다려주기 ----
     내가 치고 있는 줄의 "다음 줄이 시작되는 시각"에 노래가 도착했는데
     아직 이 줄을 다 못 쳤으면, 노래를 멈추고 기다립니다.
     줄을 넘기는 순간 다시 재생돼서 가사와 노래가 계속 맞아떨어집니다. */

  function setWaiting(on) {
    if (waiting === on) return;
    waiting = on;
    $("#waitBadge").hidden = !on;
    syncAudioPlayback();
  }

  function checkAutoWait() {
    if (!autoWaitOn() || !hasTimes || paused || audioEnded || !Audio9.hasFile) return;
    const next = lines[idx + 1];
    if (!next) return;                       // 마지막 줄은 기다릴 필요가 없습니다
    if (!waiting && Audio9.time >= next.time) setWaiting(true);
  }

  /** 줄을 넘기면 기다림을 풀고 노래를 다시 흐르게 합니다.
   *  내가 노래보다 빠를 때는 아무것도 하지 않습니다.
   *  (노래를 억지로 앞으로 당기면 듣던 부분이 잘리니까요)  */
  function resyncAudioToLine() {
    setWaiting(false);
  }

  /* ---- 한 줄 불러오기 ---- */
  function loadLine() {
    advancing = false;
    if (idx >= lines.length) { finish(); return; }

    target = lines[idx].text;
    settled = 0;
    composing = false;
    input.value = "";
    // 브라우저가 직접 길이를 막아줍니다 (한글 조합 중에도 안 늘어남)
    input.maxLength = target.length;

    resyncAudioToLine();   // 노래 위치를 지금 줄에 맞춤

    elPrev.textContent = idx > 0 ? lines[idx - 1].text : "";
    elNext.textContent = lines[idx + 1] ? lines[idx + 1].text : "";
    elNext2.textContent = lines[idx + 2] ? lines[idx + 2].text : "";

    $("#playProgressText").textContent = (idx + 1) + " / " + lines.length;
    $("#playProgressBar").style.width = (idx / lines.length) * 100 + "%";

    render();
  }

  /** 현재 줄을 글자 칸으로 그립니다 (그리는 방식은 응원법과 공용) */
  function render() {
    renderTypingCells(elCur, target, input.value, composing);
  }

  /* ---- 입력 처리 : 통계 집계 + 자동 줄넘김 ---- */
  function onInput() {
    if (!running || paused) return;
    if (!hasStarted) { hasStarted = true; timerResume(); }   // 첫 타이핑에 타이머 시작

    capToLine();
    const val = input.value;
    const settledLen = composing ? Math.max(0, val.length - 1) : val.length;

    // 새로 확정된 글자만 통계에 반영 (백스페이스로 줄면 다시 셉니다)
    if (settledLen > settled) {
      for (let i = settled; i < settledLen; i++) {
        stat.typed++;
        stat.strokes += strokeCount(val[i]);
        if (!sameChar(val[i], target[i])) stat.wrong++;
      }
    }
    settled = settledLen;

    render();

    // 줄을 정확히 다 쳤으면 자동으로 다음 줄
    if (!composing && sameLine(val, target) && !advancing) {
      advancing = true;
      pushHistory();
      idx++;
      setTimeout(loadLine, 90);
    }
  }

  /** 입력이 줄 길이를 넘지 않게 잘라냅니다 (조합 중에도 적용) */
  function capToLine() {
    if (input.value.length > target.length) {
      input.value = input.value.slice(0, target.length);
    }
  }

  /* ---- 이전 줄로 되돌리기 ----
     실수로 Enter 를 눌러 줄을 건너뛰어도 되살릴 수 있게,
     줄을 넘길 때마다 그 순간의 상태를 저장해 둡니다.
     줄 번호뿐 아니라 "치던 글자"와 "정확도·타수 기록"까지 함께 되돌려야
     되돌린 줄을 다시 칠 때 기록이 두 번 세어지지 않습니다. */

  const HISTORY_MAX = 60;

  function pushHistory() {
    history.push({
      idx: idx,
      value: input.value,
      settled: settled,
      stat: { typed: stat.typed, wrong: stat.wrong, strokes: stat.strokes }
    });
    if (history.length > HISTORY_MAX) history.shift();
  }

  /** 한 줄 뒤로. 되돌릴 게 없으면 false 를 돌려줍니다. */
  function undoLine() {
    if (!running || paused || history.length === 0) return false;

    const h = history.pop();
    advancing = true;              // loadLine 이 다시 false 로 돌려놓습니다
    idx = h.idx;
    stat = h.stat;

    loadLine();                    // 목표 줄·미리보기·진행률을 되돌린 줄로 맞춤

    // loadLine 이 입력창을 비우므로, 치던 내용을 다시 넣어줍니다
    input.value = h.value;
    settled = h.settled;
    render();

    // 노래도 그 줄 시작으로 되감습니다
    if (hasTimes && Audio9.hasFile && !audioEnded && lines[idx]) {
      Audio9.seek(lines[idx].time);
    }

    hideSkipToast();
    input.focus();
    return true;
  }

  /* ---- "줄을 건너뛰었어요" 안내 ---- */
  let toastTimer = null;

  function showSkipToast() {
    const el = $("#skipToast");
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideSkipToast, 4500);
  }

  function hideSkipToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    $("#skipToast").hidden = true;
  }

  /** 다음 줄로 넘기기 (Enter 로 건너뛸 때) */
  function goNextLine() {
    if (advancing) return;
    // 줄을 덜 친 채 넘어가는 경우에만 되돌리는 방법을 알려줍니다
    const skipped = input.value.length < target.length;
    advancing = true;
    pushHistory();
    idx++;
    loadLine();
    if (skipped) showSkipToast();
  }

  /* ---- 결과 계산 ---- */
  function finish() {
    running = false;
    timerPause();
    Audio9.stop();
    resetPauseUi();
    hideSkipToast();
    history = [];
    if (hudRaf) cancelAnimationFrame(hudRaf);

    const sec = elapsedSec();
    const min = Math.max(sec / 60, 1 / 60);
    const acc = stat.typed ? Math.round(((stat.typed - stat.wrong) / stat.typed) * 100) : 100;

    const cpm = Math.round(stat.strokes / min);
    $("#resultSongTitle").textContent = song.title;
    $("#rsCpm").textContent = cpm;
    $("#rsAcc").textContent = acc + "%";
    $("#rsTime").textContent = fmtTime(sec);
    $("#rsWpm").textContent = Math.round((stat.typed / 5) / min);

    // 곡별 최고 기록 (타수가 더 높으면 갱신)
    const prev = loadBest(song.id);
    const isBest = stat.typed >= 30 && (!prev || cpm > prev.cpm);
    if (isBest) saveBest(song.id, { cpm: cpm, acc: acc, sec: Math.round(sec) });

    const shown = isBest ? { cpm: cpm, acc: acc } : prev;
    $("#rsBest").textContent = shown ? shown.cpm : "—";
    $("#rsBestSub").textContent = shown ? "정확도 " + shown.acc + "%" : "Best";
    $("#lyricsBestBadge").hidden = !(isBest && prev);   // 첫 판은 신기록 표시 안 함

    Share.set({
      modeLabel: "가사 타이핑",
      title: song.title,
      sub: song.album || "",
      color: song.color || "#0f9d76",
      cover: song.cover || "",
      big: String(cpm),
      bigLabel: "CPM  (분당 타수)",
      stats: [
        { label: "정확도", value: acc + "%" },
        { label: "소요 시간", value: fmtTime(sec) },
        { label: "내 최고", value: (shown ? shown.cpm : cpm) + "" }
      ],
      shareText: "fromis_9 «" + song.title + "» 가사 타이핑 " + cpm + " CPM / 정확도 " + acc + "%\n" +
                 "https://typingfromis9.kr\n#fromis_9 #프로미스나인 #플로버"
    });

    Ranking.offer({
      mode: "lyrics",
      songId: song.id,
      cpm: stat.strokes / min,
      accuracy: acc,
      seconds: sec,
      typed: stat.typed
    });

    pickResultArt("#artLyrics");
    showScreen("screen-lyrics-result");
  }

  /* ---- 상단 실시간 지표 ---- */
  function tickHud() {
    if (!running) return;
    const sec = elapsedSec();
    const min = Math.max(sec / 60, 1 / 60);
    const acc = stat.typed ? Math.round(((stat.typed - stat.wrong) / stat.typed) * 100) : 100;

    $("#hudAcc").textContent = acc + "%";
    $("#hudCpm").textContent = hasStarted ? Math.round(stat.strokes / min) : 0;
    $("#hudTime").textContent = fmtTime(sec);

    // 오디오 재생 위치 표시
    $("#audioNow").textContent = fmtMmSs(Audio9.time);
    $("#audioTotal").textContent = "/ " + fmtMmSs(Audio9.duration);

    checkAutoWait();   // 노래가 내 줄을 지나쳤는지 확인

    hudRaf = requestAnimationFrame(tickHud);
  }

  function quit() {
    running = false;
    timerPause();
    Audio9.stop();
    resetPauseUi();
    hideSkipToast();
    history = [];
    setStageBg("");
    if (hudRaf) cancelAnimationFrame(hudRaf);
  }

  /* ---- 이벤트 연결 ---- */
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionupdate", () => { composing = true; capToLine(); render(); });
  input.addEventListener("compositionend", () => {
    composing = false;
    onInput();   // 조합이 끝난 시점에 최종 판정
  });
  input.addEventListener("input", (e) => {
    capToLine();   // 조합 중이든 아니든 줄 길이를 절대 넘지 않게 합니다
    // 조합 중(isComposing)에는 최종 판정을 미루고 화면만 갱신합니다
    if (e.isComposing || composing) { render(); return; }
    onInput();
  });

  /* 줄 끝을 넘어가는 입력은 키를 누른 즉시 막습니다.
     (한글 조합 중에는 브라우저의 maxLength 가 안 먹는 경우가 있어서
      keydown 단계에서 한 번 더 막아줍니다) */
  input.addEventListener("keydown", (e) => {
    if (!running || paused) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // 글자를 새로 넣는 키인지 (Backspace·화살표·Enter 등은 통과)
    const isTyping = e.key.length === 1 || e.key === "Process" || e.key === "Unidentified";
    if (!isTyping) return;
    // 이미 줄을 다 쳤고, 지금 조합 중인 글자도 없으면 더 못 치게 막습니다
    if (!composing && input.value.length >= target.length) e.preventDefault();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      goNextLine();
    }

    // Backspace : 입력창이 비어 있으면 이전 줄로 돌아갑니다.
    // (글자가 남아 있으면 평소처럼 한 글자씩 지웁니다)
    if (e.key === "Backspace" && !e.isComposing && input.value.length === 0) {
      if (history.length > 0) {
        e.preventDefault();
        undoLine();
        return;
      }
    }

    // 스페이스바 : 줄 끝에서는 "다음 줄로" 역할을 합니다.
    // (다 치고 나면 자연스럽게 스페이스를 누르게 되니까요)
    if (e.key === " " && !e.isComposing) {
      // 1) 줄을 끝까지 쳤으면 → 다음 줄로. 틀린 글자가 있어도 넘어갑니다(정확도만 깎임)
      if (input.value.length >= target.length) {
        e.preventDefault();
        goNextLine();
        return;
      }
      // 2) 줄 맨 앞에서 누른 스페이스는 무시합니다.
      //    (앞줄을 다 치고 넘어온 직후 눌린 것이라 오타로 세면 억울하니까요)
      if (input.value.length === 0 && target[0] !== " ") {
        e.preventDefault();
        return;
      }
      // 3) 그 밖에는 평범한 띄어쓰기로 입력됩니다.
    }

    // 게임 중 Esc = 그만두기
    if (e.key === "Escape") { quit(); showScreen("screen-select"); }
    // F2 = 일시정지 / 다시 재생
    if (e.key === "F2") { e.preventDefault(); togglePause(); }
  });

  // 화면 아무 데나 눌러도 입력창에 포커스가 돌아오게
  $("#screen-lyrics").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    setTimeout(() => input.focus(), 0);
  });

  // 안내 팝업의 "되돌리기" 버튼
  $("#btnUndoLine").addEventListener("click", () => undoLine());

  return { renderSongList, start, quit, finish, togglePause, undoLine, initAutoWaitToggle, getSong: () => song };
})();

/* ======================= 5. 모드 2 : 인트로 퀴즈 ======================= */

const Quiz = (() => {
  let queue = [];       // 셔플된 출제 목록
  let qi = 0;           // 지금 문제 번호
  let wrong = 0;
  let passed = 0;
  let wrongStreak = 0;  // 현재 문제에서 연속 오답 횟수 (힌트 표시용)
  let startedAt = 0;
  let running = false;
  let raf = null;

  const input = $("#quizInput");
  const status = $("#quizStatus");
  const wave = $("#quizWave");
  const hint = $("#quizHint");

  const BEST_KEY = "f9typing_quiz_best";

  /** 저장된 최고 기록 읽기 (곡 수별로 따로 저장) */
  function loadBest(count) {
    try {
      const raw = localStorage.getItem(BEST_KEY + "_" + count);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveBest(count, sec) {
    try {
      localStorage.setItem(
        BEST_KEY + "_" + count,
        JSON.stringify({ sec: sec, date: new Date().toISOString().slice(0, 10) })
      );
    } catch (e) {}
  }

  /* ---- 시작 안내 화면 ---- */
  function showIntro() {
    // 정답 공개 때 커버가 깜빡이지 않도록 여기서 미리 받아둡니다
    preloadCovers();
    const pool = SONGS.filter((s) => s.intro);
    $("#qiCount").textContent = pool.length;
    const best = loadBest(pool.length);
    $("#qiBest").textContent = best ? fmtClock(best.sec) : "--";
    showScreen("screen-quiz-intro");
  }

  /* ---- 스피드런 시작 ---- */
  function start() {
    queue = shuffle(SONGS.filter((s) => s.intro));
    qi = 0;
    wrong = 0;
    passed = 0;
    running = true;
    startedAt = performance.now();

    $("#quizTotal").textContent = queue.length;
    showScreen("screen-quiz");
    nextQuestion();
    tick();
  }

  /* ---- 문제 하나 출제 ---- */
  function nextQuestion() {
    if (qi >= queue.length) { finish(); return; }

    const s = queue[qi];
    wrongStreak = 0;
    hideReveal();

    $("#quizNo").textContent = qi + 1;
    $("#quizWrong").textContent = wrong;
    $("#quizPass").textContent = passed;
    $("#quizProgressBar").style.width = (qi / queue.length) * 100 + "%";
    $("#quizNoAudioBadge").hidden = true;

    input.value = "";
    input.disabled = false;
    input.focus();
    hint.textContent = "";
    status.className = "quiz-status";

    playIntro(s);
  }

  /* ---- 정답 공개 : 앨범 커버를 크게 보여줍니다 ---- */
  function showReveal(s, correct) {
    const box = $("#quizReveal");
    const img = $("#revealCover");
    const fallback = $("#revealFallback");

    $("#revealVerdict").textContent = correct ? "정답!" : "정답은";
    $("#revealVerdict").classList.toggle("is-pass", !correct);
    $("#revealTitle").textContent = s.title;
    $("#revealAlbum").textContent = s.album || "";

    // 커버가 없거나 못 불러오면 대표색 + 제목 앞 두 글자로 대체
    fallback.textContent = s.title.slice(0, 2).toUpperCase();
    fallback.style.backgroundColor = s.color || "";

    if (isCoverReady(s.cover)) {
      // 이미 받아둔 커버 → 깜빡임 없이 바로 표시
      img.src = s.cover;
      img.hidden = false;
      fallback.hidden = true;
    } else if (s.cover) {
      // 아직 안 받아졌으면 대체 이미지를 먼저 두고, 다 받아지면 바꿔치기
      img.hidden = true;
      fallback.hidden = false;
      img.onload = () => { img.hidden = false; fallback.hidden = true; };
      img.onerror = () => { img.hidden = true; };
      img.src = s.cover;
    } else {
      img.hidden = true;
      fallback.hidden = false;
    }

    box.hidden = false;
    // 다음 프레임에 클래스를 붙여야 등장 애니메이션이 재생됩니다
    requestAnimationFrame(() => box.classList.add("is-on"));
  }

  function hideReveal() {
    const box = $("#quizReveal");
    box.classList.remove("is-on");
    box.hidden = true;
  }

  /* ---- 인트로 구간 재생 ---- */
  function playIntro(s) {
    status.textContent = "인트로 재생 중…";
    wave.classList.add("is-playing");

    const done = () => {
      wave.classList.remove("is-playing");
      if (running) status.textContent = "제목을 입력하고 Enter";
    };

    const noAudio = () => {
      wave.classList.remove("is-playing");
      $("#quizNoAudioBadge").hidden = false;
      status.textContent = "오디오 없이 진행 — 제목을 입력하세요";
    };

    /* 퀴즈는 도입부 몇 초만 들려주면 되는데, 전체 mp3 를 걸면
       브라우저가 곡 하나를 통째로(4MB) 받아버립니다.
       그래서 audio/intro/ 에 미리 잘라둔 짧은 파일을 씁니다. (곡당 약 100KB)
       잘라둔 파일이 없는 곡은 예전처럼 전체 mp3 에서 구간 재생합니다. */
    const clip = "audio/intro/" + s.id + ".mp3";

    Audio9.load(clip, () => {
      // 잘라둔 인트로가 없으면 전체 mp3 로 대체
      Audio9.load(s.audio, noAudio);
      Audio9.playSegment(s.intro.start, s.intro.duration, done);
    });

    // 잘라둔 파일은 이미 도입부부터 시작하므로 0초부터 재생합니다
    Audio9.playSegment(0, s.intro.duration, done);
  }

  /* ---- 정답 확인 ---- */
  function check() {
    if (!running) return;
    const typed = looseKey(input.value);
    if (!typed) return;

    const s = queue[qi];
    // 제목 + 별칭을 전부 "느슨한 열쇠"로 바꿔서 비교합니다
    const answers = [s.title].concat(s.titleAliases || []).map(looseKey);

    if (answers.includes(typed)) {
      // 정답 → 앨범 커버를 보여줍니다
      Audio9.stop();
      wave.classList.remove("is-playing");
      status.textContent = "";
      input.disabled = true;
      showReveal(s, true);
      qi++;
      setTimeout(nextQuestion, 1600);
    } else {
      // 오답 → 재시도
      wrong++;
      wrongStreak++;
      $("#quizWrong").textContent = wrong;
      status.textContent = "땡! 다시 들어보세요";
      status.className = "quiz-status is-ng";
      input.classList.remove("is-shake");
      void input.offsetWidth;          // 애니메이션 재시작 트릭
      input.classList.add("is-shake");
      input.select();

      // 2번 이상 틀리면 힌트 (첫 글자만 보여줌)
      if (wrongStreak >= 2) hint.textContent = makeHint(s.title);
    }
  }

  /** "Stay This Way" → "S••• •••• •••" */
  function makeHint(title) {
    return title
      .split("")
      .map((c, i) => (i === 0 || c === " " ? c : "•"))
      .join("");
  }

  /* ---- 패스 ---- */
  function pass() {
    if (!running) return;
    Audio9.stop();
    wave.classList.remove("is-playing");
    passed++;
    status.textContent = "";
    status.className = "quiz-status";
    input.disabled = true;
    showReveal(queue[qi], false);   // 패스해도 정답 커버를 보여줍니다
    qi++;
    setTimeout(nextQuestion, 1900);
  }

  /* ---- 완주 ---- */
  function finish() {
    running = false;
    Audio9.stop();
    hideReveal();
    if (raf) cancelAnimationFrame(raf);

    const sec = (performance.now() - startedAt) / 1000;
    const count = queue.length;
    const prev = loadBest(count);
    const isNewBest = !prev || sec < prev.sec;
    if (isNewBest) saveBest(count, sec);

    $("#quizResultTitle").textContent = isNewBest ? "신기록 달성!" : "완주했어요";
    $("#qrTime").textContent = fmtClock(sec);
    $("#qrCount").textContent = count;
    $("#qrWrong").textContent = wrong;
    $("#qrPass").textContent = passed;
    $("#qrBest").textContent = fmtClock(isNewBest ? sec : prev.sec);

    Share.set({
      modeLabel: "인트로 퀴즈 스피드런",
      title: fmtClock(sec),
      sub: count + "곡 완주",
      color: "#0f9d76",
      cover: "images/logo.png",
      big: fmtClock(sec),
      bigLabel: "전체 완주 시간",
      stats: [
        { label: "문제 수", value: String(count) },
        { label: "틀린 횟수", value: String(wrong) },
        { label: "패스", value: String(passed) }
      ],
      shareText: "fromis_9 인트로 퀴즈 " + count + "곡을 " + fmtClock(sec) + " 만에 완주했어요! (오답 " + wrong + "회)\n" +
                 "https://typingfromis9.kr\n#fromis_9 #프로미스나인 #플로버"
    });

    Ranking.offer({
      mode: "quiz",
      seconds: sec,
      count: count,
      misses: wrong,
      passed: passed
    });

    pickResultArt("#artQuiz");
    showScreen("screen-quiz-result");
  }

  /* ---- 실시간 타이머 ---- */
  function tick() {
    if (!running) return;
    const sec = (performance.now() - startedAt) / 1000;
    $("#hudTime").textContent = fmtClock(sec);
    $("#hudAcc").textContent = wrong + "회";
    $("#hudCpm").textContent = qi + "/" + queue.length;
    raf = requestAnimationFrame(tick);
  }

  function quit() {
    running = false;
    Audio9.stop();
    wave.classList.remove("is-playing");
    hideReveal();
    if (raf) cancelAnimationFrame(raf);
  }

  /* ---- 이벤트 연결 ---- */
  input.addEventListener("keydown", (e) => {
    // 한글 조합 중에 눌린 Enter 는 "글자 확정"이므로 무시해야 합니다
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      check();
    }
    if (e.key === "Escape") { quit(); showScreen("screen-home"); }
  });

  $("#btnReplay").addEventListener("click", () => {
    if (!running) return;
    playIntro(queue[qi]);
    input.focus();
  });
  $("#btnPass").addEventListener("click", pass);

  $("#screen-quiz").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    setTimeout(() => input.focus(), 0);
  });

  return { showIntro, start, quit };
})();

/* ======================= 4-b. 모드 3 : 응원법 =======================
   노래는 처음부터 끝까지 멈추지 않고 흐릅니다.
   응원 구간이 다가오면 화면에 뜨고, 정해진 시간 안에 정확히 쳐야 성공입니다.
   (가사 타이핑처럼 기다려주지 않습니다 — 응원은 순간을 놓치면 끝이니까요) */

const Chant = (() => {
  // 구간이 몇 초 전에 미리 뜰지 / 응원 시각이 지난 뒤 몇 초까지 인정할지
  const LEAD = 1.8;
  const GRACE = 3.0;
  const GAP = 0.15;        // 다음 구간과 겹치지 않게 두는 최소 간격

  let song = null;
  let list = [];           // 이 곡의 응원 구간들
  let idx = 0;             // 지금 노리고 있는 구간
  let resolved = false;    // 지금 구간이 이미 판정됐는지
  let live = false;        // 지금 구간이 화면에 떠 있는지
  let running = false;
  let raf = null;
  let composing = false;
  let stat = { ok: 0, miss: 0 };
  let missed = [];
  let verdictTimer = null;
  let words = [];          // 이 곡의 가사 (읽기용)
  let wordIdx = -1;        // 지금 흐르고 있는 가사 줄

  const input = $("#chantInput");
  const elLine = $("#chantLine");

  /* ---- 구간의 시작·마감 시각 ----
     앞뒤 구간과 겹치지 않도록 자동으로 좁힙니다.
     (DM 처럼 2초 간격으로 붙어 있는 구간이 있어서 꼭 필요합니다) */
  function deadlineOf(i) {
    const own = list[i].time + GRACE;
    const next = list[i + 1] ? list[i + 1].time - GAP : Infinity;
    return Math.min(own, next);
  }
  function showAtOf(i) {
    const own = list[i].time - LEAD;
    const prev = i > 0 ? deadlineOf(i - 1) : 0;
    return Math.max(own, prev, 0);
  }

  /* ---- 곡 목록 ---- */
  function renderSongList() {
    const grid = $("#chantGrid");
    const playable = orderedSongs().filter((s) => s.chants && s.chants.length > 0);

    if (playable.length === 0) {
      grid.innerHTML =
        '<div class="empty-note">응원법이 등록된 곡이 없습니다.<br />' +
        "<code>data/songs.js</code> 의 <code>chants</code> 에 넣어주세요.</div>";
      return;
    }

    grid.innerHTML = "";
    playable.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "song-card";
      btn.innerHTML =
        '<div class="song-card__cover">' +
          '<div class="song-card__fallback"></div>' +
          '<span class="song-card__play">▶</span>' +
        "</div>" +
        '<div class="song-card__title"></div>' +
        '<div class="song-card__album"></div>' +
        '<div class="song-card__meta"></div>';

      const coverBox = btn.querySelector(".song-card__cover");
      const fallback = btn.querySelector(".song-card__fallback");
      fallback.textContent = s.title.slice(0, 2).toUpperCase();
      if (s.color) coverBox.style.backgroundColor = s.color;
      if (s.cover) {
        const img = makeCoverImg(s.cover);
        img.src = thumbOf(s.cover);
        coverBox.insertBefore(img, fallback.nextSibling);
      }

      const best = loadBest(s.id);
      btn.querySelector(".song-card__title").textContent = s.title;
      btn.querySelector(".song-card__album").textContent = s.album || "";
      btn.querySelector(".song-card__meta").textContent =
        best ? "내 최고 " + best.rate + "%" : s.chants.length + "구간";
      btn.addEventListener("click", () => start(s));
      grid.appendChild(btn);
    });
  }

  /* ---- 최고 기록 ---- */
  const BEST_KEY = "f9typing_chant_best_";
  function loadBest(id) {
    try {
      const raw = localStorage.getItem(BEST_KEY + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveBest(id, rec) {
    try { localStorage.setItem(BEST_KEY + id, JSON.stringify(rec)); } catch (e) {}
  }

  /* ---- 시작 ---- */
  function start(s) {
    song = s;
    list = s.chants.slice().sort((a, b) => a.time - b.time);
    words = (s.lyrics || []).slice().sort((a, b) => a.time - b.time);
    wordIdx = -1;
    idx = 0;
    resolved = false;
    live = false;
    running = true;
    composing = false;
    stat = { ok: 0, miss: 0 };
    missed = [];

    $("#chantSongTitle").textContent = s.title;
    $("#chantTotal").textContent = list.length;
    $("#chantOk").textContent = "0";
    $("#chantMiss").textContent = "0";
    $("#chantNoAudio").hidden = true;
    $("#chantVerdict").textContent = "";
    $("#chantVerdict").className = "chant-verdict";
    $("#chantLyricPrev").textContent = "";
    $("#chantLyricNow").textContent = "";
    $("#chantLyricNext").textContent = words[0] ? words[0].text : "";

    const cover = $("#chantCover");
    cover.hidden = true;
    if (s.cover) {
      cover.onerror = () => { cover.hidden = true; };
      cover.onload = () => { cover.hidden = false; };
      cover.src = thumbOf(s.cover);
    }
    setStageBg(s.cover);

    showScreen("screen-chant");
    setLive(false);

    Audio9.load(s.audio, () => { $("#chantNoAudio").hidden = false; });
    Audio9.play(0);

    input.value = "";
    input.disabled = false;
    input.focus();
    tick();
  }

  /* ---- 화면 전환 (대기 ↔ 구간) ---- */
  function setLive(on) {
    live = on;
    $("#chantLive").hidden = !on;
    $("#chantIdle").hidden = on;
    if (on) {
      input.value = "";
      input.maxLength = list[idx].text.length;
      renderTypingCells(elLine, list[idx].text, "", false);
      input.focus();
    }
    paintUpcoming();
  }

  function showVerdict(text, ok) {
    const el = $("#chantVerdict");
    el.textContent = text;
    el.className = "chant-verdict " + (ok ? "is-ok" : "is-miss");
    if (verdictTimer) clearTimeout(verdictTimer);
    verdictTimer = setTimeout(() => {
      el.textContent = "";
      el.className = "chant-verdict";
    }, 1200);
  }

  /* ---- 판정 ---- */
  function hit() {
    if (resolved) return;
    resolved = true;
    stat.ok++;
    $("#chantOk").textContent = stat.ok;
    showVerdict("성공!", true);
    advance();
  }

  function miss() {
    if (resolved) return;
    resolved = true;
    stat.miss++;
    $("#chantMiss").textContent = stat.miss;
    missed.push(list[idx]);
    showVerdict("놓쳤어요", false);
    advance();
  }

  function advance() {
    idx++;
    resolved = false;
    setLive(false);
    input.value = "";
    if (idx >= list.length) finish();
  }

  /* ---- 매 순간 확인 ----
     화면 갱신(rAF)은 창이 가려지면 멈추므로,
     오디오의 timeupdate 로도 똑같이 확인합니다. */
  function step() {
    if (!running) return;
    const now = Audio9.time;

    // 마감을 지난 구간은 놓친 것으로 처리 (건너뛰기로 여러 개가 밀렸을 수도 있음)
    let guard = 0;
    while (running && idx < list.length && now > deadlineOf(idx) && guard++ < 200) {
      miss();
    }
    // 이제 나올 구간이 시작할 때가 됐으면 띄웁니다
    if (running && idx < list.length && !live && now >= showAtOf(idx)) {
      setLive(true);
    }
    paint(now);
  }

  function tick() {
    if (!running) return;
    step();
    raf = requestAnimationFrame(tick);
  }

  /* ---- ① 가사 흐르기 ----
     지금 노래가 어느 줄을 부르고 있는지 보여줍니다. 치는 건 아닙니다.
     현재 줄은 왼쪽부터 초록으로 채워집니다(노래방 효과). */
  function paintLyrics(now) {
    if (words.length === 0) return;

    // 지금 줄 찾기 (앞뒤로 움직여도 맞게)
    let i = wordIdx;
    while (i + 1 < words.length && words[i + 1].time <= now) i++;
    while (i >= 0 && words[i].time > now) i--;

    if (i !== wordIdx) {
      wordIdx = i;
      $("#chantLyricPrev").textContent = i > 0 ? words[i - 1].text : "";
      $("#chantLyricNow").textContent = i >= 0 ? words[i].text : "";
      $("#chantLyricNext").textContent = words[i + 1] ? words[i + 1].text : "";
    }

    // 이 줄이 어디까지 왔는지 (다음 줄 시작까지를 100% 로 봅니다)
    let pct = 0;
    if (i >= 0) {
      const from = words[i].time;
      const to = words[i + 1] ? words[i + 1].time : from + 4;
      pct = Math.max(0, Math.min(100, ((now - from) / Math.max(0.01, to - from)) * 100));
    }
    $("#chantLyricNow").style.setProperty("--sung", pct.toFixed(1) + "%");
  }

  /* ---- ③ 앞으로 올 응원 두 개 ---- */
  function paintUpcoming() {
    const box = $("#chantUpcoming");
    const next = list.slice(idx + (live ? 1 : 0), idx + (live ? 3 : 2));
    if (next.length === 0) { box.hidden = true; return; }

    const frag = document.createDocumentFragment();
    const label = document.createElement("span");
    label.className = "chant-up__label";
    label.textContent = "다음";
    frag.appendChild(label);

    next.forEach((c) => {
      const el = document.createElement("span");
      el.className = "chant-up";
      const t = document.createElement("i");
      t.textContent = fmtMmSs(c.time);
      const b = document.createElement("b");
      b.textContent = c.text;
      el.append(t, b);
      frag.appendChild(el);
    });
    box.replaceChildren(frag);
    box.hidden = false;
  }

  function paint(now) {
    paintLyrics(now);
    if (idx >= list.length) return;

    $("#chantProgressBar").style.width = (idx / list.length) * 100 + "%";

    if (live) {
      // 남은 시간 막대
      const from = showAtOf(idx);
      const to = deadlineOf(idx);
      const left = Math.max(0, Math.min(1, (to - now) / Math.max(0.01, to - from)));
      const bar = $("#chantTimerBar");
      bar.style.transform = "scaleX(" + left + ")";
      bar.classList.toggle("is-hurry", left < 0.3);
    } else {
      const wait = Math.max(0, showAtOf(idx) - now);
      $("#chantCountdown").textContent = wait < 10 ? wait.toFixed(1) : Math.round(wait);
    }
  }

  /* ---- 결과 ---- */
  function finish() {
    running = false;
    Audio9.stop();
    if (raf) cancelAnimationFrame(raf);
    if (verdictTimer) clearTimeout(verdictTimer);

    const total = list.length;
    const rate = total ? Math.round((stat.ok / total) * 100) : 0;

    $("#chantResultTitle").textContent = song.title;
    $("#chantRate").textContent = rate + "%";
    $("#crOk").textContent = stat.ok;
    $("#crMiss").textContent = stat.miss;
    $("#crTotal").textContent = total;

    const prev = loadBest(song.id);
    const isBest = !prev || rate > prev.rate;
    if (isBest) saveBest(song.id, { rate: rate, ok: stat.ok, total: total });
    $("#crBest").textContent = (isBest ? rate : prev.rate) + "%";

    // 놓친 구간 목록
    const box = $("#missList");
    if (missed.length) {
      const body = $("#missBody");
      body.replaceChildren();
      missed.forEach((m) => {
        const chip = document.createElement("span");
        chip.className = "miss-chip";
        const t = document.createElement("i");
        t.textContent = fmtMmSs(m.time);
        chip.append(t, document.createTextNode(m.text));
        body.appendChild(chip);
      });
      box.hidden = false;
    } else {
      box.hidden = true;
    }

    Share.set({
      modeLabel: "응원법 타이핑",
      title: song.title,
      sub: song.album || "",
      color: song.color || "#0f9d76",
      cover: song.cover || "",
      big: rate + "%",
      bigLabel: "응원 성공률",
      stats: [
        { label: "성공", value: String(stat.ok) },
        { label: "놓침", value: String(stat.miss) },
        { label: "전체 구간", value: String(total) }
      ],
      shareText: "fromis_9 «" + song.title + "» 응원법 " + rate + "% (" + stat.ok + "/" + total + ")\n" +
                 "https://typingfromis9.kr\n#fromis_9 #프로미스나인 #플로버"
    });

    Ranking.offer({
      mode: "chant",
      songId: song.id,
      rate: rate,
      hits: stat.ok,
      total: total,
      misses: stat.miss
    });

    pickResultArt("#artChant");
    showScreen("screen-chant-result");
  }

  function quit() {
    running = false;
    Audio9.stop();
    setStageBg("");
    if (raf) cancelAnimationFrame(raf);
    if (verdictTimer) clearTimeout(verdictTimer);
  }

  /* ---- 입력 ---- */
  function onInput() {
    if (!running || !live) return;
    if (input.value.length > list[idx].text.length) {
      input.value = input.value.slice(0, list[idx].text.length);
    }
    renderTypingCells(elLine, list[idx].text, input.value, composing);
    if (!composing && sameLine(input.value, list[idx].text)) hit();
  }

  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionupdate", () => {
    composing = true;
    if (live) renderTypingCells(elLine, list[idx].text, input.value, true);
  });
  input.addEventListener("compositionend", () => { composing = false; onInput(); });
  input.addEventListener("input", (e) => {
    if (e.isComposing || composing) {
      if (live) renderTypingCells(elLine, list[idx].text, input.value, true);
      return;
    }
    onInput();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
    if (e.key === "Escape") { quit(); showScreen("screen-chant-select"); }
  });

  // 화면 아무 데나 눌러도 입력창에 포커스가 돌아오게
  $("#screen-chant").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    setTimeout(() => input.focus(), 0);
  });

  // 화면이 가려지면 rAF 가 멈추므로 오디오 이벤트로도 확인합니다
  Audio9.el.addEventListener("timeupdate", () => { if (running) step(); });

  return { renderSongList, start, quit, getSong: () => song };
})();

/* ======================= 5-a. 결과 공유 =======================
   결과를 정사각형 카드 이미지로 그려서 저장하거나 SNS 로 보냅니다.
   외부 라이브러리 없이 캔버스에 직접 그립니다. */

const Share = (() => {
  const SIZE = 1080;                 // SNS 에 올리기 좋은 정사각형
  let last = null;                   // 마지막 결과 (카드 그릴 재료)

  const FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';

  /** 결과 화면이 뜰 때 재료를 넣어둡니다 */
  function set(data) { last = data; }

  /** 둥근 사각형 경로 */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 결과 카드를 그려서 canvas 를 돌려줍니다 */
  async function draw() {
    if (!last) return null;
    try { await document.fonts.ready; } catch (e) {}

    const c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext("2d");

    // 배경 : 곡 대표색에서 흰색으로 흐르는 그라데이션
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, last.color || "#0f9d76");
    g.addColorStop(1, "#0d1512");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 살짝 어둡게 덮어 글씨가 잘 보이게
    ctx.fillStyle = "rgba(8,12,10,.5)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 앨범 커버
    if (last.cover) {
      const img = await loadImg(last.cover).catch(() => null);
      if (img) {
        ctx.save();
        roundRect(ctx, 110, 150, 260, 260, 26);
        ctx.clip();
        ctx.drawImage(img, 110, 150, 260, 260);
        ctx.restore();
      }
    }

    ctx.textBaseline = "alphabetic";

    // 모드 이름
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.font = "600 30px " + FONT;
    ctx.fillText(last.modeLabel, 410, 212);

    // 곡 제목 / 제목 자리
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 62px " + FONT;
    fitText(ctx, last.title, 410, 292, 560, 62);

    if (last.sub) {
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = "500 28px " + FONT;
      ctx.fillText(last.sub, 410, 344);
    }

    // 가장 큰 수치
    ctx.fillStyle = "#6ef0be";
    ctx.font = "800 168px " + FONT;
    ctx.fillText(last.big, 110, 610);

    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.font = "600 34px " + FONT;
    ctx.fillText(last.bigLabel, 112, 660);

    // 보조 수치 3개
    const boxW = 280, boxH = 150, gap = 20, startX = 110, y = 720;
    last.stats.slice(0, 3).forEach((s, i) => {
      const x = startX + i * (boxW + gap);
      ctx.fillStyle = "rgba(255,255,255,.09)";
      roundRect(ctx, x, y, boxW, boxH, 22);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.font = "600 26px " + FONT;
      ctx.fillText(s.label, x + 26, y + 54);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 54px " + FONT;
      ctx.fillText(s.value, x + 26, y + 116);
    });

    // 아래 사이트 이름 + 주소 (공유받은 사람이 바로 찾아올 수 있게)
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.font = "600 26px " + FONT;
    ctx.fillText("fromis_9 TYPING  ·  플로버를 위한 타이핑 게임", 110, 934);

    ctx.fillStyle = "#6ef0be";
    ctx.font = "800 40px " + FONT;
    ctx.fillText("typingfromis9.kr", 110, 990);

    return c;
  }

  function loadImg(src) {
    return new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = no;
      im.src = src;
    });
  }

  /** 글자가 길면 자동으로 줄여서 한 줄에 맞춥니다 */
  function fitText(ctx, text, x, y, maxW, size) {
    let s = size;
    while (s > 26 && ctx.measureText(text).width > maxW) {
      s -= 4;
      ctx.font = "800 " + s + "px " + FONT;
    }
    ctx.fillText(text, x, y);
  }

  const toBlob = (c) => new Promise((ok) => c.toBlob(ok, "image/png"));

  /** 이미지로 저장 */
  async function saveImage(msgEl) {
    const c = await draw();
    if (!c) return;
    const blob = await toBlob(c);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fromis9-typing-" + Date.now() + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    say(msgEl, "이미지를 저장했습니다!", true);
  }

  /** 공유하기 — 휴대폰은 공유창, PC 는 X(트위터) 또는 복사 */
  async function share(msgEl) {
    const text = last.shareText;
    const c = await draw();
    const blob = c ? await toBlob(c) : null;
    const file = blob ? new File([blob], "fromis9-typing.png", { type: "image/png" }) : null;

    // 1) 휴대폰 : 사진까지 함께 공유창 띄우기
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: text });
        say(msgEl, "공유했습니다!", true);
        return;
      } catch (e) { if (e.name === "AbortError") return; }
    }
    // 2) 글만이라도 공유창
    if (navigator.share) {
      try {
        await navigator.share({ text: text });
        say(msgEl, "공유했습니다!", true);
        return;
      } catch (e) { if (e.name === "AbortError") return; }
    }
    // 3) PC : X(트위터) 새 창 + 글 복사
    try { await navigator.clipboard.writeText(text); } catch (e) {}
    window.open("https://x.com/intent/post?text=" + encodeURIComponent(text), "_blank", "noopener");
    say(msgEl, "글을 복사했어요. 이미지는 '이미지로 저장' 후 첨부해 주세요.", true);
  }

  function say(el, msg, ok) {
    if (!el) return;
    el.textContent = msg;
    el.className = "share-msg " + (ok ? "is-ok" : "is-ng");
    setTimeout(() => { el.textContent = ""; }, 4000);
  }

  function init() {
    $("#btnSaveImgLyrics").addEventListener("click", () => saveImage($("#shareMsgLyrics")));
    $("#btnShareLyrics").addEventListener("click", () => share($("#shareMsgLyrics")));
    $("#btnSaveImgQuiz").addEventListener("click", () => saveImage($("#shareMsgQuiz")));
    $("#btnShareQuiz").addEventListener("click", () => share($("#shareMsgQuiz")));
  }

  return { init, set, draw };
})();

/* ======================= 5-b. 랭킹 =======================
   Supabase 라는 무료 데이터 저장소에 기록을 올리고 받아옵니다.
   별도 라이브러리 없이 fetch 만으로 통신합니다.
   data/ranking-config.js 의 enabled 가 false 면 이 기능은 통째로 숨겨집니다. */

const Ranking = (() => {
  const NICK_KEY = "f9typing_nick";
  const on = () => typeof RANKING !== "undefined" && RANKING.enabled && RANKING.url && RANKING.anonKey;

  // 랭킹 화면에서 보고 있는 모드 (퀴즈가 아직 공개 전이면 가사 타이핑부터)
  let lastMode = feature("quiz") ? "quiz" : "lyrics";
  let pending = null;        // 등록 대기 중인 기록
  let nickAfter = null;      // 닉네임 입력이 끝난 뒤 할 일

  /* ---- 닉네임 ---- */
  const getNick = () => localStorage.getItem(NICK_KEY) || "";

  function askNick(then) {
    nickAfter = then || null;
    $("#nickInput").value = getNick();
    $("#nickErr").textContent = "";
    $("#nickModal").hidden = false;
    setTimeout(() => $("#nickInput").focus(), 50);
  }

  function saveNick() {
    const v = $("#nickInput").value.trim().replace(/\s+/g, " ");
    if (v.length < 2 || v.length > 12) {
      $("#nickErr").textContent = "2~12글자로 지어주세요.";
      return;
    }
    // 이름에 쓸 수 없는 글자 거르기
    if (/[<>&"'\\/]/.test(v)) {
      $("#nickErr").textContent = "< > & \" ' / \\ 는 쓸 수 없어요.";
      return;
    }
    localStorage.setItem(NICK_KEY, v);
    $("#nickModal").hidden = true;
    paintNick();
    const fn = nickAfter; nickAfter = null;
    if (fn) fn();
  }

  function paintNick() {
    const n = getNick() || "—";
    $("#nickLyrics").textContent = n;
    $("#nickQuiz").textContent = n;
    $("#nickChant").textContent = n;
  }

  /** 모드별로 쓰는 화면 요소 모음 */
  const UI = {
    lyrics: { box: "#submitLyrics", msg: "#msgLyrics", btn: "#btnSubmitLyrics" },
    quiz:   { box: "#submitQuiz",   msg: "#msgQuiz",   btn: "#btnSubmitQuiz" },
    chant:  { box: "#submitChant",  msg: "#msgChant",  btn: "#btnSubmitChant" }
  };

  /* ---- 말도 안 되는 기록 거르기 ----
     클라이언트에서 한 번, Supabase 쪽 CHECK 규칙에서 또 한 번 걸러집니다. */
  function checkPlausible(rec) {
    if (rec.mode === "lyrics") {
      if (!(rec.seconds >= 10)) return "10초도 안 걸린 기록은 등록할 수 없어요.";
      if (!(rec.typed >= 30)) return "30글자 이상 쳐야 등록할 수 있어요.";
      if (!(rec.cpm >= 1 && rec.cpm <= 1500)) return "타수가 정상 범위를 벗어났어요. (1~1500)";
      if (!(rec.accuracy >= 0 && rec.accuracy <= 100)) return "정확도 값이 이상해요.";
      if (rec.accuracy < 50) return "정확도 50% 이상이어야 등록할 수 있어요.";
    } else if (rec.mode === "chant") {
      if (!(rec.total >= 3)) return "응원 구간이 3개 이상인 곡만 등록할 수 있어요.";
      if (!(rec.hits >= 0 && rec.hits <= rec.total)) return "성공 개수가 이상해요.";
      if (!(rec.rate >= 0 && rec.rate <= 100)) return "성공률 값이 이상해요.";
      if (rec.hits === 0) return "한 구간도 못 맞히면 등록할 수 없어요.";
    } else {
      if (rec.passed > 0) return "패스한 판은 랭킹에 올릴 수 없어요. 전부 맞혀보세요!";
      if (!(rec.seconds >= rec.count * 1.5)) return "너무 빠른 기록이라 등록할 수 없어요.";
      if (!(rec.seconds <= 3600)) return "1시간이 넘는 기록은 등록할 수 없어요.";
      if (!(rec.misses >= 0 && rec.misses <= 999)) return "틀린 횟수 값이 이상해요.";
    }
    return null;   // 통과
  }

  /* ---- Supabase 통신 ---- */

  /** 주소 뒤에 /rest/v1 이 붙어 있든 없든 똑같이 동작하게 정리합니다 */
  const apiBase = () =>
    String(RANKING.url || "").trim()
      .replace(/\/+$/, "")            // 끝의 / 제거
      .replace(/\/rest\/v1$/, "")     // 끝의 /rest/v1 제거
    + "/rest/v1";

  const headers = () => ({
    "apikey": RANKING.anonKey,
    "Authorization": "Bearer " + RANKING.anonKey,
    "Content-Type": "application/json"
  });

  async function send(rec) {
    // 모드마다 쓰는 칸만 담습니다. (없는 칸을 보내면 통째로 거부당합니다)
    const body = { nickname: getNick(), mode: rec.mode };

    if (rec.mode === "lyrics") {
      body.song_id = rec.songId;
      body.cpm = Math.round(rec.cpm);
      body.accuracy = Math.round(rec.accuracy);
    } else if (rec.mode === "quiz") {
      body.seconds = Number(rec.seconds.toFixed(2));
      body.misses = rec.misses;
    } else if (rec.mode === "chant") {
      body.song_id = rec.songId;
      body.rate = Math.round(rec.rate);
      body.hits = rec.hits;
      body.total = rec.total;
      body.misses = rec.misses;
    }
    const res = await fetch(apiBase() + "/scores", {
      method: "POST",
      headers: Object.assign(headers(), { "Prefer": "return=minimal" }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("등록 실패 (" + res.status + ")");
  }

  async function fetchTop(mode, songId) {
    // 응원법 전용 칸(rate/hits/total)은 응원법 조회에서만 요청합니다.
    // 안 그러면 그 칸을 아직 안 만든 상태에서 가사·퀴즈 랭킹까지 막힙니다.
    const cols = mode === "chant"
      ? "nickname,rate,hits,total,misses,created_at"
      : "nickname,cpm,accuracy,seconds,misses,created_at";

    let q = apiBase() + "/scores?select=" + cols +
            "&mode=eq." + mode + "&limit=" + (RANKING.topN || 20);
    q += mode === "quiz" ? "&order=seconds.asc"
       : mode === "chant" ? "&order=rate.desc,hits.desc"
       : "&order=cpm.desc";
    if (mode !== "quiz" && songId) q += "&song_id=eq." + encodeURIComponent(songId);
    const res = await fetch(q, { headers: headers() });
    if (!res.ok) throw new Error("불러오기 실패 (" + res.status + ")");
    return res.json();
  }

  /* ---- 결과 화면의 "랭킹에 등록" ---- */
  function offer(rec) {
    pending = rec;
    const ui = UI[rec.mode];
    const box = $(ui.box), msg = $(ui.msg), btn = $(ui.btn);
    if (!on()) { box.hidden = true; return; }

    box.hidden = false;
    btn.disabled = false;
    btn.textContent = "🏆 랭킹에 등록";
    msg.className = "submit-box__msg";
    paintNick();

    // 등록할 수 없는 기록이면 미리 알려줍니다
    const why = checkPlausible(rec);
    if (why) {
      btn.disabled = true;
      msg.textContent = why;
      msg.className = "submit-box__msg is-ng";
    } else {
      msg.textContent = "";
    }
  }

  async function submit() {
    if (!pending || !on()) return;
    const ui = UI[pending.mode];
    const msg = $(ui.msg), btn = $(ui.btn);

    const why = checkPlausible(pending);
    if (why) { msg.textContent = why; msg.className = "submit-box__msg is-ng"; return; }
    if (!getNick()) { askNick(submit); return; }

    btn.disabled = true;
    btn.textContent = "등록 중…";
    msg.textContent = "";
    try {
      await send(pending);
      btn.textContent = "등록 완료";
      msg.textContent = "랭킹에 올렸습니다! 아래 '랭킹 보기'에서 확인하세요.";
      msg.className = "submit-box__msg is-ok";
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "🏆 랭킹에 등록";
      // 응원법은 Supabase 에 칸을 추가해야 등록됩니다 (README 3-b 참고)
      const hint = (pending.mode === "chant" && /40[0-9]/.test(e.message))
        ? " — 응원법 랭킹은 Supabase 에 SQL 한 번을 더 실행해야 합니다. README 를 봐주세요."
        : " — 인터넷 연결이나 Supabase 설정을 확인해 주세요.";
      msg.textContent = e.message + hint;
      msg.className = "submit-box__msg is-ng";
    }
  }

  /* ---- 랭킹 화면 ---- */
  function open() {
    if (!on()) return;
    showScreen("screen-ranking");
    load();
  }

  /** 방금 한 모드의 순위를 바로 보여줍니다 (결과 화면의 "랭킹 보기") */
  function openAt(mode, songId) {
    if (!on()) return;
    if (mode !== "quiz" && !feature(mode === "chant" ? "chant" : "lyrics")) mode = "quiz";
    showScreen("screen-ranking");
    setMode(mode);
    if (songId) { $("#rankSong").value = songId; load(); }
  }

  function setMode(mode) {
    lastMode = mode;
    $("#tabQuiz").classList.toggle("is-on", mode === "quiz");
    $("#tabLyrics").classList.toggle("is-on", mode === "lyrics");
    $("#tabChant").classList.toggle("is-on", mode === "chant");
    $("#rankSong").hidden = mode === "quiz";
    if (mode !== "quiz") fillSongs(mode);
    load();
  }

  /** 모드에 맞는 곡만 선택 목록에 채웁니다 */
  function fillSongs(mode) {
    const sel = $("#rankSong");
    const field = mode === "chant" ? "chants" : "lyrics";
    const list = orderedSongs().filter((s) => s[field] && s[field].length);
    sel.replaceChildren();
    list.forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.title;
      sel.appendChild(o);
    });
  }

  async function load() {
    const list = $("#rankList");
    list.innerHTML = '<p class="rank-empty">불러오는 중…</p>';
    try {
      const songId = lastMode === "quiz" ? null : $("#rankSong").value;
      const rows = await fetchTop(lastMode, songId);
      paint(rows);
    } catch (e) {
      // 응원법 랭킹은 Supabase 에 칸을 추가해야 동작합니다
      const extra = (lastMode === "chant" && /40[0-9]/.test(e.message))
        ? '<br /><span style="font-size:13px">응원법 랭킹을 쓰려면 Supabase 에서 SQL 한 번을 더 실행해야 합니다.<br />README 의 "응원법 랭킹 켜기" 를 봐주세요.</span>'
        : "";
      list.innerHTML = '<p class="rank-empty">' + e.message + extra + '</p>';
    }
  }

  function paint(rows) {
    const list = $("#rankList");
    if (!rows.length) {
      list.innerHTML = '<p class="rank-empty">아직 등록된 기록이 없습니다. 첫 번째 기록을 남겨보세요!</p>';
      return;
    }
    const me = getNick();
    const frag = document.createDocumentFragment();

    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "rank-row" + (r.nickname === me ? " is-me" : "");

      const no = document.createElement("div");
      no.className = "rank-row__no";
      no.textContent = i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1;

      const nick = document.createElement("div");
      nick.className = "rank-row__nick";
      nick.textContent = r.nickname;

      const sub = document.createElement("div");
      sub.className = "rank-row__sub";
      sub.textContent = lastMode === "quiz"  ? "오답 " + (r.misses ?? 0) + "회"
                      : lastMode === "chant" ? (r.hits ?? 0) + " / " + (r.total ?? 0) + "구간"
                      : "정확도 " + (r.accuracy ?? 0) + "%";

      const score = document.createElement("div");
      score.className = "rank-row__score";
      score.textContent = lastMode === "quiz"  ? fmtClock(r.seconds)
                        : lastMode === "chant" ? (r.rate ?? 0) + "%"
                        : r.cpm + " CPM";

      row.append(no, nick, sub, score);
      frag.appendChild(row);
    });
    list.replaceChildren(frag);
  }

  /* ---- 초기화 ---- */
  function init() {
    if (!on()) return;   // 설정 전에는 랭킹 관련 UI를 모두 숨겨둡니다

    $("#homeRanking").hidden = false;
    paintNick();

    // 결과 화면마다 "랭킹 보기" 버튼을 켭니다
    [["#btnRankFromLyrics", "lyrics"], ["#btnRankFromQuiz", "quiz"], ["#btnRankFromChant", "chant"]]
      .forEach(([sel, mode]) => {
        const b = $(sel);
        b.hidden = false;
        b.addEventListener("click", () => openAt(mode));
      });

    // 응원법이 등록된 곡이 없으면 탭을 숨깁니다
    const hasChants = SONGS.some((s) => s.chants && s.chants.length > 0);
    if (!feature("chant") || !hasChants) $("#tabChant").hidden = true;

    // 퀴즈가 공개 전이면 가사 타이핑 순위부터 보여줍니다
    setMode(feature("quiz") ? "quiz" : "lyrics");

    $("#btnOpenRanking").addEventListener("click", open);
    $("#btnHomeFromRanking").addEventListener("click", goHome);
    $("#tabQuiz").addEventListener("click", () => setMode("quiz"));
    $("#tabLyrics").addEventListener("click", () => setMode("lyrics"));
    $("#tabChant").addEventListener("click", () => setMode("chant"));
    $("#rankSong").addEventListener("change", load);
    $("#btnRankRefresh").addEventListener("click", load);

    $("#btnSubmitLyrics").addEventListener("click", submit);
    $("#btnSubmitQuiz").addEventListener("click", submit);
    $("#btnSubmitChant").addEventListener("click", submit);
    $("#btnNickLyrics").addEventListener("click", () => askNick());
    $("#btnNickQuiz").addEventListener("click", () => askNick());
    $("#btnNickChant").addEventListener("click", () => askNick());

    $("#btnNickSave").addEventListener("click", saveNick);
    $("#btnNickCancel").addEventListener("click", () => { $("#nickModal").hidden = true; nickAfter = null; });
    $("#nickInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); saveNick(); }
      if (e.key === "Escape") $("#nickModal").hidden = true;
    });
  }

  return { init, offer, open, openAt, isOn: on };
})();

/* ======================= 6. 시작 화면 · 초기화 ======================= */

function goHome() {
  Lyrics.quit();
  Quiz.quit();
  Chant.quit();
  Audio9.stop();
  setStageBg("");
  showScreen("screen-home");
}

/** 시작 화면의 앨범 커버 띠를 채웁니다.
 *  끊김 없이 도는 것처럼 보이려면 같은 목록을 두 번 넣어야 합니다.
 *  (CSS 가 정확히 절반만큼 밀어내므로 이어붙인 자리가 안 보입니다) */
function renderMarquee() {
  const track = $("#marqueeTrack");
  const list = orderedSongs().filter((s) => s.cover);
  if (!track || list.length === 0) {
    if (track) $("#albumMarquee").hidden = true;
    return;
  }

  const makeItem = (s) => {
    const box = document.createElement("div");
    box.className = "marquee__item";
    if (s.color) box.style.backgroundColor = s.color;

    const img = makeCoverImg(s.cover);
    img.dataset.src = thumbOf(s.cover);   // 아래에서 한꺼번에 넣어줍니다

    box.appendChild(img);
    box.title = s.title + " · " + (s.album || "");
    return box;
  };

  const frag = document.createDocumentFragment();
  for (let pass = 0; pass < 2; pass++) {
    list.forEach((s) => frag.appendChild(makeItem(s)));
  }
  track.replaceChildren(frag);

  /* 커버는 그냥 한 번에 다 불러옵니다.
     나눠서 받아봐야 전체 용량(약 1.7MB)은 똑같은데,
     채워지는 동안 빈 칸이 색 덩어리로 보이는 게 더 거슬립니다. */
  track.querySelectorAll("img[data-src]").forEach((im) => {
    im.src = im.dataset.src;
    delete im.dataset.src;
  });
}

/** 02번 카드 미리보기에 앨범 커버 한 장을 넣습니다 (열 때마다 랜덤) */
function renderDemoCover() {
  const box = $("#demoCover");
  const list = SONGS.filter((s) => s.cover);
  if (!box || list.length === 0) return;

  const s = list[Math.floor(Math.random() * list.length)];
  const img = makeCoverImg(s.cover);
  img.src = thumbOf(s.cover);
  box.style.backgroundColor = s.color || "";
  box.replaceChildren(img);
}

/* ---- 휴대폰 키보드 대응 ----
   휴대폰에서 키보드가 올라오면 화면의 아래쪽 절반쯤이 가려집니다.
   visualViewport 로 "실제로 보이는 높이"를 감시해서,
   키보드가 올라오면 body 에 kb-open 을 붙여 가사를 위로 끌어올립니다. */
function initKeyboardWatch() {
  const vv = window.visualViewport;
  if (!vv) return;   // 데스크톱 브라우저 등 지원 안 하면 아무 일도 안 함

  const update = () => {
    // 화면 높이가 눈에 띄게 줄었으면 키보드가 올라온 것으로 봅니다
    const shrunk = window.innerHeight - vv.height > 140;
    const playing = currentScreen === "screen-lyrics" || currentScreen === "screen-quiz";
    document.body.classList.toggle("kb-open", shrunk && playing);

    // 보이는 높이를 CSS 에서도 쓸 수 있게 넘겨줍니다
    document.documentElement.style.setProperty("--vv-height", vv.height + "px");

    // 지금 치는 줄이 가려졌으면 보이도록 스크롤
    if (shrunk && playing) {
      const el = currentScreen === "screen-lyrics" ? $("#lineCurrent") : $("#quizInput");
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/* ---- 결과 화면 사진 ----
   data/result-art.js 목록에서 무작위로 한 장을 골라 보여줍니다.
   같은 사진이 연달아 나오지 않도록 직전에 쓴 건 피합니다. */

let lastArt = "";

function pickResultArt(sel) {
  const fig = $(sel);
  if (!fig) return;

  const list = (typeof RESULT_ART !== "undefined") ? RESULT_ART : [];
  if (!list.length) { fig.hidden = true; return; }

  // 방금 나온 사진은 빼고 고릅니다 (한 장뿐이면 그냥 그걸로)
  const pool = list.length > 1 ? list.filter((p) => p !== lastArt) : list;
  const src = pool[Math.floor(Math.random() * pool.length)];
  lastArt = src;

  const img = fig.querySelector(".result-art__img");
  const bg = fig.querySelector(".result-art__bg");

  fig.hidden = true;                     // 다 불러온 뒤에 보여줍니다
  img.onload = () => {
    bg.style.backgroundImage = 'url("' + src + '")';
    fig.hidden = false;
  };
  img.onerror = () => { fig.hidden = true; };
  img.src = src;
}

function init() {
  applyFeatureFlags();   // 아직 공개 안 한 기능을 먼저 감춥니다
  initTheme();
  initKeyboardWatch();
  initVolume();
  // 커버 미리받기는 첫 화면을 무겁게 하므로 퀴즈에 들어갈 때 합니다
  renderMarquee();
  renderDemoCover();
  Lyrics.initAutoWaitToggle();
  Ranking.init();
  Share.init();
  Lyrics.renderSongList();
  Chant.renderSongList();

  // ---- 응원법 모드 ----
  $("#btnModeChant").addEventListener("click", () => showScreen("screen-chant-select"));
  $("#btnQuitChant").addEventListener("click", () => { Chant.quit(); showScreen("screen-chant-select"); });
  $("#btnRetryChant").addEventListener("click", () => Chant.start(Chant.getSong()));
  $("#btnChangeChantSong").addEventListener("click", () => { setStageBg(""); showScreen("screen-chant-select"); });
  $("#btnHomeFromChant").addEventListener("click", goHome);

  // ---- 시작 화면 ----
  $("#btnModeLyrics").addEventListener("click", () => showScreen("screen-select"));
  // 퀴즈는 커버가 보이면 정답이 새어나가므로 배경을 반드시 끕니다
  $("#btnModeQuiz").addEventListener("click", () => { setStageBg(""); Quiz.showIntro(); });
  $("#btnHome").addEventListener("click", goHome);
  $("#btnBack").addEventListener("click", goBack);
  // 휴대폰의 뒤로가기 제스처도 같은 동작을 하게 합니다
  window.addEventListener("popstate", () => { if (BACK_TO[currentScreen]) goBack(); });

  // ---- 가사 모드 ----
  $("#btnQuitLyrics").addEventListener("click", () => { Lyrics.quit(); showScreen("screen-select"); });
  $("#btnPlayPause").addEventListener("click", () => Lyrics.togglePause());
  $("#btnRetryLyrics").addEventListener("click", () => Lyrics.start(Lyrics.getSong()));
  $("#btnChangeSong").addEventListener("click", () => { setStageBg(""); showScreen("screen-select"); });
  $("#btnHomeFromLyrics").addEventListener("click", goHome);

  // ---- 퀴즈 모드 ----
  $("#btnQuizStart").addEventListener("click", () => Quiz.start());
  $("#btnHomeFromQuizIntro").addEventListener("click", goHome);
  $("#btnQuitQuiz").addEventListener("click", () => { Quiz.quit(); goHome(); });
  $("#btnRetryQuiz").addEventListener("click", () => Quiz.start());
  $("#btnHomeFromQuiz").addEventListener("click", goHome);

  // ---- 스페이스바로 화면이 스크롤되는 브라우저 기본 동작 차단 ----
  window.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
  });
}

// 이 파일이 늦게 불려올 수도 있으므로, 이미 화면이 준비됐다면 바로 시작합니다
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
