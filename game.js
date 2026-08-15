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

/* ---- 나 전용 기능이 켜져 있는지 ----
   싱크 조정 화면, 키보드 박자 테스트, 결과 화면의 타이밍 다듬기처럼
   곡 데이터를 고치거나 판정 자체를 바꾸는 것들입니다.

   보통은 꺼둡니다. 두 가지 이유가 있습니다.
     - 곡 데이터를 손보는 건 만드는 사람이 할 일입니다.
     - 판정 범위를 누구나 넓힐 수 있으면 랭킹이 공평하지 않습니다.

   켜는 법 : data/features.js 의 devTune 을 true 로,
             또는 주소 뒤에 #tune 을 붙이면 그 판에서만 켜집니다. */
function isDev() {
  if (typeof FEATURES !== "undefined" && FEATURES.devTune) return true;
  return location.hash === "#tune";
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
  "screen-chant-how": "screen-chant-select",
  "screen-chant-ready": "screen-chant-how",
  "screen-chant": "screen-chant-select",
  "screen-chant-result": "screen-chant-select"
};

let currentScreen = "screen-home";

/* 랭킹을 결과 화면에서 열었으면, 뒤로 갈 때 그 결과 화면으로 돌아갑니다.
   안 그러면 결과를 다시 볼 방법이 없어서 판을 새로 해야 했습니다. */
let rankReturn = null;

function showScreen(id) {
  currentScreen = id;
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));

  // 플레이 화면에서는 배경 스크롤을 잠급니다.
  // (모바일에서는 키보드가 올라오면 스크롤이 필요해서 잠그지 않습니다)
  const playing = id === "screen-lyrics" || id === "screen-quiz" || id === "screen-chant";
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  document.body.classList.toggle("is-playing", playing && !narrow);
  // 응원법은 정확도·타수·시간을 쓰지 않습니다.
  // (그 화면에서는 갱신되지 않는 옛날 숫자가 그대로 떠 있었습니다)
  $("#hud").hidden = !playing || id === "screen-chant";

  // 시작 화면에서는 뒤로 가기를 숨깁니다
  $("#btnBack").hidden = !BACK_TO[id];

  window.scrollTo(0, 0);
}

