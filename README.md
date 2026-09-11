# PRIZM AE 도구

애프터이펙트 패널을 두는 곳이다. **즐겨찾기를 한 번만 깔면, 이후 업데이트는 저절로
된다** — 패널을 열 때마다 여기서 최신본을 받아 가기 때문이다.

## 설치 (한 번만)

터미널에 아래 한 줄을 붙여넣고 실행한 뒤, **애프터이펙트를 다시 켠다.**
창(Window) 메뉴 맨 아래에 `check IN EVENT` 가 생긴다.

```bash
curl -fsSL https://raw.githubusercontent.com/d1sdud/prizm-ae-tools/main/check-in-event-loader.jsx \
  -o "$(ls -d /Applications/Adobe\ After\ Effects\ */Scripts/ScriptUI\ Panels | sort | tail -1)/check IN EVENT.jsx"
```

`Permission denied` 가 나오면 앞에 `sudo ` 를 붙여 다시 실행한다.

그리고 애프터이펙트 **환경 설정 > 스크립팅 및 표현식** 에서
**"스크립트가 파일에 쓰고 네트워크에 액세스하도록 허용"** 을 켠다. 애프터이펙트는
`https` 를 직접 못 읽어서 맥에 기본으로 있는 `curl` 을 대신 부르기 때문이다.

## 파일

| 파일 | 무엇 |
|---|---|
| `check-in-event-loader.jsx` | **즐겨찾기.** 이것만 깔면 된다 |
| `check-in-event-tool.jsx` | 도구 본체. 즐겨찾기가 알아서 받아 간다 |

`check IN EVENT` 는 체크인 라이브의 이벤트 영상 대판을 조립하는 도구다. 쓰는 법은
패널을 열면 안내가 있고, 자세한 것은 아래 원본 저장소에 있다.

## 왜 공개 저장소인가

즐겨찾기가 `curl` 로 받아 오는데, 비공개 저장소면 그 `curl` 에 GitHub 토큰을 넣어야
한다. 그 토큰은 각자 맥의 캐시 파일(`~/Library/Caches/PRIZM_AE_Tools/`)에 평문으로
남는다. 공개로 두면 토큰이 아예 필요 없다.

**열쇠는 여기 없다.** 피그마·일레븐랩스 키는 각자 패널에 직접 넣어 자기 맥에만
저장된다. 이 저장소에 올라가는 것은 도구 코드뿐이다.

## 고치는 곳은 여기가 아니다

원본과 설명은 [d1sdud/RXC](https://github.com/d1sdud/RXC) 의 `event-video/` 에 있다.
이 저장소는 배포용 사본이라, **여기서 직접 고치면 다음 배포 때 덮어써진다.**
