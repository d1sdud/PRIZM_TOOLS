/*=====================================================================
  check IN EVENT — 이벤트 영상 대판 조립 도구

  회차 피그마 주소를 붙여넣으면 이벤트 소스를 받아서 컴프에 깔아 줍니다.

  [쓰는 순서]
    1. 처음 한 번만 — 피그마 토큰을 넣고 [저장]
    2. 회차 피그마 주소를 붙여넣고 [불러오기]
    3. 영상에 넣을 이벤트를 위에서부터 순서대로 체크
    4. 나레이션을 들으면서 이벤트가 바뀌는 지점마다 컴프 마커를 찍습니다
       (재생 중 * 키. 이벤트 개수만큼, 마지막이 끝나는 지점에 하나 더 찍으면 더 정확)
    5. 타임라인에서 "본보기" 레이어를 하나 고르고 [조립]
       (그 레이어를 복제해서 쓰므로 인/아웃 애니메이션이 그대로 따라옵니다)
=====================================================================*/

(function (thisObj) {

var TOOL = "check IN EVENT";
var STORE = "PRIZM_EVENT";              // AE 환경설정에 값을 저장할 때 쓰는 이름
var SCALE = 3;                          // 360x640 피그마 프레임 → 1080x1920
var EVENT_RE = /이벤트|슬라이딩|쿠폰/;
var BG_RE = /^(BG|배경|Subtract|Rectangle|Ellipse)/i;

var state = { fileKey: null, events: [], dir: null };


/* ============ 작은 도구들 ============ */

function q(s) { return '"' + String(s).replace(/(["\\$`])/g, "\\$1") + '"'; }

function tmpFile(name) {
    var dir = new Folder(Folder.temp.fsName + "/PRIZM_EVENT");
    if (!dir.exists) { dir.create(); }
    return new File(dir.fsName + "/" + name);
}

function readAll(f) {
    try {
        f.encoding = "UTF-8";
        if (!f.open("r")) { return null; }
        var s = f.read(); f.close();
        if (s && s.charCodeAt(0) === 0xFEFF) { s = s.substr(1); }
        return s;
    } catch (e) { try { f.close(); } catch (e2) {} return null; }
}

/* 애프터이펙트 자체 통신 기능은 https 를 못 읽습니다(암호화 미지원).
   그래서 맥에 기본으로 있는 curl 을 대신 부릅니다.
   → 환경 설정 > 스크립팅 및 표현식 >
     "스크립트가 파일에 쓰고 네트워크에 액세스하도록 허용" 이 켜져 있어야 합니다. */
function curlJSON(url, token) {
    var out = tmpFile("res.json");
    var cmd = "/usr/bin/curl -fsSL --max-time 180"
            + " -H " + q("X-Figma-Token: " + token)
            + " " + q(url) + " -o " + q(out.fsName) + " ; echo CURL:$?";
    var log;
    try { log = String(system.callSystem(cmd)); }
    catch (e) { throw new Error("피그마에 연결하지 못했습니다. (" + e.toString() + ")"); }

    /* curl 은 실패해도 조용하고, 받다 만 파일은 그대로 남습니다.
       그걸 모르고 읽으면 "문자열 상수가 종결되지 않았습니다" 같은 엉뚱한 소리를 듣게 됩니다. */
    var code = log.match(/CURL:(\d+)/);
    if (code && code[1] !== "0") {
        throw new Error("피그마에서 받다가 끊겼습니다. (curl " + code[1] + ")\n\n"
            + log.replace(/CURL:\d+/, "").substr(0, 300));
    }

    var body = out.exists ? readAll(out) : null;
    if (!body) {
        throw new Error("피그마에서 아무것도 받지 못했습니다.\n\n확인해 주세요\n"
            + "  · 인터넷이 연결돼 있는지\n"
            + "  · 토큰이 맞는지 (피그마 > Settings > Personal access tokens)\n"
            + "  · 환경 설정 > 스크립팅 및 표현식 에서\n"
            + "    “스크립트가 파일에 쓰고 네트워크에 액세스하도록 허용” 이 켜져 있는지");
    }
    /* ExtendScript 에는 JSON.parse 가 없어서 eval 로 읽습니다.
       상대는 https 로 붙은 api.figma.com 이고, 토큰도 내 것이라 그대로 씁니다. */
    try { return eval("(" + body + ")"); }
    catch (e2) {
        throw new Error("피그마 응답을 읽지 못했습니다. (" + Math.round(body.length / 1024) + " KB)\n\n"
            + e2.toString() + "\n\n" + body.substr(0, 300));
    }
}

/* 주소에서 파일 키와 노드 번호를 뽑습니다.
   https://figma.com/design/<파일키>/이름?node-id=22004-12194 */
function parseFigmaUrl(url) {
    var key = url.match(/\/(?:design|file)\/([0-9a-zA-Z]{22,128})/);
    var node = url.match(/node-id=([0-9]+[-:][0-9]+)/);
    if (!key)  { throw new Error("주소에서 파일 키를 못 찾았습니다.\n피그마에서 회차 대지를 고르고 주소를 복사해 주세요."); }
    if (!node) { throw new Error("주소에 node-id 가 없습니다.\n피그마에서 회차 대지를 고른 뒤 주소를 복사해 주세요."); }
    return { key: key[1], node: node[1].replace("-", ":") };
}


/* ============ 피그마에서 이벤트 찾기 ============ */

function walk(node, hit) {
    hit(node);
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) { walk(kids[i], hit); }
}

/* 이벤트 프레임 안에서 내보낼 자식 레이어. 배경은 뺍니다.
   (피그마는 레이어를 숨겨서 내보낼 수 없지만, 자식만 따로 내보내면
    배경은 형제라서 자연히 빠집니다 — 손으로 껐다 켰다 하던 것과 같은 결과) */
function eventLayers(frame) {
    var box = frame.absoluteBoundingBox, out = [];
    var kids = frame.children || [];
    for (var i = 0; i < kids.length; i++) {
        var c = kids[i], cb = c.absoluteBoundingBox;
        if (!cb || c.visible === false || BG_RE.test(c.name)) { continue; }
        if (cb.width >= box.width && cb.height >= box.height) { continue; }   // 꽉 차면 배경
        var top = cb.y - box.y;
        out.push({ id: c.id, name: c.name,
                   x: cb.x - box.x, y: top, w: cb.width, h: cb.height,
                   /* 프레임 위쪽 1/3 안이면 상단 타이틀, 아니면 하단 내용 */
                   slot: (top < box.height / 3) ? "top" : "bottom" });
    }
    out.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    return out;
}

function findEvents(section) {
    var found = [];
    walk(section, function (n) {
        if (n.type === "FRAME" && EVENT_RE.test(n.name) && n.absoluteBoundingBox) {
            found.push(n);
        }
    });
    found.sort(function (a, b) {                       // 대지 왼쪽 → 오른쪽
        return a.absoluteBoundingBox.x - b.absoluteBoundingBox.x;
    });
    var out = [];
    for (var i = 0; i < found.length; i++) {
        out.push({ id: found[i].id, name: found[i].name, layers: null });
    }
    return out;
}

/* 고른 이벤트의 자식 레이어만 뒤늦게 받아 옵니다.
   회차 대지 하나에 프레임이 74 개, 그 아래까지 합치면 노드가 수천 개라
   한 번에 받으면 응답이 20 MB 를 넘고 ExtendScript 가 읽다 죽습니다.
   실제로 쓰는 건 그중 대여섯 개뿐이라, 고른 뒤에 그것만 받습니다. */
function fetchLayers(token, picked) {
    var ids = [], i;
    for (i = 0; i < picked.length; i++) {
        if (!picked[i].layers) { ids.push(picked[i].id); }
    }
    if (!ids.length) { return; }

    var res = curlJSON("https://api.figma.com/v1/files/" + state.fileKey
                       + "/nodes?depth=2&ids=" + encodeURIComponent(ids.join(",")), token);
    for (i = 0; i < picked.length; i++) {
        if (picked[i].layers) { continue; }
        var w = res.nodes && res.nodes[picked[i].id];
        if (!w || !w.document) { throw new Error("이벤트를 못 찾았습니다 : " + picked[i].name); }
        picked[i].layers = eventLayers(w.document);
        if (!picked[i].layers.length) {
            throw new Error("내보낼 레이어가 없습니다 : " + picked[i].name
                + "\n배경만 있는 프레임이거나, 레이어가 하나로 합쳐져 있습니다.");
        }
    }
}


/* ============ 소스 내려받기 ============ */

function downloadSources(token, picked, destFolder) {
    fetchLayers(token, picked);
    var ids = [], i, j;
    for (i = 0; i < picked.length; i++) {
        for (j = 0; j < picked[i].layers.length; j++) { ids.push(picked[i].layers[j].id); }
    }
    var res = curlJSON("https://api.figma.com/v1/images/" + state.fileKey
                       + "?ids=" + encodeURIComponent(ids.join(","))
                       + "&format=png&scale=" + SCALE, token);
    if (!res.images) { throw new Error("피그마가 그림 주소를 주지 않았습니다."); }

    /* curl 한 번에 전부 받습니다 — 한 장씩 부르면 그만큼 애프터이펙트가 멈춥니다 */
    var cmd = "/usr/bin/curl -fsSL --max-time 300", n = 0;
    for (i = 0; i < picked.length; i++) {
        for (j = 0; j < picked[i].layers.length; j++) {
            var L = picked[i].layers[j], url = res.images[L.id];
            if (!url) { throw new Error("내보내지 못한 레이어가 있습니다 : " + L.name); }
            L.file = new File(destFolder.fsName + "/"
                   + pad(i + 1) + "_" + safe(picked[i].name) + "_" + (j + 1) + ".png");
            cmd += " " + q(url) + " -o " + q(L.file.fsName);
            n++;
        }
    }
    system.callSystem(cmd);

    for (i = 0; i < picked.length; i++) {
        for (j = 0; j < picked[i].layers.length; j++) {
            if (!picked[i].layers[j].file.exists) {
                throw new Error("그림을 받다가 끊겼습니다. 다시 눌러 주세요.");
            }
        }
    }
    return n;
}

function pad(n) { return (n < 10 ? "0" : "") + n; }
function safe(s) { return String(s).replace(/[^\w가-힣]+/g, "_").replace(/^_|_$/g, ""); }


/* ============ 컴프에 깔기 ============ */

/* ============ 나레이션에서 마커 자동으로 찍기 ============ */

/* 일레븐랩스 Scribe(받아쓰기)에 **이미 만든 mp3 를 그대로** 올립니다.
   음성을 다시 만드는 게 아니라서 TTS 크레딧이 나가지 않습니다. */
function transcribe(audioFile, key) {
    var out = tmpFile("stt.json");
    var cmd = "/usr/bin/curl -fsSL --max-time 300"
            + " -H " + q("xi-api-key: " + key)
            + " -F " + q("file=@" + audioFile.fsName)
            + " -F " + q("model_id=scribe_v1")
            + " " + q("https://api.elevenlabs.io/v1/speech-to-text")
            + " -o " + q(out.fsName);
    try { system.callSystem(cmd); }
    catch (e) { throw new Error("일레븐랩스에 연결하지 못했습니다. (" + e.toString() + ")"); }

    var body = out.exists ? readAll(out) : null;
    if (!body) { throw new Error("일레븐랩스에서 아무것도 받지 못했습니다.\n"
                               + "API 키가 맞는지 확인해 주세요."); }
    var res;
    try { res = eval("(" + body + ")"); }
    catch (e2) { throw new Error("받아쓰기 결과를 읽지 못했습니다.\n\n" + body.substr(0, 300)); }
    if (!res.words || !res.words.length) {
        throw new Error("받아쓰기에 단어 시각이 없습니다.\n\n" + body.substr(0, 300));
    }
    return res.words;
}

/* 받아쓴 단어들을 띄어쓰기 없는 한 줄로 잇고, 글자 위치 → 시각 표를 만듭니다.
   받아쓰기가 "재 구매" 로 띄든 "재구매" 로 붙이든 똑같이 찾히게 하려는 것입니다. */
function flatten(words) {
    var text = "", at = [];
    for (var i = 0; i < words.length; i++) {
        var t = String(words[i].text || "").replace(/\s+/g, "");
        if (!t) { continue; }
        for (var c = 0; c < t.length; c++) { at.push(words[i].start); }
        text += t;
    }
    return { text: text, at: at };
}

/* 이벤트 이름이 나레이션에 처음 나오는 시각을 찾습니다.
   "8. 구매 인증 이벤트" → "구매인증이벤트" 로 만들어 찾고, 못 찾으면 "이벤트" 를
   떼고 한 번 더 봅니다("상한가 슬라이딩" 처럼 이름이 다른 경우가 있어서). */
function findEventTimes(flat, picked, lead) {
    var from = 0, out = [], missed = [];
    for (var i = 0; i < picked.length; i++) {
        var raw = picked[i].name.replace(/^[0-9]+[.\s]*/, "").replace(/\s+/g, "");
        var hit = flat.text.indexOf(raw, from);
        if (hit < 0 && raw.length > 4) { hit = flat.text.indexOf(raw.replace(/이벤트$/, ""), from); }
        if (hit < 0) { missed.push(picked[i].name); out.push(null); continue; }
        from = hit + 1;
        var tName = flat.at[hit];
        out.push([Math.max(0, tName - lead), tName]);   /* [상단, 하단] */
    }
    return { times: out, missed: missed };
}

/* 찾은 시각을 컴프 마커로 찍습니다. 사람이 눈으로 보고 끌어서 고칠 수 있게 하려는 것입니다. */
function writeMarkers(comp, picked, pairs) {
    var mk = comp.markerProperty;
    for (var k = mk.numKeys; k >= 1; k--) { mk.removeKey(k); }   /* 기존 마커는 지웁니다 */
    var n = 0;
    for (var i = 0; i < picked.length; i++) {
        if (!pairs[i]) { continue; }
        mk.setValueAtTime(pairs[i][0], new MarkerValue(picked[i].name));
        n++;
    }
    return n;
}


/* 컴프 마커에서 이벤트별 [시작, 끝] 을 뽑습니다.

   음성에 맞추는 가장 확실한 방법은 사람이 듣고 찍는 것입니다 — 일레븐랩스에 타임스탬프를
   다시 물어보면 크레딧이 또 나가고, 대본 문장과 이벤트를 맞추다 어긋날 수도 있습니다.
   나레이션을 한 번 들으며 * 를 몇 번 누르는 편이 빠르고 정확합니다. */
function timesFromMarkers(comp, count) {
    var mk = comp.markerProperty;
    if (!mk || mk.numKeys === 0) { return null; }          /* 마커가 없으면 균등 분배로 */
    if (mk.numKeys < count) {
        throw new Error("컴프 마커가 " + mk.numKeys + "개인데 고른 이벤트는 "
            + count + "개입니다.\n\n"
            + "나레이션을 들으면서 이벤트가 시작되는 지점마다\n"
            + "마커를 찍어 주세요 (재생 중 * 키).\n\n"
            + "마지막 이벤트가 끝나는 지점에도 하나 더 찍으면\n"
            + "끝 시각까지 정확해집니다.");
    }
    var out = [];
    for (var i = 0; i < count; i++) {
        out.push([ mk.keyTime(i + 1),
                   (i + 1 < mk.numKeys) ? mk.keyTime(i + 2) : comp.duration ]);
    }
    return out;
}

/* 마커가 없을 때 쓰는 균등 분배 */
function timesEven(count, secPer) {
    var out = [];
    for (var i = 0; i < count; i++) { out.push([i * secPer, (i + 1) * secPer]); }
    return out;
}


/* 고른 "본보기" 레이어를 복제해서 그림만 갈아끼웁니다.
   이렇게 하면 애니메이션 컴포저 프리셋(익스프레션·이펙트 컨트롤)이 그대로 따라오므로
   프리셋을 스크립트로 다시 만들 필요가 없습니다. */
function assemble(picked, model, times, botDelay) {
    var comp = model.containingComp, made = 0;
    var proj = app.project;

    for (var i = 0; i < picked.length; i++) {
        for (var j = 0; j < picked[i].layers.length; j++) {
            var L = picked[i].layers[j];

            var io = new ImportOptions(L.file);
            var foot = proj.importFile(io);

            var lay = model.duplicate();
            lay.replaceSource(foot, false);
            lay.name = picked[i].name + " " + (j + 1);

            /* 자리 잡기는 위치가 아니라 [기준점] 으로 합니다.

               본보기 레이어의 위치에는 애니메이션 컴포저 익스프레션이 걸려 있어서
               (1620 → 540 으로 밀려 들어오는 그 움직임), 위치에 값을 넣어봐야
               익스프레션이 덮어씁니다. 기준점에는 아무것도 안 걸려 있으므로 여기서
               밀어 주면 인/아웃 움직임을 그대로 두고 자리만 옮길 수 있습니다.

               기준점 A 는 컴프의 위치 P 로 갑니다. 그림 왼쪽 위를 (X, Y) 에 놓으려면
               A = P - (X, Y). 멈춰 있을 때의 P 를 화면 한가운데로 봅니다.
               ponytail: 본보기 레이어가 화면 한가운데에서 멈추지 않는 구성이면
               어긋납니다. 그때는 P 를 본보기의 위치 값에서 읽어오면 됩니다. */
            try {
                lay.property("Transform").property("Anchor Point").setValue(
                    [comp.width  / 2 - L.x * SCALE,
                     comp.height / 2 - L.y * SCALE]);
            } catch (e) {}

            /* 아웃점을 먼저 끝까지 벌려 둡니다 — 새 인점이 지금 아웃점보다 뒤면
               애프터이펙트가 값을 안 받기 때문에 순서가 중요합니다. */
            /* 나레이션이 "첫 번째," 하는 동안 상단이 올라오고,
               "구매 인증 이벤트입니다" 하면서 하단이 나옵니다.
               그래서 하단만 조금 늦게 넣습니다. */
            var tIn = times[i][0] + (L.slot === "bottom" ? botDelay : 0);
            if (tIn >= times[i][1]) { tIn = times[i][0]; }   /* 구간보다 늦으면 지연 무시 */

            lay.startTime = 0;
            lay.outPoint = comp.duration;
            lay.inPoint  = tIn;
            lay.outPoint = times[i][1];
            lay.moveToBeginning();
            made++;
        }
    }
    return { comp: comp, made: made };
}


/* ============ 화면 ============ */

/* 목록에서 고른 이벤트를 고른 순서대로 돌려줍니다. 안 골랐으면 null. */
function pickedEvents(list) {
    var sel = list.selection;
    if (!sel) { alert("넣을 이벤트를 골라 주세요."); return null; }
    if (!(sel instanceof Array)) { sel = [sel]; }
    var out = [];
    for (var i = 0; i < sel.length; i++) { out.push(state.events[sel[i].index]); }
    return out;
}


function build(thisObj) {
    var w = (thisObj instanceof Panel) ? thisObj : new Window("palette", TOOL, undefined);
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.spacing = 8;
    w.margins = 12;

    /* --- 토큰 --- */
    var g1 = w.add("panel", undefined, "피그마 토큰 (처음 한 번만)");
    g1.orientation = "row"; g1.alignChildren = ["fill", "center"]; g1.margins = 10;
    var tok = g1.add("edittext", undefined, app.settings.haveSetting(STORE, "token")
                     ? app.settings.getSetting(STORE, "token") : "");
    tok.characters = 24;
    g1.add("button", undefined, "저장").onClick = function () {
        app.settings.saveSetting(STORE, "token", tok.text);
        alert("저장했습니다. 다음부터는 안 넣어도 됩니다.");
    };

    var g1b = w.add("panel", undefined, "일레븐랩스 키 (마커 자동으로 찍을 때만)");
    g1b.orientation = "row"; g1b.alignChildren = ["fill", "center"]; g1b.margins = 10;
    var xik = g1b.add("edittext", undefined, app.settings.haveSetting(STORE, "xi")
                      ? app.settings.getSetting(STORE, "xi") : "");
    xik.characters = 24;
    g1b.add("button", undefined, "저장").onClick = function () {
        app.settings.saveSetting(STORE, "xi", xik.text);
        alert("저장했습니다.");
    };

    /* --- 회차 주소 --- */
    var g2 = w.add("panel", undefined, "회차 피그마 주소");
    g2.orientation = "row"; g2.alignChildren = ["fill", "center"]; g2.margins = 10;
    var url = g2.add("edittext", undefined, "");
    url.characters = 24;
    var loadBtn = g2.add("button", undefined, "불러오기");

    /* --- 이벤트 목록 --- */
    var g3 = w.add("panel", undefined, "영상에 넣을 이벤트 (위에서부터 나오는 순서)");
    g3.orientation = "column"; g3.alignChildren = ["fill", "top"]; g3.margins = 10;
    var list = g3.add("listbox", undefined, [], { multiselect: true });
    list.preferredSize = [-1, 160];
    var hint = g3.add("statictext", undefined, "주소를 넣고 [불러오기] 를 누르세요.");

    /* --- 조립 --- */
    var g4 = w.add("panel", undefined, "조립");
    g4.orientation = "column"; g4.alignChildren = ["fill", "top"]; g4.margins = 10;
    g4.add("statictext", undefined,
        "① 마커 — 아래 버튼으로 자동, 또는 들으면서 직접 *");
    var sttBtn = g4.add("button", undefined, "나레이션에서 마커 찍기");
    g4.add("statictext", undefined,
        "② 타임라인에서 본보기 레이어를 하나 선택");
    var g4b = g4.add("group"); g4b.orientation = "row";
    g4b.add("statictext", undefined, "하단은 상단보다");
    var delay = g4b.add("edittext", undefined, "0.6");
    delay.characters = 4;
    g4b.add("statictext", undefined, "초 뒤에");
    var g4a = g4.add("group"); g4a.orientation = "row";
    g4a.add("statictext", undefined, "마커가 없으면 이벤트당");
    var secs = g4a.add("edittext", undefined, "3");
    secs.characters = 4;
    g4a.add("statictext", undefined, "초씩 균등하게");
    var goBtn = g4.add("button", undefined, "소스 받고 조립하기");

    var log = w.add("statictext", undefined, "", { multiline: true });
    log.preferredSize = [-1, 32];

    function say(s) { log.text = s; w.update && w.update(); }

    loadBtn.onClick = function () {
        try {
            if (!tok.text) { alert("피그마 토큰을 먼저 넣고 [저장] 을 눌러 주세요."); return; }
            var u = parseFigmaUrl(url.text);
            state.fileKey = u.key;
            say("피그마에서 불러오는 중… (잠시 멈춥니다)");

            /* depth=2 — 대지(1) 와 그 직속 프레임(2) 까지만. 이름만 있으면 목록은 만들 수 있고,
               그 아래 레이어는 [조립] 때 고른 것만 따로 받습니다. */
            var doc = curlJSON("https://api.figma.com/v1/files/" + u.key
                               + "/nodes?depth=2&ids=" + encodeURIComponent(u.node), tok.text);
            var wrap = doc.nodes && doc.nodes[u.node];
            if (!wrap) { throw new Error("그 주소에서 회차 대지를 못 찾았습니다."); }

            state.events = findEvents(wrap.document);
            list.removeAll();
            for (var i = 0; i < state.events.length; i++) {
                list.add("item", state.events[i].name);
            }
            hint.text = "이벤트 " + state.events.length + "개를 찾았습니다. "
                      + "넣을 것만 골라 주세요 (여러 개는 ⌘ 누르고 클릭).";
            say("");
        } catch (e) { say(""); alert(e.message || e.toString()); }
    };

    sttBtn.onClick = function () {
        try {
            if (!state.events.length) { alert("먼저 [불러오기] 를 눌러 주세요."); return; }
            if (!xik.text) { alert("일레븐랩스 키를 먼저 넣고 [저장] 을 눌러 주세요."); return; }
            var picked = pickedEvents(list);
            if (!picked) { return; }

            var comp = app.project.activeItem;
            if (!(comp instanceof CompItem)) { alert("컴프를 먼저 열어 주세요."); return; }

            var audio = File.openDialog("나레이션 음성 파일을 고르세요 (mp3/wav)");
            if (!audio) { return; }

            var lead = parseFloat(delay.text);
            if (!(lead >= 0)) { lead = 0; }

            say("받아쓰는 중… (음성 길이만큼 걸리고, 그동안 멈춥니다)");
            var flat = flatten(transcribe(audio, xik.text));
            var r = findEventTimes(flat, picked, lead);

            app.beginUndoGroup(TOOL + " 마커");
            var n = writeMarkers(comp, picked, r.times);
            app.endUndoGroup();
            say("");

            var msg = "마커 " + n + "개를 찍었습니다.\n\n"
                    + "타임라인에서 확인하고, 어긋난 것은 끌어서 옮겨 주세요.";
            if (r.missed.length) {
                msg += "\n\n나레이션에서 못 찾은 이벤트 (직접 찍어 주세요) :\n  · "
                     + r.missed.join("\n  · ");
            }
            alert(msg);
        } catch (e) {
            try { app.endUndoGroup(); } catch (e2) {}
            say(""); alert(e.message || e.toString());
        }
    };

    goBtn.onClick = function () {
        try {
            if (!state.events.length) { alert("먼저 [불러오기] 를 눌러 주세요."); return; }

            var picked = pickedEvents(list);
            if (!picked) { return; }

            var model = null;
            try {
                var comp = app.project.activeItem;
                if (comp instanceof CompItem && comp.selectedLayers.length === 1) {
                    model = comp.selectedLayers[0];
                }
            } catch (e0) {}
            if (!model) {
                alert("타임라인에서 본보기가 될 레이어를 하나만 골라 주세요.\n\n"
                    + "그 레이어를 복제해서 쓰기 때문에\n"
                    + "인/아웃 애니메이션이 그대로 따라옵니다.");
                return;
            }

            /* 마커가 있으면 그 구간에, 없으면 균등하게 */
            var times = timesFromMarkers(model.containingComp, picked.length);
            var byMarker = !!times;
            if (!times) {
                var sec = parseFloat(secs.text);
                if (!(sec > 0)) { alert("컴프에 마커가 없습니다.\n\n"
                    + "나레이션을 들으며 마커를 찍거나,\n"
                    + "균등 분배로 쓸 초를 숫자로 넣어 주세요."); return; }
                times = timesEven(picked.length, sec);
            }

            var dest = Folder.selectDialog("소스를 저장할 폴더를 고르세요");
            if (!dest) { return; }

            say("피그마에서 그림 받는 중… (잠시 멈춥니다)");
            var n = downloadSources(tok.text, picked, dest);

            say("컴프에 까는 중…");
            app.beginUndoGroup(TOOL + " 조립");
            var botDelay = parseFloat(delay.text);
            if (!(botDelay >= 0)) { botDelay = 0; }
            var r = assemble(picked, model, times, botDelay);
            app.endUndoGroup();

            say("");
            alert("다 됐습니다.\n\n"
                + "이벤트 " + picked.length + "개 / 레이어 " + r.made + "장\n"
                + "소스 폴더 : " + dest.fsName + "\n\n"
                + (byMarker
                    ? "컴프 마커에 맞춰 인/아웃을 잡았습니다.\n"
                    + "하단은 " + botDelay + "초 늦게 넣었습니다."
                    : "컴프에 마커가 없어서 균등하게 깔았습니다.\n"
                    + "나레이션에 맞추려면 마커를 찍고 다시 눌러 주세요."));
        } catch (e) {
            try { app.endUndoGroup(); } catch (e2) {}
            say(""); alert(e.message || e.toString());
        }
    };

    /* 창 크기가 바뀔 때마다 다시 잡아 줍니다.
       이게 없으면 처음 한 번 잡은 제일 작은 크기 그대로 굳어서,
       패널을 아무리 넓혀도 글자가 잘린 채 왼쪽에 몰려 있습니다. */
    w.onResizing = w.onResize = function () {
        try { this.layout.resize(); } catch (e) {}
    };

    w.layout.layout(true);
    w.layout.resize();
    if (w instanceof Window) { w.center(); w.show(); }
    return w;
}

build(typeof PRIZM_HOST !== "undefined" && PRIZM_HOST ? PRIZM_HOST : thisObj);

})(this);