/** 지금 화면 기준으로 한 단계 뒤로 갑니다 */
function goBack() {
  // 결과 화면에서 열어본 랭킹이면 그 결과 화면으로 되돌립니다
  if (currentScreen === "screen-ranking" && rankReturn) {
    const back = rankReturn;
    rankReturn = null;
    showScreen(back);
    return;
  }

  const to = BACK_TO[currentScreen];
  if (!to) return;

  // 게임 중이었다면 정리부터
  if (currentScreen === "screen-lyrics") Lyrics.quit();
  if (currentScreen === "screen-quiz") Quiz.quit();
  if (currentScreen === "screen-chant") Chant.quit();
  if (currentScreen === "screen-chant-ready" || currentScreen === "screen-chant-how") {
    Chant.release();
    if (currentScreen === "screen-chant-how") setStageBg("");
  }
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
  const GRACE = 3.0;       // 타이핑 : 응원 시각이 지난 뒤 봐주는 시간
  const GAP = 0.15;        // 다음 구간과 겹치지 않게 두는 최소 간격


  /* =====================================================================
     음성 판정은 "언제 시작했는가" 만 봅니다
     ---------------------------------------------------------------------
     한동안은 "얼마나 오래 외쳤는가" 로 판정했습니다. 그런데 응원 하나가
     몇 초짜리인지는 곡 데이터에 없습니다. 그래서 글자 수로, 음절 수로,
     ~ 와 ! 로 계속 <추측> 했는데 — 추측이라 늘 조금씩 어긋났습니다.
     곡마다 dur 를 손으로 적는 것도 371구간을 생각하면 말이 안 됩니다.

     그런데 응원법 연습에서 정말 중요한 건 길이가 아니라 <타이밍> 입니다.
     제때 질렀으면 맞은 겁니다. 그리고 그 타이밍은 이미 정확히 있습니다.
     time 이 바로 그 값이니까요.

     그래서 소리를 <내기 시작한 순간> 이 time 근처인지만 봅니다.
     추측이 없으니 어긋날 데가 없습니다.

     덤으로 반응도 빨라집니다. 예전에는 다 외치고 나서야 성공이 떴는데
     (그래서 늘 한 박자 늦은 느낌이었습니다) 이제 지르는 순간 바로 뜹니다.

     보정값(offset)과 인정 범위(tol)는 준비 화면에서 직접 맞출 수 있습니다.
     사람마다, 이어폰마다 반 박자씩 다르기 때문에 고정값으로는 안 맞습니다. */

  const MIN_VOICE = 0.22;   // 기침·마우스 소리가 아니라고 볼 최소 발성 시간

  const TUNE_KEY = "f9typing_voice_tune";
  const TUNE_DEFAULT = { offset: 0.3, tol: 0.5 };
  let tune = Object.assign({}, TUNE_DEFAULT);

  /* 저장해둔 값 불러오기.

     인정 범위(tol)는 누구나 잠깐 멈춤에서 맞출 수 있으니 그대로 씁니다.
     타이밍 보정(offset)은 곡 싱크를 맞추는 값이라 나 전용입니다.
     그래서 평소에는 기본값으로 되돌립니다 — 예전에 맞춰둔 값이 남아서
     남들과 다른 판정으로 돌아가면 안 되니까요. */
  function loadTune() {
    tune = Object.assign({}, TUNE_DEFAULT);
    try {
      const raw = localStorage.getItem(TUNE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.tol === "number") tune.tol = saved.tol;
        if (isDev() && typeof saved.offset === "number") tune.offset = saved.offset;
      }
    } catch (e) { tune = Object.assign({}, TUNE_DEFAULT); }
  }
  function saveTune() {
    try { localStorage.setItem(TUNE_KEY, JSON.stringify(tune)); } catch (e) {}
  }
  loadTune();

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
  let mode = "typing";     // "typing" | "voice"
  let method = null;       // 지금 쓰고 있는 입력 방식
  let onsetLog = [];       // 구간마다 "실제로 언제 소리를 냈는지" (타이밍 다듬기용)
  let lastEnd = 0;         // 직전 구간의 판정이 실제로 끝난 시각
  let paused = false;      // 잠깐 멈춤

  const input = $("#chantInput");
  const elLine = $("#chantLine");

  /* ---- 구간의 시작·마감 시각 ----
     앞뒤 구간과 겹치지 않도록 자동으로 좁힙니다.
     (DM 처럼 2초 간격으로 붙어 있는 구간이 있어서 꼭 필요합니다) */
  /* ---- 이 구간을 외치는 데 걸리는 시간 ----
     띄어쓰기는 실제로는 숨 쉬는 자리라 세지 않습니다. */
  /* ---- 응원 시각이 지난 뒤 몇 초까지 봐줄지 ----
     타이핑은 치는 속도가 사람마다 달라서 넉넉히 3초를 줍니다.
     음성은 인정 구간이 끝나면 바로 판정합니다. 조금 여유만 둡니다. */
  function graceOf(i) {
    if (!isBeat()) return GRACE;
    return tune.tol + MIN_VOICE + 0.15;
  }

  /** 이 구간을 "노려야 하는 시각". 음성일 때만 조금 뒤로 밀려 있습니다. */
  function atOf(i) {
    return list[i].time + (isBeat() ? tune.offset : 0);
  }

  function deadlineOf(i) {
    const own = atOf(i) + graceOf(i);
    const next = list[i + 1] ? atOf(i + 1) - GAP : Infinity;
    return Math.min(own, next);
  }
  /* ---- 이 구간을 화면에 띄우는 시각 ----

     앞 구간과 겹치면 안 되니 앞 구간이 끝난 뒤에 띄웁니다.
     그런데 "앞 구간이 끝난 시각" 을 <예정된 마감> 으로 잡으면 안 됩니다.
     이미 맞혔든 놓쳤든 판정이 끝났는데도 마감까지 기다리게 되거든요.

     응원이 촘촘한 곳에서 이게 치명적이었습니다. 1초 간격이면 다음 응원이
     0.15초 전에야 떠서, 읽을 새도 없이 외쳐야 했습니다.
     (371구간 중 44구간이 준비 시간 1초 미만이었습니다)

     그래서 <실제로 판정이 끝난 시각> 을 씁니다. 일찍 맞히면 그만큼
     다음 응원을 일찍 볼 수 있습니다. */
  function showAtOf(i) {
    const own = atOf(i) - LEAD;
    const prev = i === 0 ? 0 : (i === idx ? lastEnd : deadlineOf(i - 1));
    return Math.max(own, prev, 0);
  }

  /* ---- "지금 성공으로 쳐줄 수 있는 때인가" ----
     응원 구간은 LEAD(1.8초) 만큼 미리 떠서 준비할 시간을 줍니다.
     하지만 그 준비 시간에 미리 다 쳐놓고 성공이 되면 박자 연습이 안 됩니다.
     그래서 실제 판정은 그 응원이 나와야 하는 시각(time)부터 시작합니다.
     → 미리 다 쳐놓았다면 time 이 되는 순간 성공으로 넘어갑니다. */
  function judgeFrom(i) {
    // 음성은 인정 구간이 time 앞뒤로 열려 있습니다.
    const start = atOf(i) - (isBeat() ? tune.tol : 0);
    // 응원이 아주 촘촘히 붙어 있으면 마감이 time 보다 앞에 올 수도 있습니다.
    // 그러면 성공할 방법이 아예 없어지므로, 최소한의 시간은 남겨둡니다.
    return Math.min(start, deadlineOf(i) - 0.4);
  }
  const judgingNow = (now) => now >= judgeFrom(idx);

  /* =====================================================================
     입력 방식 (타이핑 / 음성)
     ---------------------------------------------------------------------
     진행·판정·결과·랭킹은 전부 아래 공통 코드가 처리하고,
     "성공했는지 어떻게 알아내는가" 만 여기서 갈립니다.

       onLiveStart(c)      구간이 화면에 떴을 때
       onFrame(now, judge) 매 순간. judge 가 true 면 성공 판정 가능
       onLiveEnd()         구간이 끝났을 때 (성공이든 놓침이든)
       enter() / cleanup() 게임 시작 / 게임을 벗어날 때
     ===================================================================== */

  /* ---- ① 타이핑 : 지금까지와 똑같습니다 ---- */
  const Typing = {
    id: "typing",
    ready: false,          // 다 쳐놓고 time 을 기다리는 중인지

    enter() {
      input.hidden = false;
      input.disabled = false;
      $("#chantGauge").hidden = true;
      elLine.classList.remove("chant-line--voice");
      $("#chantStage").classList.remove("chant-stage--voice");
      $("#chantHint").textContent = "노래는 멈추지 않습니다 · 구간이 뜨면 시간 안에 정확히 치세요";
      input.focus();
    },
    onLiveStart(c) {
      this.ready = false;
      input.disabled = false;
      input.value = "";
      input.maxLength = c.text.length;
      input.focus();
    },
    onFrame(now, judge) {
      if (judge && this.ready) hit();
    },

    /* 구간이 아닐 때는 입력창을 아예 잠급니다.

       예전에는 열어둔 채로 "구간이 아니면 무시" 만 했습니다. 그런데 무시해도
       글자는 입력창에 그대로 쌓입니다. 특히 한글은 조합 중인 글자가 남아 있다가
       다음 구간이 뜨는 순간 한꺼번에 튀어나옵니다.

       disabled 로 잠그면 글자가 들어오지도 않고 조합도 끊깁니다.
       구간이 뜨면 다시 열고 비운 뒤 커서를 돌려줍니다. */
    onLiveEnd() {
      this.ready = false;
      input.value = "";
      composing = false;
      input.disabled = true;
    },
    cleanup() { input.disabled = false; }
  };

  /* ---- ② 음성 : 마이크에 대고 실제로 외칩니다 ----
     무슨 말을 했는지는 보지 않습니다. 소리를 지르는 발성은 인식률이 낮아서
     믿을 수 없기 때문입니다. "얼마나 크게, 언제" 냈는지만 봅니다.

     외치는 동안 쌓인 시간이 목표치를 채우면 성공입니다.
     쌓이는 만큼 글자가 왼쪽부터 채워져서, 알아듣고 있다는 게 눈에 보입니다. */
  const VoiceMode = {
    id: "voice",
    wasLoud: false,        // 직전 프레임에 소리를 내고 있었는지 (시작 순간을 잡으려고)
    onsetAt: null,         // 이번에 소리를 내기 시작한 노래 시각
    onsetOk: false,        // 그 시작이 제 타이밍이었는지
    loud: 0,               // 시작한 뒤로 낸 시간
    lastT: 0,              // 직전 프레임 시각 (초 단위)

    enter() {
      input.hidden = true;
      input.disabled = true;
      $("#chantGauge").hidden = false;
      // 글자 칸 대신 한 문장으로 보여줍니다 (아래 setText 설명 참고)
      elLine.classList.add("chant-line--voice");
      // 외칠 때는 가사보다 응원이 주인공입니다. 가사는 뒤로 물립니다.
      $("#chantStage").classList.add("chant-stage--voice");
      $("#chantHint").textContent = "이어폰을 끼고 하세요 · 구간이 뜨면 박자에 맞춰 크게 외치세요";
    },

    /* ---- 글자 칸이 아니라 한 문장으로 ----
       타이핑은 "어느 글자를 칠 차례인가" 가 중요해서 칸을 나눠 보여줍니다.
       그런데 외칠 때는 칸이 오히려 방해가 됩니다. 눈은 자유로운데
       띄엄띄엄한 칸을 한 문장으로 읽어내야 하니 눈에 안 들어옵니다.

       그래서 통 문장으로 두고, 노래방처럼 왼쪽부터 색이 차오르게 합니다.
       (가사 줄에 이미 쓰고 있는 방식과 같습니다) */
    setText(text, pct) {
      if (elLine.textContent !== text) elLine.textContent = text;
      elLine.style.setProperty("--sung", pct.toFixed(1) + "%");
    },
    onLiveStart(c) {
      this.wasLoud = false;
      this.onsetAt = null;
      this.onsetOk = false;
      this.logged = false;
      this.loud = 0;
      this.lastT = 0;
      this.setText(c.text, 0);
    },

    /** "지금 소리를 내고 있는가" — 키보드 모드는 이것만 바꿔서 씁니다 */
    sense() { return Voice.isLoud(); },

    onFrame(now, judge) {
      if (this.id === "voice") {
        Voice.update();
        Voice.paintGauge($("#chantBar"), $("#chantZone"), $("#chantGaugeHint"));
      }

      // 흐른 시간은 실제 시계로 잽니다.
      // (이 함수는 화면 갱신 때도, 오디오 이벤트 때도 불려서 간격이 일정하지 않습니다)
      const t = performance.now() / 1000;
      const dt = this.lastT ? Math.min(0.1, t - this.lastT) : 0;
      this.lastT = t;

      if (!live || resolved) return;

      const loud = this.sense();
      const target = atOf(idx);
      const inWindow = now >= target - tune.tol && now <= target + tune.tol;

      /* 인정 구간이 열렸는데 그때 이미 소리를 내고 있으면, 그 순간부터 인정합니다.

         예전에는 <소리를 내기 시작하는 순간> 만 봤습니다. 그래서 구간이 열리기
         전부터 계속 소리를 내고 있으면 시작하는 순간이 없어서 놓침이 됐습니다.
         앞 응원을 길게 끌었거나 응원이 촘촘히 붙어 있으면 자연히 그렇게 됩니다.
         제때 소리를 내고 있었는데 놓침이 되는 건 말이 안 됩니다.

         대신 창 안에서 낸 시간만 다시 셉니다. 창이 열리는 순간 잠깐 걸친 것으로는
         통과되지 않게요. */
      if (loud && !this.onsetOk && inWindow && this.wasLoud) {
        this.onsetOk = true;
        this.loud = 0;
        if (this.onsetAt === null) this.onsetAt = now;
      }

      // 소리를 내기 시작한 순간을 잡습니다
      if (loud && !this.wasLoud) {
        this.onsetAt = now;
        this.loud = 0;
        // 그 순간이 응원 시각 언저리였는가 — 이것만으로 맞았는지가 정해집니다
        this.onsetOk = inWindow;

        /* 나중에 타이밍을 다듬을 수 있게, 찍어둔 시각과 얼마나 차이 났는지
           그대로 적어둡니다. (보정값을 뺀 날것 그대로 — 판정 성공 여부와 무관) */
        if (!this.logged) {
          const raw = now - list[idx].time;
          if (raw > -1.3 && raw < 1.8) {
            onsetLog.push({ i: idx, raw: raw });
            this.logged = true;
          }
        }
      }
      this.wasLoud = loud;

      if (loud) this.loud += dt;
      else if (!this.onsetOk) this.loud = 0;    // 엉뚱한 때 낸 소리는 잊습니다

      // 제 타이밍에 시작했고, 기침이 아니라 진짜 발성이면 성공
      if (this.onsetOk) {
        this.setText(list[idx].text, Math.min(1, this.loud / MIN_VOICE) * 100);
        if (this.loud >= MIN_VOICE) hit();
        return;
      }

      /* 인정 구간이 끝났는데 시작조차 못 했으면 더 볼 것이 없습니다.
         마감까지 기다릴 이유가 없으니 바로 넘어갑니다.
         (그만큼 다음 응원을 일찍 볼 수 있습니다) */
      if (now > atOf(idx) + tune.tol) miss();
    },

    onLiveEnd() { this.lastT = 0; this.wasLoud = false; },
    /** 멈췄다 이어서 할 때 — 멈춘 동안의 시간·누름 상태를 지웁니다 */
    onResume() { this.lastT = 0; this.wasLoud = false; },
    cleanup() { Voice.close(); }
  };

  /* ---- ③ 키보드로 박자만 맞추기 ----
     마이크 없이도 타이밍 판정을 그대로 써볼 수 있게 한 것입니다.
     "소리를 내고 있는가" 를 "스페이스를 누르고 있는가" 로 바꾸기만 하면
     나머지(시작 순간 잡기·판정·타이밍 다듬기)는 음성과 완전히 같습니다. */
  let spaceDown = false;

  const KeyMode = Object.assign({}, VoiceMode, {
    id: "key",
    enter() {
      input.hidden = true;
      input.disabled = true;
      $("#chantGauge").hidden = true;
      elLine.classList.add("chant-line--voice");
      $("#chantStage").classList.add("chant-stage--voice");
      $("#chantHint").textContent = "구간이 뜨면 박자에 맞춰 스페이스를 누르세요 (마이크 없이 테스트)";
      spaceDown = false;
    },
    // 게이지·마이크는 건드리지 않고, 누름 상태만 봅니다
    sense() { return spaceDown; },
    cleanup() { spaceDown = false; }
  });

  /* 음성이든 키보드든 "박자를 맞추는" 방식입니다 (타이핑과 구분) */
  const isBeat = () => mode === "voice" || mode === "key";

  const methodOf = (m) =>
    m === "voice" ? VoiceMode : m === "key" ? KeyMode : Typing;

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

      const best = bestOfBoth(s.id);
      btn.querySelector(".song-card__title").textContent = s.title;
      btn.querySelector(".song-card__album").textContent = s.album || "";
      btn.querySelector(".song-card__meta").textContent =
        best ? "내 최고 " + best.rate + "%" : s.chants.length + "구간";
      btn.addEventListener("click", () => choose(s));
      grid.appendChild(btn);
    });
  }

  /* ---- 최고 기록 ----
     타이핑과 음성은 난이도가 다르므로 따로 저장합니다.
     (타이핑 쪽은 예전 기록을 그대로 쓰도록 열쇠 이름을 안 바꿨습니다) */
  const BEST_KEY = "f9typing_chant_best_";
  const bestKey = (id, m) => BEST_KEY + id + (m === "voice" ? "_voice" : "");

  function loadBest(id, m) {
    try {
      const raw = localStorage.getItem(bestKey(id, m));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveBest(id, m, rec) {
    try { localStorage.setItem(bestKey(id, m), JSON.stringify(rec)); } catch (e) {}
  }
  /** 곡 목록 카드에 보여줄, 둘 중 더 잘한 기록 */
  function bestOfBoth(id) {
    const t = loadBest(id, "typing");
    const v = loadBest(id, "voice");
    if (t && v) return v.rate > t.rate ? v : t;
    return t || v;
  }

  /* =====================================================================
     곡을 고른 뒤 ~ 시작하기 전까지
     ===================================================================== */

  /** 곡을 골랐을 때 : 입력 방식부터 물어봅니다 */
  function choose(s) {
    song = s;
    // 준비 화면에서도 구간 정보가 필요합니다 (소음 잴 때 그 대목을 틀어주려고)
    list = s.chants.slice().sort((a, b) => a.time - b.time);

    // 음성 모드를 아직 안 열었으면 예전처럼 바로 타이핑으로 갑니다
    if (!feature("chantVoice")) { start(s, "typing"); return; }

    $("#chantHowTitle").textContent = s.title + " — 어떻게 연습할까요?";
    paintVideoBtns();
    $("#howNote").hidden = true;
    // 마이크 없이 타이밍만 확인해보는 길 (나 전용)
    $("#howKeyLine").hidden = !isDev();
    paintHowCover(s);
    setStageBg(s.cover);       // 화면 전체에도 앨범 커버를 흐리게 깝니다
    showScreen("screen-chant-how");
  }

  /** 미리보기 카드 뒤에 이 곡의 앨범 커버를 깝니다 */
  function paintHowCover(s) {
    const url = s.cover ? 'url("' + s.cover + '")' : "none";
    ["#howDemoVoice", "#howDemoTyping"].forEach((sel) => {
      $(sel).style.setProperty("--how-cover", url);
    });
  }

  /* 응원법 영상 버튼은 그 곡에 영상 주소가 있을 때만 보입니다.
     영상은 <입력 방식 고르는 화면> 에서만 봅니다. 마이크를 맞추는 화면에서는
     소리를 재는 중이라 영상이 나오면 방해만 됩니다. */
  function paintVideoBtns() {
    const has = !!(song && song.chantVideo);
    $("#btnChantVideo1").hidden = !has;
    $("#btnChantVideoResult").hidden = !has;
  }

  /* ---- 유튜브 주소에서 영상 번호만 뽑기 ----
     watch?v= / youtu.be/ / shorts/ / embed/ 어떤 형태로 붙여넣어도 되게 합니다. */
  function ytId(url) {
    const m = String(url).match(
      /(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? m[1] : "";
  }

  /* ---- 시작 시각 ----
     유튜브에서 "공유 → 현재 시간부터" 로 복사하면 주소에 t=1m30s 가 붙습니다.
     그걸 그대로 붙여넣으면 응원법이 나오는 대목부터 재생됩니다.
     (API 나 키가 필요 없습니다. 주소만 있으면 됩니다) */
  function ytStart(url) {
    const m = String(url).match(/[?&#](?:t|start)=([^&#]+)/);
    if (!m) return 0;
    const v = m[1];
    if (/^\d+$/.test(v)) return parseInt(v, 10);          // t=90
    const hms = v.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/); // t=1m30s
    return (+(hms[1] || 0)) * 3600 + (+(hms[2] || 0)) * 60 + (+(hms[3] || 0));
  }

  /* ---- 시작 시각 고르기 (나 전용) ----

     주소를 손으로 고치지 않고, 영상을 보다가 응원법이 나오는 대목에서
     버튼만 누르면 그 시각이 잡히게 합니다.

     유튜브 IFrame Player API 를 씁니다. 키도 할당량도 필요 없고,
     지금 재생 위치를 읽어오려고 쓰는 것뿐입니다.
     스크립트는 나 전용일 때, 그것도 처음 쓸 때만 받아옵니다.
     (평소 방문자는 예전 그대로 — 바깥에서 받아오는 게 없습니다) */
  let ytPlayer = null;
  let ytPoll = null;

  function loadYTApi() {
    return new Promise((done, fail) => {
      if (window.YT && window.YT.Player) return done();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); done(); };
      if (!document.getElementById("ytapi")) {
        const s = document.createElement("script");
        s.id = "ytapi";
        s.src = "https://www.youtube.com/iframe_api";
        s.onerror = () => fail(new Error("API 를 못 받았습니다"));
        document.head.appendChild(s);
      }
      setTimeout(() => fail(new Error("시간 초과")), 6000);
    });
  }

  async function attachYT(id, at) {
    if (!isDev()) return;
    try { await loadYTApi(); } catch (e) { return; }   // 안 되면 그냥 평소대로

    ytPlayer = new YT.Player("ytFrame", {
      events: {
        onReady: () => {
          $("#vidTune").hidden = false;
          paintVidCode(at);
          if (ytPoll) clearInterval(ytPoll);
          ytPoll = setInterval(() => {
            if (!ytPlayer || !ytPlayer.getCurrentTime) return;
            $("#vidNow").textContent = fmtMmSs(ytPlayer.getCurrentTime() || 0);
          }, 200);
        }
      }
    });
  }

  function paintVidCode(at) {
    const base = String(song.chantVideo).split(/[?&#]/)[0];
    const url = at ? base + "?t=" + Math.floor(at) : base;
    song.chantVideo = url;                     // 이 판에서 바로 적용
    $("#vidCode").textContent = 'chantVideo: "' + url + '"';
  }

  function openVideo() {
    if (!song || !song.chantVideo) return;
    const id = ytId(song.chantVideo);
    const at = ytStart(song.chantVideo);
    const dev = isDev();
    $("#videoBox").innerHTML = id
      ? '<iframe id="ytFrame" src="https://www.youtube.com/embed/' + id + "?rel=0" +
        (at ? "&start=" + at : "") + (dev ? "&enablejsapi=1" : "") + '" ' +
        'title="응원법 영상" allowfullscreen ' +
        'allow="accelerometer; encrypted-media; picture-in-picture"></iframe>'
      : "";
    $("#vidTune").hidden = true;
    if (id && dev) attachYT(id, at);
    // 유튜브가 임베드를 막아둔 영상도 있어서 대체 링크를 항상 같이 둡니다
    $("#videoLink").href = song.chantVideo;
    $("#videoErr").hidden = false;
    $("#videoModal").hidden = false;
  }
  function closeVideo() {
    if (ytPoll) { clearInterval(ytPoll); ytPoll = null; }
    ytPlayer = null;
    $("#vidTune").hidden = true;
    $("#videoBox").innerHTML = "";      // 비우면 영상도 같이 멈춥니다
    $("#videoModal").hidden = true;
  }

  /* ---- 음성 준비 화면 ---- */
  let testRaf = null;

  function stepMark(sel, mark, state) {
    const el = $(sel);
    el.classList.remove("is-done", "is-ng");
    if (state) el.classList.add(state);
    if (mark) $(mark).textContent = state === "is-done" ? "✓" : state === "is-ng" ? "✕" : "…";
  }

  function stopTest() {
    if (testRaf) cancelAnimationFrame(testRaf);
    testRaf = null;
  }

  function testLoop() {
    Voice.update();
    Voice.paintGauge($("#testBar"), $("#testZone"), $("#testHint"));

    // 숫자로도 보여줍니다. 게이지가 안 움직일 때 원인을 좁힐 수 있게.
    const el = $("#micRead");
    if (Voice.isSilent()) {
      el.innerHTML = "<b>마이크에서 소리가 전혀 들어오지 않습니다.</b> " +
        "윈도우 <b>설정 → 시스템 → 소리 → 입력</b> 에서 맞는 마이크가 골라져 있는지, " +
        "음소거나 볼륨 0 이 아닌지 확인해 주세요." +
        (Voice.deviceLabel() ? "<br />지금 쓰는 장치: " + Voice.deviceLabel() : "");
      el.className = "mic-read is-ng";
    } else {
      // 조용할 때 / 지금 / 넘어야 하는 값 — 셋을 같이 보여줘야 감이 옵니다
      el.textContent =
        "조용할 때 " + Voice.noiseFloor.toFixed(0) +
        " · 지금 " + Voice.level.toFixed(0) +
        " · 넘어야 하는 값 " + Voice.threshold().toFixed(0) + " dB";
      el.className = "mic-read";
    }
    testRaf = requestAnimationFrame(testLoop);
  }

  /* ---- 마이크가 안 열렸을 때, 왜 안 됐는지 알려줍니다 ----
     원인마다 해야 할 일이 완전히 다릅니다. 뭉뚱그리면 고칠 수가 없어요. */
  function micErrorHtml(e) {
    const tail = "<br /><b>지금은 아래 '타이핑으로 하기' 로 연습할 수 있습니다.</b>";

    // ① 파일을 더블클릭해서 연 경우 — 제일 흔합니다
    if (e && e.code === "INSECURE") {
      return "<b>이 주소에서는 브라우저가 마이크를 막습니다.</b><br />" +
        "지금 주소가 <code>" + location.protocol + "//</code> 로 시작하죠? " +
        "마이크는 <code>https://</code> 나 <code>localhost</code> 에서만 열립니다. " +
        "허용을 눌러도 아무 일이 일어나지 않는 게 이 때문이에요.<br />" +
        "→ <b>typingfromis9.kr</b> 에서 열거나, 로컬이면 " +
        "<code>도구 열기.bat</code> 로 켜고 <code>http://localhost:5660</code> 으로 접속하세요." + tail;
    }
    if (e && e.code === "UNSUPPORTED") {
      return "이 브라우저는 마이크를 지원하지 않습니다. 크롬이나 엣지에서 열어주세요." + tail;
    }

    // ② 사용자가 거부했거나, 브라우저 설정에서 막혀 있는 경우
    const name = (e && e.name) || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "마이크 사용이 거부됐습니다. 주소창 왼쪽 <b>자물쇠 아이콘 → 마이크 → 허용</b> 으로 바꾼 뒤 " +
        "새로고침해 주세요." + tail;
    }
    // ③ 마이크가 아예 없는 경우
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "연결된 마이크를 찾지 못했습니다. 마이크가 꽂혀 있는지 확인해 주세요." + tail;
    }
    // ④ 다른 앱이 잡고 있는 경우
    if (name === "NotReadableError" || name === "AbortError") {
      return "다른 앱이 마이크를 쓰고 있어서 열지 못했습니다. 화상회의·녹음 프로그램을 끄고 다시 해보세요." + tail;
    }
    return "마이크를 열지 못했습니다. (" + (name || e.message) + ")" + tail;
  }

  async function toReady() {
    $("#chantReadyTitle").textContent = song.title + " — 마이크를 준비할게요";
    paintVideoBtns();
    stepMark("#stepMic", "#micMark", null);
    stepMark("#stepCalib", "#calibMark", null);
    $("#calibFill").style.width = "0%";
    $("#micTest").hidden = true;
    $("#micPickBox").hidden = true;
    $("#micAecBox").hidden = true;
    $("#readyError").hidden = true;
    $("#btnChantStart").disabled = true;
    $("#micAdjust").value = String(Voice.getAdjust());
    paintAdjustLabel();
    $("#micSyncBox").hidden = !isDev();     // 판정을 바꾸는 값이라 나 전용
    fillTuneInputs();
    setStageBg(song.cover);
    showScreen("screen-chant-ready");

    // 1) 마이크 허락받기
    try {
      await Voice.open();
    } catch (e) {
      stepMark("#stepMic", "#micMark", "is-ng");
      $("#micDesc").textContent = "마이크를 쓸 수 없습니다.";
      $("#readyError").innerHTML = micErrorHtml(e);
      $("#readyError").hidden = false;
      return;
    }
    stepMark("#stepMic", "#micMark", "is-done");
    $("#micDesc").textContent = "마이크를 쓸 수 있습니다.";
    await fillMicList();
    $("#micAecBox").hidden = false;

    // 2) 방이 얼마나 조용한지 재기
    await measureAndTest();
  }

  /* ---- 소음 재기 → 소리 테스트 ----
     잴 때 노래를 같이 틉니다.

     노래가 마이크로 얼마나 새어 들어오는지까지 같이 재두려는 겁니다.
     예전에는 "노래가 나오면 기준을 얼마쯤 올린다" 고 어림잡았는데,
     그래서 잴 때(노래 없음)와 실제로 할 때(노래 나옴)의 민감도가 달랐습니다.
     이어폰을 껴서 노래가 아예 안 들어오는데도 그랬습니다.
     이제 재는 상황과 하는 상황이 같습니다. */
  async function measureAndTest() {
    stepMark("#stepCalib", "#calibMark", null);
    $("#calibFill").style.width = "0%";
    $("#micTest").hidden = true;
    $("#btnChantStart").disabled = true;
    stopTest();

    // 실제로 연습할 때와 같은 조건을 만듭니다 (첫 응원 근처를 틀어줍니다)
    const at = list.length ? Math.max(0, list[0].time - 1) : 0;
    Audio9.load(song.audio, () => {});
    Audio9.play(at);

    await Voice.calibrate((p) => { $("#calibFill").style.width = (p * 100).toFixed(0) + "%"; });

    Audio9.stop();
    stepMark("#stepCalib", "#calibMark", "is-done");
    $("#calibDesc").textContent = "다 쟀습니다. 노래가 나올 때 기준으로 맞췄어요.";

    $("#micTest").hidden = false;
    $("#btnChantStart").disabled = false;
    testLoop();
  }

  /* ---- 마이크가 여러 개면 고를 수 있게 ----
     윈도우에서는 크롬이 엉뚱한 입력 장치를 잡는 일이 흔합니다.
     권한은 멀쩡히 받았는데 소리가 하나도 안 들어오면 대부분 이 경우예요. */
  async function fillMicList() {
    let mics = [];
    try { mics = await Voice.listMics(); } catch (e) { return; }
    if (mics.length < 2) { $("#micPickBox").hidden = true; return; }

    const sel = $("#micPick");
    sel.replaceChildren();
    mics.forEach((m) => {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.label;
      sel.appendChild(o);
    });
    if (Voice.currentId()) sel.value = Voice.currentId();
    $("#micPickBox").hidden = false;
  }

  async function switchMic() {
    const id = $("#micPickBox").hidden ? "" : $("#micPick").value;
    stopTest();
    Voice.close();
    try {
      await Voice.open(id, $("#micNoAec").checked);
    } catch (e) {
      stepMark("#stepMic", "#micMark", "is-ng");
      $("#readyError").innerHTML = micErrorHtml(e);
      $("#readyError").hidden = false;
      return;
    }
    $("#readyError").hidden = true;
    await measureAndTest();
  }

  function paintAdjustLabel() {
    const v = Number($("#micAdjust").value);
    $("#micAdjustVal").textContent =
      v <= -6 ? "많이 민감" : v < 0 ? "민감" : v === 0 ? "보통" : v < 6 ? "둔감" : "많이 둔감";
  }

  /* ---- 타이밍 미세조정 ----
     슬라이더 값은 1/100초 단위입니다. */
  function paintTuneLabels() {
    const off = tune.offset;
    $("#timeAdjustVal").textContent = (off >= 0 ? "+" : "−") + Math.abs(off).toFixed(2) + "초";
    $("#tolAdjustVal").textContent = "±" + tune.tol.toFixed(2) + "초";
  }

  function fillTuneInputs() {
    $("#timeAdjust").value = String(Math.round(tune.offset * 100));
    $("#tolAdjust").value = String(Math.round(tune.tol * 100));
    paintTuneLabels();
  }

  function onTuneChange() {
    tune.offset = Number($("#timeAdjust").value) / 100;
    tune.tol = Number($("#tolAdjust").value) / 100;
    saveTune();
    paintTuneLabels();
  }

  /* ---- 시작 ---- */
  function start(s, m) {
    song = s;
    mode = m || mode || "typing";
    method = methodOf(mode);
    stopTest();
    closeVideo();
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
    onsetLog = [];
    lastEnd = 0;
    paused = false;
    $("#pauseModal").hidden = true;

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
    input.value = "";
    method.enter();            // 입력 방식마다 다른 화면 준비
    $("#chantSlot").classList.remove("is-live", "is-soon");
    setLive(false);

    Audio9.load(s.audio, () => { $("#chantNoAudio").hidden = false; });
    Audio9.play(0);

    tick();
  }

  /** 결과 화면의 "다시하기" — 방금 하던 방식 그대로 */
  function retry() {
    if (!song) return;
    // 음성인데 마이크가 닫혔으면 준비 화면부터 다시
    if (mode === "voice" && !Voice.opened) { toReady(); return; }
    start(song, mode);
  }

  /** 응원법에서 아주 빠져나갈 때 (곡 바꾸기 등) */
  function release() {
    stopTest();
    closeVideo();
    Voice.close();
  }

  /* ---- 화면 전환 (대기 ↔ 구간) ---- */
  /* 기다리는 동안에도 응원 문구를 같은 자리에 미리 띄워둡니다.
     구간이 뜰 때 글자가 새로 생기지 않으니 자리가 안 튑니다. */
  function preview() {
    if (idx >= list.length) { elLine.textContent = ""; return; }
    if (isBeat()) method.setText(list[idx].text, 0);
    else renderTypingCells(elLine, list[idx].text, "", false);
  }

  function setLive(on) {
    live = on;
    $("#chantSlot").classList.toggle("is-live", on);
    if (on) {
      if (mode === "typing") renderTypingCells(elLine, list[idx].text, "", false);
      method.onLiveStart(list[idx]);
    } else {
      method.onLiveEnd();
      $("#chantSlot").classList.remove("is-soon");
      preview();
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
    if (resolved || !live || idx >= list.length) return;
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
    // 다음 구간이 이 시각부터 뜰 수 있습니다 (예정 마감까지 안 기다립니다)
    lastEnd = Audio9.time;
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

    /* 멈춰 있는 동안에는 판정을 하지 않습니다.
       다만 음성이면 소리 크기는 계속 재줍니다 — 멈춘 김에
       민감도를 맞춰보려면 게이지가 살아 있어야 하니까요. */
    if (paused) {
      if (mode === "voice") {
        Voice.update();
        Voice.paintGauge($("#pauseBar"), $("#pauseZone"), $("#pauseHint"));
        paintPauseRead();
      }
      return;
    }

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

    // 입력 방식에게 넘깁니다.
    // 두 번째 값이 true 일 때만 성공으로 쳐줍니다 (준비 시간에는 안 쳐줍니다)
    if (running && idx < list.length) {
      method.onFrame(now, live && !resolved && judgingNow(now));
    }
    paint(now);
  }

  function tick() {
    if (!running) return;
    step();
    raf = requestAnimationFrame(tick);
  }

  /* 줄이 넘어갈 때 한 칸 위로 밀어 올립니다.
     같은 애니메이션을 다시 돌리려면 클래스를 뗐다 붙여야 합니다.

     끝나면 반드시 떼둡니다. 창이 가려져 애니메이션이 아예 안 도는 경우가
     있는데, 그때 클래스가 남아 있으면 가사가 15px 내려간 채로 굳습니다.
     그래서 animationend 만 믿지 않고 시계로도 같이 떼어냅니다. */
  let stepTimer = null;
  function stepLyrics() {
    const box = $(".chant-lyrics");
    box.classList.remove("is-step");
    void box.offsetWidth;
    box.classList.add("is-step");
    if (stepTimer) clearTimeout(stepTimer);
    stepTimer = setTimeout(() => box.classList.remove("is-step"), 400);
  }

  /* ---- ① 가사 세 줄 ----
     지금 노래가 어느 줄을 부르고 있는지 보여줍니다. 치는 건 아닙니다.
     유튜브 가사 영상처럼 지금 줄만 또렷하고, 넘어갈 때 위로 밀려 올라갑니다. */
  function paintLyrics(now) {
    if (words.length === 0) return;

    // 지금 줄 찾기 (앞뒤로 움직여도 맞게)
    let i = wordIdx;
    while (i + 1 < words.length && words[i + 1].time <= now) i++;
    while (i >= 0 && words[i].time > now) i--;

    if (i !== wordIdx) {
      const forward = i === wordIdx + 1;      // 한 줄 넘어간 경우에만 밀어 올립니다
      wordIdx = i;
      $("#chantLyricPrev").textContent = i > 0 ? words[i - 1].text : "";
      $("#chantLyricNow").textContent = i >= 0 ? words[i].text : "";
      $("#chantLyricNext").textContent = words[i + 1] ? words[i + 1].text : "";

      if (forward) stepLyrics();
    }
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
      const from = showAtOf(idx);
      const to = deadlineOf(idx);
      const span = Math.max(0.01, to - from);

      if (isBeat()) {
        /* 음성·키보드는 "언제 시작하는가" 가 전부라서, 남은 시간보다
           <외쳐야 하는 순간> 을 보여주는 게 훨씬 도움이 됩니다.
           초록 구간에 현재 위치 선이 들어왔을 때 지르면 됩니다. */
        const target = atOf(idx);
        const pct = (t) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
        const a = pct(target - tune.tol);
        const b = pct(target + tune.tol);
        $("#chantTimerHit").style.left = a.toFixed(1) + "%";
        $("#chantTimerHit").style.width = (b - a).toFixed(1) + "%";
        $("#chantTimerNow").style.left = pct(now).toFixed(1) + "%";
        $("#chantTimer").classList.toggle("is-now", now >= target - tune.tol && now <= target + tune.tol);
      } else {
        // 타이핑 : 남은 시간 막대
        const left = Math.max(0, Math.min(1, (to - now) / span));
        const bar = $("#chantTimerBar");
        bar.style.transform = "scaleX(" + left + ")";
        bar.classList.toggle("is-hurry", left < 0.3);
      }
    } else {
      // 기다리는 동안 : 남은 시간. (외칠 말은 setLive 에서 이미 띄워뒀습니다)
      const wait = Math.max(0, showAtOf(idx) - now);
      $("#chantCountdown").textContent = (wait < 10 ? wait.toFixed(1) : Math.round(wait)) + "초";
      // 1.5초 안쪽으로 들어오면 또렷하게 (준비 신호)
      $("#chantSlot").classList.toggle("is-soon", wait < 1.5);
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
    const voice = mode === "voice";

    $("#screen-chant-result .page-head__eyebrow").textContent =
      mode === "key" ? "응원법 박자 테스트 결과"
      : voice ? "응원법 외치기 결과" : "응원법 타이핑 결과";
    $("#chantResultTitle").textContent = song.title;
    $("#chantRate").textContent = rate + "%";
    $("#crOk").textContent = stat.ok;
    $("#crMiss").textContent = stat.miss;
    $("#crTotal").textContent = total;

    const prev = loadBest(song.id, mode);
    const isBest = !prev || rate > prev.rate;
    if (isBest) saveBest(song.id, mode, { rate: rate, ok: stat.ok, total: total });
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
      modeLabel: voice ? "응원법 외치기 🎤" : "응원법 타이핑",
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
      shareText: "fromis_9 «" + song.title + "» 응원법" + (voice ? " 외치기" : "") +
                 " " + rate + "% (" + stat.ok + "/" + total + ")\n" +
                 "https://typingfromis9.kr\n#fromis_9 #프로미스나인 #플로버"
    });

    // 키보드 모드는 타이밍을 확인해보는 용도라 랭킹에 올리지 않습니다
    if (mode === "key") {
      $("#submitChant").hidden = true;
      paintTuneBox(); paintVideoBtns(); pickResultArt("#artChant");
      showScreen("screen-chant-result");
      return;
    }

    Ranking.offer({
      mode: "chant",
      input: mode,               // 음성과 타이핑은 순위를 따로 매깁니다
      songId: song.id,
      rate: rate,
      hits: stat.ok,
      total: total,
      misses: stat.miss
    });

    paintTuneBox();
    paintVideoBtns();          // 결과 화면에서도 영상을 다시 볼 수 있게
    pickResultArt("#artChant");
    showScreen("screen-chant-result");
  }

  /* =====================================================================
     타이밍 다듬기
     ---------------------------------------------------------------------
     한 판 하는 동안 구간마다 "실제로 언제 소리를 냈는지" 를 재뒀습니다.
     그 차이에는 두 가지가 섞여 있습니다.

       ① 내 습관    — 반주를 듣고 소리를 내기까지 걸리는 시간.
                      모든 구간에 똑같이 깔립니다. 사람마다 다릅니다.
       ② 데이터 오차 — 그 구간의 time 을 잘못 찍은 것.
                      그 구간에만 나타납니다.

     ①은 <가운데값(median)> 입니다. 모든 구간에 공통으로 깔린 값이니까요.
     그걸 빼고 남는 게 ②입니다.

     이 둘을 갈라놓는 게 중요합니다. 내 습관까지 곡 데이터에 반영해버리면
     다른 사람한테는 오히려 어긋난 데이터가 되기 때문입니다.
     ①은 내 보정값으로, ②만 songs.js 로 갑니다. */

  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  function tuneReport() {
    if (!isBeat() || onsetLog.length < 4) return null;
    const bias = median(onsetLog.map((o) => o.raw));
    const off = onsetLog
      .map((o) => ({ i: o.i, resid: o.raw - bias }))
      .filter((r) => Math.abs(r.resid) >= 0.12)      // 이 정도는 그냥 사람 편차
      .sort((a, b) => Math.abs(b.resid) - Math.abs(a.resid));
    return { bias: bias, off: off, n: onsetLog.length };
  }

  function paintTuneBox() {
    const box = $("#tuneBox");
    // 곡 데이터를 고치는 기능이라 나 전용입니다
    if (!isDev()) { box.hidden = true; return; }
    const rep = tuneReport();
    if (!rep) { box.hidden = true; return; }
    box.hidden = false;

    const b = rep.bias;
    $("#tuneBias").textContent =
      Math.abs(b) < 0.05
        ? "박자는 잘 맞고 있어요"
        : "전체적으로 " + Math.abs(b).toFixed(2) + "초 " + (b > 0 ? "늦게" : "빨리") + " 외치고 있어요";
    $("#btnApplyBias").disabled = false;
    $("#btnApplyBias").textContent = "보정값에 반영";

    $("#tuneOffBox").hidden = rep.off.length === 0;
    if (rep.off.length === 0) return;

    const box2 = $("#tuneList");
    box2.replaceChildren();
    rep.off.slice(0, 10).forEach((r) => {
      const row = document.createElement("div");
      row.className = "tune-item";
      const t = document.createElement("i");
      t.textContent = fmtMmSs(list[r.i].time);
      const txt = document.createElement("span");
      txt.textContent = list[r.i].text;
      const d = document.createElement("b");
      d.textContent = (r.resid > 0 ? "+" : "−") + Math.abs(r.resid).toFixed(2) + "초";
      d.className = r.resid > 0 ? "is-late" : "is-early";
      row.append(t, txt, d);
      box2.appendChild(row);
    });
    $("#tuneMsg").textContent = "어긋난 곳 " + rep.off.length + "군데";
  }

  /** 고친 시각으로 chants: 배열을 통째로 만들어 줍니다 (songs.js 에 붙여넣기) */
  function correctedChants() {
    const rep = tuneReport();
    if (!rep) return "";
    const fix = {};
    rep.off.forEach((r) => { fix[r.i] = r.resid; });

    const lines = list.map((c, i) => {
      const t = fix[i] ? c.time + fix[i] : c.time;
      const mark = fix[i]
        ? "   // " + (fix[i] > 0 ? "+" : "−") + Math.abs(fix[i]).toFixed(2) + " 옮김"
        : "";
      return "      { time: " + t.toFixed(2) + ', text: "' +
             String(c.text).replace(/"/g, '\\"') + '" }' +
             (i < list.length - 1 ? "," : "") + mark;
    });
    return "    chants: [\n" + lines.join("\n") + "\n    ]";
  }

  /* =====================================================================
     잠깐 멈춤
     ---------------------------------------------------------------------
     노래와 판정을 같이 멈춥니다. 시각은 Audio9 에서 그대로 가져오므로
     멈춰 있는 동안 시간이 흐르지 않고, 이어서 하면 그 자리부터 계속됩니다.

     멈춘 김에 민감도와 인정 범위를 맞춰볼 수 있게 해뒀습니다.
     연습하다가 "안 먹네" 싶을 때 처음부터 다시 할 필요가 없도록요. */

  function paintPauseRead() {
    const el = $("#pauseRead");
    if (Voice.isSilent()) {
      el.textContent = "마이크에서 소리가 들어오지 않습니다.";
      el.className = "mic-read is-ng";
    } else {
      el.textContent = "조용할 때 " + Voice.noiseFloor.toFixed(0) +
        " · 지금 " + Voice.level.toFixed(0) +
        " · 넘어야 하는 값 " + Voice.threshold().toFixed(0) + " dB";
      el.className = "mic-read";
    }
  }

  function paintPauseLabels() {
    const v = Number($("#pauseMic").value);
    $("#pauseMicVal").textContent =
      v <= -6 ? "많이 민감" : v < 0 ? "민감" : v === 0 ? "보통" : v < 6 ? "둔감" : "많이 둔감";
    $("#pauseTolVal").textContent = "±" + tune.tol.toFixed(2) + "초";
    $("#pauseOffsetVal").textContent =
      (tune.offset >= 0 ? "+" : "−") + Math.abs(tune.offset).toFixed(2) + "초";
  }

  function pause() {
    if (!running || paused) return;
    paused = true;
    Audio9.pause();
    // 멈춰 있는 동안 친 글자가 이어서 할 때 튀어나오지 않게
    if (mode === "typing") { input.value = ""; composing = false; input.disabled = true; }

    const isVoice = mode === "voice";
    $("#pauseVoiceBox").hidden = !isVoice;
    $("#pauseTimingBox").hidden = !isDev();
    if (isVoice) {
      $("#pauseMic").value = String(Voice.getAdjust());
      $("#pauseTol").value = String(Math.round(tune.tol * 100));
      $("#pauseOffset").value = String(Math.round(tune.offset * 100));
      paintPauseLabels();
    }
    $("#pauseModal").hidden = false;
  }

  function resume() {
    if (!paused) return;
    $("#pauseModal").hidden = true;
    paused = false;
    // 멈춰 있던 동안 흐른 실제 시간은 없던 것으로 (안 그러면 한 박자 튑니다)
    if (method && method.onResume) method.onResume();
    if (mode === "typing" && live) {
      input.disabled = false;
      input.value = "";
      input.focus();
    }
    Audio9.resume();
  }

  function quit() {
    running = false;
    paused = false;
    $("#pauseModal").hidden = true;
    Audio9.stop();
    setStageBg("");
    if (raf) cancelAnimationFrame(raf);
    if (verdictTimer) clearTimeout(verdictTimer);
    release();
  }

  /* ---- 입력 (타이핑 모드) ---- */
  function onInput() {
    if (!running || !live || mode !== "typing") return;
    if (input.value.length > list[idx].text.length) {
      input.value = input.value.slice(0, list[idx].text.length);
    }
    renderTypingCells(elLine, list[idx].text, input.value, composing);

    // 다 쳤는지 표시만 해둡니다.
    // 실제 성공 처리는 응원 시각(time)이 됐을 때 step() 이 합니다.
    Typing.ready = !composing && sameLine(input.value, list[idx].text);
    if (Typing.ready && judgingNow(Audio9.time)) hit();
  }

  /* 구간이 아닐 때 새어 들어온 글자는 그 자리에서 지웁니다.
     (입력창을 disabled 로 이미 잠그지만, 조합 처리는 브라우저마다 달라서 한 번 더) */
  const blocked = () => !running || paused || !live || mode !== "typing";

  input.addEventListener("compositionstart", () => {
    if (blocked()) { input.value = ""; return; }
    composing = true;
  });
  input.addEventListener("compositionupdate", () => {
    if (blocked()) { input.value = ""; composing = false; return; }
    composing = true;
    renderTypingCells(elLine, list[idx].text, input.value, true);
  });
  input.addEventListener("compositionend", () => {
    if (blocked()) { input.value = ""; composing = false; return; }
    composing = false;
    onInput();
  });
  input.addEventListener("input", (e) => {
    if (blocked()) { input.value = ""; composing = false; return; }
    if (e.isComposing || composing) {
      renderTypingCells(elLine, list[idx].text, input.value, true);
      return;
    }
    onInput();
  });
  input.addEventListener("keydown", (e) => {
    if (blocked() && e.key !== "Escape") { e.preventDefault(); return; }
    if (e.key === "Enter") e.preventDefault();
    // Esc 는 아래 문서 전체 처리에서 "잠깐 멈춤" 으로 받습니다
  });

  // 화면 아무 데나 눌러도 입력창에 포커스가 돌아오게 (타이핑 모드만)
  $("#screen-chant").addEventListener("mousedown", (e) => {
    if (mode !== "typing" || input.disabled || e.target.tagName === "BUTTON") return;
    setTimeout(() => input.focus(), 0);
  });

  // 화면이 가려지면 rAF 가 멈추므로 오디오 이벤트로도 확인합니다
  Audio9.el.addEventListener("timeupdate", () => { if (running) step(); });

  /* ---- 키보드 모드 : 스페이스를 "소리" 로 씁니다 ---- */
  document.addEventListener("keydown", (e) => {
    if (mode !== "key" || currentScreen !== "screen-chant") return;
    if (e.key === " ") { e.preventDefault(); spaceDown = true; }
  });
  document.addEventListener("keyup", (e) => {
    if (mode !== "key") return;
    if (e.key === " ") { e.preventDefault(); spaceDown = false; }
  });

  /* ---- 준비 화면 · 영상 창 버튼들 ---- */
  $("#btnHowVoice").addEventListener("click", toReady);
  $("#btnHowTyping").addEventListener("click", () => start(song, "typing"));
  $("#btnHowKey").addEventListener("click", () => start(song, "key"));
  $("#btnBackToChantSongs").addEventListener("click", () => {
    release();
    setStageBg("");
    showScreen("screen-chant-select");
  });
  $("#btnChantStart").addEventListener("click", () => start(song, "voice"));
  $("#btnReadyToTyping").addEventListener("click", () => { release(); start(song, "typing"); });
  /* ---- 잠깐 멈춤 ---- */
  $("#btnPauseChant").addEventListener("click", pause);
  $("#btnPauseResume").addEventListener("click", resume);
  $("#btnPauseQuit").addEventListener("click", () => {
    quit();
    showScreen("screen-chant-select");
  });
  $("#pauseMic").addEventListener("input", () => {
    Voice.setAdjust(Number($("#pauseMic").value));
    paintPauseLabels();
  });
  $("#pauseTol").addEventListener("input", () => {
    tune.tol = Number($("#pauseTol").value) / 100;
    saveTune();
    paintPauseLabels();
  });
  $("#pauseOffset").addEventListener("input", () => {
    tune.offset = Number($("#pauseOffset").value) / 100;
    saveTune();
    paintPauseLabels();
  });
  // 연습 중 Esc 로도 멈춥니다
  document.addEventListener("keydown", (e) => {
    if (currentScreen !== "screen-chant" || !running) return;
    if (e.key === "Escape") { e.preventDefault(); paused ? resume() : pause(); }
  });

  $("#micPick").addEventListener("change", switchMic);
  $("#micNoAec").addEventListener("change", switchMic);
  $("#micAdjust").addEventListener("input", () => {
    Voice.setAdjust(Number($("#micAdjust").value));
    paintAdjustLabel();
  });
  $("#timeAdjust").addEventListener("input", onTuneChange);
  $("#tolAdjust").addEventListener("input", onTuneChange);

  /* ---- 결과 화면의 타이밍 다듬기 ---- */
  $("#btnApplyBias").addEventListener("click", () => {
    const rep = tuneReport();
    if (!rep) return;
    // 내 습관만큼 판정을 밀어줍니다 (슬라이더 범위 안으로)
    tune.offset = Math.max(-0.6, Math.min(0.6, Math.round(rep.bias * 20) / 20));
    saveTune();
    $("#btnApplyBias").textContent = "반영했어요 (" +
      (tune.offset >= 0 ? "+" : "−") + Math.abs(tune.offset).toFixed(2) + "초)";
    $("#btnApplyBias").disabled = true;
  });

  $("#btnCopyChants").addEventListener("click", async () => {
    const text = correctedChants();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      $("#tuneMsg").textContent = "복사했어요. songs.js 의 chants 자리에 덮어쓰세요.";
    } catch (e) {
      // 클립보드가 막힌 환경에서는 직접 고를 수 있게 펼쳐줍니다
      const ta = document.createElement("textarea");
      ta.className = "tune-out";
      ta.value = text;
      ta.readOnly = true;
      $("#tuneOffBox").appendChild(ta);
      ta.select();
      $("#tuneMsg").textContent = "아래 내용을 직접 복사하세요.";
    }
  });
  $("#btnChantVideo1").addEventListener("click", openVideo);
  $("#btnChantVideoResult").addEventListener("click", openVideo);
  $("#btnVideoClose").addEventListener("click", closeVideo);
  $("#btnVidHere").addEventListener("click", () => {
    if (!ytPlayer || !ytPlayer.getCurrentTime) return;
    paintVidCode(Math.max(0, Math.floor(ytPlayer.getCurrentTime())));
  });
  $("#btnVidReset").addEventListener("click", () => paintVidCode(0));
  $("#videoModal").addEventListener("mousedown", (e) => {
    if (e.target.id === "videoModal") closeVideo();     // 바깥을 누르면 닫기
  });

  return {
    renderSongList, choose, start, retry, quit, release,
    getSong: () => song,
    getMode: () => mode
  };
})();

