/*=====================================================================
  check IN EVENT  (즐겨찾기)

  이 파일은 "즐겨찾기" 입니다. 진짜 도구는 인터넷에서 받아옵니다.
  → 한 번만 넣어두면 끝. 업데이트는 저절로 됩니다.

  ※ 이 파일을 쓸 때는 이름을 "check IN EVENT.jsx" 로 바꿔서 넣으세요.
     창(Window) 메뉴에 뜨는 이름이 곧 파일 이름입니다.

  같이 있는 "설치방법.md" 를 보세요.
  (팀 도구 check IN_Tool 과 같은 방식입니다)
=====================================================================*/

(function (thisObj) {

/* ===================== 설정 =====================
   주소가 바뀌면 아래 URL 한 줄만 고치면 됩니다. */
var CFG = {
    URL     : "https://raw.githubusercontent.com/d1sdud/prizm-ae-tools/main/check-in-event-tool.jsx",
    CACHE   : "PRIZM_AE_Tools/check-in-event-tool.jsx",   // ~/Library/Caches/ 아래
    TIMEOUT : 15                                         // 초
};
/* ================================================ */


function q(s) { return '"' + String(s).replace(/(["\\$`])/g, "\\$1") + '"'; }

function cacheFile() {
    var base = Folder("~").fsName + "/Library/Caches/";
    var dir = new Folder(base + CFG.CACHE.split("/")[0]);
    if (!dir.exists) { dir.create(); }
    return new File(base + CFG.CACHE);
}

function readAll(f) {
    try {
        f.encoding = "UTF-8";
        if (!f.open("r")) { return null; }
        var s = f.read(); f.close();
        if (s && s.length && s.charCodeAt(0) === 0xFEFF) { s = s.substr(1); }
        return s;
    } catch (e) { try { f.close(); } catch (e2) {} return null; }
}

/* 애프터이펙트 자체 통신 기능은 https 를 못 읽습니다(암호화 미지원).
   그래서 맥에 기본으로 있는 curl 을 대신 부릅니다. */
function download(dest) {
    var tmp = new File(dest.fsName + ".new");
    var cmd = "/usr/bin/curl -fsSL --max-time " + CFG.TIMEOUT
            + " " + q(CFG.URL) + " -o " + q(tmp.fsName);
    try { system.callSystem(cmd); }
    catch (e) { return "인터넷에서 받지 못했습니다. (" + e.toString() + ")"; }

    if (!tmp.exists) { return "인터넷에서 받지 못했습니다."; }
    if (tmp.length < 200) { tmp.remove(); return "받은 파일이 이상합니다."; }

    /* 다 받은 뒤에만 갈아끼운다 — 받다 끊겨도 기존 것이 안 망가진다 */
    try {
        if (dest.exists) { dest.remove(); }
        tmp.rename(dest.name);
        return null;
    } catch (e2) { return "저장하지 못했습니다. (" + e2.toString() + ")"; }
}

function boot(host) {
    var cache = cacheFile();
    var netErr = download(cache);

    if (netErr && !cache.exists) {
        alert("도구를 열지 못했습니다.\n\n" + netErr + "\n\n"
            + "확인해 주세요\n"
            + "  · 인터넷이 연결돼 있는지\n"
            + "  · 애프터이펙트 환경 설정 > 스크립팅 및 표현식 에서\n"
            + "    “스크립트가 파일에 쓰고 네트워크에 액세스하도록 허용” 이 켜져 있는지");
        return;
    }

    var code = readAll(cache);
    if (!code || code.length < 200) {
        alert("도구 파일을 읽지 못했습니다.\n\n담당자에게 알려주세요.");
        return;
    }
    if (netErr) {
        alert("인터넷에서 최신본을 받지 못했습니다.\n지난번에 받아둔 것으로 엽니다.\n\n" + netErr);
    }

    try {
        PRIZM_HOST = host;
        eval(code);
        PRIZM_HOST = null;
    } catch (e) {
        PRIZM_HOST = null;
        alert("도구를 여는 중 문제가 생겼습니다.\n\n" + e.toString()
            + (e.line ? "  (" + e.line + "행)" : "")
            + "\n\n이 화면을 캡처해서 담당자에게 보내주세요.");
    }
}

boot(thisObj);

})(this);
