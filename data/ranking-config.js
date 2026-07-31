/* =========================================================================
   랭킹 설정 파일  —  Supabase 정보를 여기에 넣습니다.
   =========================================================================

   ★ 아직 설정 안 했으면 그냥 두세요.
     enabled 가 false 면 랭킹 기능만 조용히 숨겨지고,
     게임은 지금까지처럼 똑같이 동작합니다.

   설정하는 방법은 README.md 의 "랭킹 붙이기" 항목을 그대로 따라 하시면 됩니다.
   Supabase 화면에서 두 가지를 복사해 오면 끝이에요.

     1) Project URL   →  아래 url 에 붙여넣기
     2) anon public key →  아래 anonKey 에 붙여넣기

   ※ anon key 는 웹사이트 코드에 그대로 들어가는 "공개용 열쇠"입니다.
      남에게 보여도 되는 값이라 이렇게 적어둬도 괜찮습니다.
      (절대 넣으면 안 되는 건 service_role key 입니다. 그건 관리자 열쇠예요)
   ========================================================================= */

const RANKING = {
  // 랭킹 기능을 켤지 (Supabase 설정을 마친 뒤 true 로 바꾸세요)
  enabled: true,

  // 예) "https://abcdefghijk.supabase.co"
  url: "https://bqgrysoozgpycieopkry.supabase.co/rest/v1/",

  // 예) "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....."
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxZ3J5c29vemdweWNpZW9wa3J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0OTUzMjcsImV4cCI6MjEwMTA3MTMyN30.SLCJeS5T7xNCCwIsSYPzhjoH_7gtx5yil9OqhqsHOPw",

  // 랭킹에 보여줄 인원수
  topN: 20
};