/* ======================= 5-z. 싱크 조정 (나 전용) =======================

   따로 만든 도구(lyrics-timer / lyrics-tuner)에서 맞추고 오면 싱크가
   어긋나는 문제가 있었습니다. 도구는 파일을 통째로 받아서(blob) 재생하고
   게임은 mp3 를 그대로 재생하는 등, 오디오를 다루는 방식이 다릅니다.

   그래서 여기서는 <게임이 실제로 쓰는 그 재생기(Audio9)> 로 맞춥니다.
   맞춘 값은 곧바로 게임 데이터에 반영되니 그 자리에서 확인할 수 있습니다.
   (영구 저장은 코드를 복사해서 songs.js 에 붙여넣기)

   여는 법 : 주소 뒤에 #tune 을 붙이거나, features.js 의 devTune 을 켜면
             시작 화면 아래에 링크가 생깁니다.
   ======================================================================= */

const Tune = (() => {
  let song = null;
  let kind = "lyrics";          // "lyrics" | "chants"
  let rows = [];                // 지금 고치고 있는 배열 (SONGS 안의 그 배열입니다)
  let orig = [];                // 처음 값 (되돌리기용)
  let sel = 0;                  // 고른 줄
  let taps = {};                // { 줄번호: 찍은 시각 }
  let bulk = 0;                 // 전체 밀기로 옮긴 누적 값 (표시용)
  let raf = null;

  const listOf = () => (song ? song[kind] || [] : []);

  function fillSongs() {
    const box = $("#tuneSong");
    const keep = box.value;
    box.replaceChildren();
    orderedSongs().forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.title +
        "  (가사 " + ((s.lyrics || []).length) + " · 응원 " + ((s.chants || []).length) + ")";
      box.appendChild(o);
    });
    if (keep) box.value = keep;
  }

  function loadSong() {
    song = SONGS.find((s) => s.id === $("#tuneSong").value) || SONGS[0];
    Audio9.stop();
    Audio9.load(song.audio, () => {});
    setKind(kind);
  }

  /* ---- 목록 그리기 ---- */
  function render() {
    const box = $("#tuneRows");
    box.replaceChildren();

    if (rows.length === 0) {
      box.innerHTML = '<p class="rank-empty">이 곡에는 ' +
        (kind === "lyrics" ? "가사" : "응원법") + "가 아직 없습니다.</p>";
      paintTapBox();
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "tune-row2" + (i === sel ? " is-sel" : "") + (taps[i] != null ? " is-tapped" : "");

      const t = document.createElement("b");
      t.className = "tune-row2__t";
      t.textContent = r.time.toFixed(2);

      const tx = document.createElement("span");
      tx.className = "tune-row2__x";
      tx.textContent = r.text;

      // 처음 값과 달라졌으면 얼마나 옮겼는지
      const d = r.time - (orig[i] ? orig[i].time : r.time);
      const diff = document.createElement("i");
      diff.className = "tune-row2__d";
      if (Math.abs(d) > 0.001) {
        diff.textContent = (d > 0 ? "+" : "−") + Math.abs(d).toFixed(2);
        diff.classList.add(d > 0 ? "is-late" : "is-early");
      }

      const acts = document.createElement("span");
      acts.className = "tune-row2__acts";
      [["−.05", -0.05], ["+.05", 0.05]].forEach((pair) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mini";
        b.textContent = pair[0];
        b.addEventListener("click", (e) => { e.stopPropagation(); sel = i; nudge(pair[1]); });
        acts.appendChild(b);
      });
      const play = document.createElement("button");
      play.type = "button";
      play.className = "mini mini--play";
      play.textContent = "▶";
      play.title = "이 줄 들어보기";
      play.addEventListener("click", (e) => { e.stopPropagation(); sel = i; preview(); });
      acts.appendChild(play);

      row.addEventListener("click", () => { sel = i; render(); });
      row.append(t, tx, diff, acts);
      frag.appendChild(row);
    });
    box.appendChild(frag);

    const cur = box.children[sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
    paintShift();
    paintTapBox();
  }

  /* ---- 한 줄 미세조정 ---- */
  function nudge(d) {
    if (!rows[sel]) return;
    rows[sel].time = Math.max(0, Math.round((rows[sel].time + d) * 100) / 100);
    render();
  }

  /* ---- 전체 밀기 ----
     곡이 통째로 어긋났을 때 한 줄씩 옮기는 건 말이 안 되니까요.
     "고른 줄부터만" 을 켜면 그 줄 아래로만 옮깁니다.
     (노래 중간부터 조금씩 밀리는 경우에 씁니다) */
  function shiftAll(d) {
    if (rows.length === 0) return;
    const from = $("#tuneShiftFrom").checked ? sel : 0;
    for (let i = from; i < rows.length; i++) {
      rows[i].time = Math.max(0, Math.round((rows[i].time + d) * 100) / 100);
    }
    bulk = Math.round((bulk + d) * 100) / 100;
    render();
  }

  /** 그 줄 앞뒤를 잠깐 들려줍니다 (제 시각에 시작하는지 귀로 확인) */
  function preview() {
    if (!rows[sel]) return;
    Audio9.playSegment(Math.max(0, rows[sel].time - 1.2), 2.6);
  }

  function toggle() {
    if (Audio9.paused) Audio9.play(rows[sel] ? Math.max(0, rows[sel].time - 2) : 0);
    else Audio9.pause();
  }

  /* ---- Space 로 찍기 ----
     재생 중에 누르면, 지금 시각에서 가장 가까운 줄에 기록합니다. */
  function tap() {
    if (Audio9.paused || rows.length === 0) return;
    const now = Audio9.time;
    let best = -1, bestD = 9;
    rows.forEach((r, i) => {
      const d = Math.abs(r.time - now);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0 || bestD > 2.0) return;      // 너무 먼 곳은 무시
    taps[best] = now;
    sel = best;
    render();
  }

  function paintShift() {
    $("#tuneShiftVal").textContent =
      (bulk > 0 ? "+" : bulk < 0 ? "−" : "") + Math.abs(bulk).toFixed(2) + "초";
    $("#tuneShiftVal").className = "tune-shift__val" +
      (bulk > 0 ? " is-late" : bulk < 0 ? " is-early" : "");
  }

  const median = (a) => {
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const tapKeys = () => Object.keys(taps).map(Number);

  function paintTapBox() {
    const keys = tapKeys();
    $("#tuneTapBox").hidden = keys.length === 0;
    if (keys.length === 0) return;
    const bias = median(keys.map((i) => taps[i] - rows[i].time));
    $("#tuneTapMsg").innerHTML =
      "<b>" + keys.length + "줄</b> 찍었습니다. 누르는 습관이 평균 " +
      (bias >= 0 ? "+" : "−") + Math.abs(bias).toFixed(2) + "초 — " +
      "<b>이 습관은 빼고</b> 줄마다 어긋난 만큼만 옮깁니다.";
    $("#btnTuneApplyTaps").disabled = keys.length < 3;
  }

  /* ---- 찍은 대로 맞추기 ----
     누르는 반응 속도(모든 줄에 공통으로 깔린 값)는 빼고,
     줄마다 남는 차이만 반영합니다. 안 그러면 내 반응 속도가
     곡 데이터에 통째로 박혀버립니다. */
  function applyTaps() {
    const keys = tapKeys();
    if (keys.length < 3) return;
    const bias = median(keys.map((i) => taps[i] - rows[i].time));
    keys.forEach((i) => {
      const resid = (taps[i] - rows[i].time) - bias;
      if (Math.abs(resid) >= 0.02) {
        rows[i].time = Math.max(0, Math.round((rows[i].time + resid) * 100) / 100);
      }
    });
    taps = {};
    render();
  }

  function code() {
    const lines = rows.map((r, i) =>
      "      { time: " + r.time.toFixed(2) + ', text: "' +
      String(r.text).replace(/"/g, '\\"') + '" }' + (i < rows.length - 1 ? "," : ""));
    return "    " + kind + ": [\n" + lines.join("\n") + "\n    ]";
  }

  async function copyCode() {
    const text = code();
    try {
      await navigator.clipboard.writeText(text);
      $("#tuneOut").hidden = true;
      $("#btnTuneCopy").textContent = "복사했어요";
      setTimeout(() => { $("#btnTuneCopy").textContent = "코드 복사"; }, 1600);
    } catch (e) {
      const ta = $("#tuneOut");
      ta.value = text;
      ta.hidden = false;
      ta.select();
    }
  }

  function revert() {
    rows.forEach((r, i) => { if (orig[i]) r.time = orig[i].time; });
    taps = {};
    bulk = 0;
    render();
  }

  function tick() {
    if (currentScreen !== "screen-tune") { raf = null; return; }
    const t = Audio9.time;
    $("#tuneClock").textContent = fmtMmSs(t) + "." + String(Math.floor((t % 1) * 10));
    $("#btnTunePlay").textContent = Audio9.paused ? "▶ 재생" : "❚❚ 정지";
    raf = requestAnimationFrame(tick);
  }

  function setKind(k) {
    kind = k;
    $("#tuneKindLyrics").classList.toggle("is-on", k === "lyrics");
    $("#tuneKindChants").classList.toggle("is-on", k === "chants");
    rows = listOf();
    orig = rows.map((r) => ({ time: r.time, text: r.text }));
    sel = 0;
    taps = {};
    bulk = 0;
    render();
  }

  function open() {
    fillSongs();
    loadSong();
    showScreen("screen-tune");
    if (!raf) tick();
  }

  function init() {
    $("#tuneSong").addEventListener("change", loadSong);
    $("#tuneKindLyrics").addEventListener("click", () => setKind("lyrics"));
    $("#tuneKindChants").addEventListener("click", () => setKind("chants"));
    $("#btnTunePlay").addEventListener("click", toggle);
    $("#btnTuneApplyTaps").addEventListener("click", applyTaps);
    $("#btnTuneClearTaps").addEventListener("click", () => { taps = {}; render(); });
    $("#tuneShiftBtns").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-d]");
      if (b) shiftAll(parseFloat(b.dataset.d));
    });
    $("#btnTuneCopy").addEventListener("click", copyCode);
    $("#btnTuneRevert").addEventListener("click", revert);
    $("#btnTuneHome").addEventListener("click", () => { Audio9.stop(); goHome(); });

    document.addEventListener("keydown", (e) => {
      if (currentScreen !== "screen-tune") return;
      if (e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === " ")          { e.preventDefault(); tap(); }
      if (e.key === "ArrowUp")    { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      if (e.key === "ArrowDown")  { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); render(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); e.shiftKey ? shiftAll(-0.05) : nudge(-0.05); }
      if (e.key === "ArrowRight") { e.preventDefault(); e.shiftKey ? shiftAll(0.05) : nudge(0.05); }
      if (e.key === "Enter")      { e.preventDefault(); preview(); }
      if (e.key === "Escape")     { e.preventDefault(); Audio9.pause(); }
    });
  }

  return { init, open };
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
      body.input = rec.input === "voice" ? "voice" : "typing";
    }
    const res = await fetch(apiBase() + "/scores", {
      method: "POST",
      headers: Object.assign(headers(), { "Prefer": "return=minimal" }),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("등록 실패 (" + res.status + ")");
  }

  async function fetchTop(mode, songId, inputKind) {
    // 응원법 전용 칸(rate/hits/total/input)은 응원법 조회에서만 요청합니다.
    // 안 그러면 그 칸을 아직 안 만든 상태에서 가사·퀴즈 랭킹까지 막힙니다.
    const cols = mode === "chant"
      ? "nickname,rate,hits,total,misses,input,created_at"
      : "nickname,cpm,accuracy,seconds,misses,created_at";

    let q = apiBase() + "/scores?select=" + cols +
            "&mode=eq." + mode + "&limit=" + (RANKING.topN || 20);
    q += mode === "quiz" ? "&order=seconds.asc"
       : mode === "chant" ? "&order=rate.desc,hits.desc"
       : "&order=cpm.desc";
    if (mode !== "quiz" && songId) q += "&song_id=eq." + encodeURIComponent(songId);
    // 외치기와 타이핑은 난이도가 달라서 순위를 섞지 않습니다
    if (mode === "chant" && inputKind) q += "&input=eq." + inputKind;
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
        ? " — 응원법 랭킹은 Supabase 에 SQL 을 실행해야 합니다. README 의 '응원법 랭킹 켜기' 두 곳을 봐주세요."
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

    // 응원법이면 방금 한 방식(외치기/타이핑)의 순위를 보여줍니다
    if (mode === "chant" && pending && pending.mode === "chant" && pending.input) {
      $("#rankInput").value = pending.input;
    }
    setMode(mode);
    if (songId) { $("#rankSong").value = songId; load(); }
  }

  function setMode(mode) {
    lastMode = mode;
    $("#tabQuiz").classList.toggle("is-on", mode === "quiz");
    $("#tabLyrics").classList.toggle("is-on", mode === "lyrics");
    $("#tabChant").classList.toggle("is-on", mode === "chant");
    $("#rankSong").hidden = mode === "quiz";
    $("#rankInput").hidden = !(mode === "chant" && feature("chantVoice"));
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

  /* 탭을 빠르게 바꾸면 먼저 보낸 요청이 나중에 도착할 수 있습니다.
     그러면 가사 기록을 응원법 모양으로 그려버리는 일이 생깁니다.
     그래서 번호를 매겨두고, 가장 마지막 요청의 답만 화면에 그립니다. */
  let loadSeq = 0;

  async function load() {
    const list = $("#rankList");
    const my = ++loadSeq;
    list.innerHTML = '<p class="rank-empty">불러오는 중…</p>';
    try {
      const songId = lastMode === "quiz" ? null : $("#rankSong").value;
      const inputKind = lastMode === "chant" && feature("chantVoice") ? $("#rankInput").value : null;
      const rows = await fetchTop(lastMode, songId, inputKind);
      if (my !== loadSeq) return;          // 그 사이에 다른 탭을 눌렀으면 버립니다
      paint(rows);
    } catch (e) {
      if (my !== loadSeq) return;
      // 응원법 랭킹은 Supabase 에 칸을 추가해야 동작합니다
      const extra = (lastMode === "chant" && /40[0-9]/.test(e.message))
        ? '<br /><span style="font-size:13px">응원법 랭킹을 쓰려면 Supabase 에서 SQL 을 실행해야 합니다.<br />' +
          'README 의 "응원법 랭킹 켜기" 와 "응원법 외치기 랭킹 켜기" 를 봐주세요.</span>'
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
        b.addEventListener("click", () => {
          rankReturn = currentScreen;      // 뒤로 가면 여기로 돌아옵니다
          openAt(mode);
        });
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
    $("#rankInput").addEventListener("change", load);
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
  rankReturn = null;
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

  /* ---- 싱크 조정 (나 전용) ----
     주소 뒤에 #tune 을 붙이면 열립니다. features.js 의 devTune 을 켜면
     시작 화면 아래에도 링크가 생깁니다. */
  Tune.init();
  $("#homeTuneLink").hidden = !isDev();
  $("#btnOpenTune").addEventListener("click", () => Tune.open());
  const openTuneIfHash = () => {
    // 주소로 켰을 때도 시작 화면 링크가 같이 보이게
    $("#homeTuneLink").hidden = !isDev();
    if (location.hash === "#tune") Tune.open();
  };
  window.addEventListener("hashchange", openTuneIfHash);
  openTuneIfHash();

  // ---- 응원법 모드 ----
  $("#btnModeChant").addEventListener("click", () => showScreen("screen-chant-select"));
  $("#btnQuitChant").addEventListener("click", () => { Chant.quit(); showScreen("screen-chant-select"); });
  $("#btnRetryChant").addEventListener("click", () => Chant.retry());
  $("#btnChangeChantSong").addEventListener("click", () => {
    Chant.release();
    setStageBg("");
    showScreen("screen-chant-select");
  });
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
