/*
 * Markdown → HWPX 변환기 (브라우저)
 *
 * Copyright (c) 2026 Shin Mingyu
 *
 * 입력: 마크다운 텍스트 문자열
 * 출력: HWPX(Blob)
 *
 * 동작:
 *   1) templates/blank.hwpx 를 fetch → JSZip 으로 풀기
 *   2) marked.lexer() 로 마크다운을 토큰으로 분석
 *   3) Contents/header.xml 에 굵게/기울임/제목용 charPr 를 동적으로 추가
 *   4) Contents/section0.xml 의 본문 영역을 새로 작성
 *   5) ZIP 재구성 (mimetype 우선·비압축 보존)
 *
 * 의존성: window.JSZip, window.marked, window.LatexToHwp
 */
(function (global) {
  'use strict';

  // ── 네임스페이스 ────────────────────────────────────────────────
  var HP_NS  = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  var HH_NS  = 'http://www.hancom.co.kr/hwpml/2011/head';
  var HS_NS  = 'http://www.hancom.co.kr/hwpml/2011/section';
  var HC_NS  = 'http://www.hancom.co.kr/hwpml/2011/core';

  // 빈 템플릿의 기본 paraPr / styleIDRef
  // 0: 바탕글 (본문 텍스트)
  // 2: 개요 1 (H1), 3: 개요 2 (H2), ..., 8: 개요 7 (H7) — H1~H6 매핑에 사용
  var PARA_BODY     = { paraPrIDRef: '0', styleIDRef: '0' };
  var PARA_HEADING  = function (level) {
    // H1=outline1(style 2/paraPr 2), H2=style 3, ..., H6=style 7
    var sid = String(Math.min(level, 6) + 1);
    return { paraPrIDRef: sid, styleIDRef: sid };
  };

  // ── HWPX 템플릿 로딩 ──────────────────────────────────────────
  function loadTemplate(JSZipLib, url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('템플릿을 불러오지 못했습니다: ' + url);
      return r.arrayBuffer();
    }).then(function (buf) {
      return JSZipLib.loadAsync(buf);
    });
  }

  // ── header.xml 확장: 필요한 charPr ID 들 보장 ──────────────────
  //
  // 빈 템플릿엔 본문용 charPr(id=0) 만 안전하게 쓸 수 있다.
  // 마크다운의 강조(굵게/기울임/취소선/인라인 코드)와 헤딩 크기 키움을 위해
  // 추가 charPr 를 동적으로 만들어 header.xml 의 hh:charProperties 에 붙인다.
  //
  // options:
  //   fontFamily — 사용자가 선택한 글꼴 이름 (없으면 템플릿 기본 유지)
  //   fontSizePt — 본문 글자 크기(포인트). HWPX 단위는 1pt = 100. 기본 10pt = 1000.
  function extendHeader(headerXmlStr, parser, serializer, options) {
    options = options || {};
    var doc = parser.parseFromString(headerXmlStr, 'application/xml');
    var perr = doc.getElementsByTagName('parsererror');
    if (perr && perr.length) throw new Error('header.xml 파싱 실패');

    // 1) 사용자 글꼴 등록 — fontface 각 lang 블록에 같은 face 를 새 id 로 추가
    var newFontId = null;
    if (options.fontFamily) {
      newFontId = registerUserFont(doc, options.fontFamily);
    }

    // 2) 본문 charPr(id=0) 의 fontRef 와 height 를 사용자 값으로 갱신
    var props = doc.getElementsByTagNameNS(HH_NS, 'charProperties')[0];
    if (!props) throw new Error('hh:charProperties 를 찾지 못했습니다');

    var charPrs = doc.getElementsByTagNameNS(HH_NS, 'charPr');
    var maxId = -1;
    var base = null;
    for (var i = 0; i < charPrs.length; i++) {
      var id = parseInt(charPrs[i].getAttribute('id'), 10);
      if (!isNaN(id)) {
        if (id > maxId) maxId = id;
        if (id === 0) base = charPrs[i];
      }
    }
    if (!base) throw new Error('기본 charPr(id=0)를 찾지 못했습니다');

    // base 의 height(글자 크기) 적용 — 1pt = 100. 기본은 1000 (10pt).
    var bodyHeight = 1000;
    if (typeof options.fontSizePt === 'number' && options.fontSizePt > 0) {
      bodyHeight = Math.round(options.fontSizePt * 100);
    }
    base.setAttribute('height', String(bodyHeight));

    // base 안의 fontRef 들을 새 fontId 로 교체
    if (newFontId != null) {
      var fontRefs = base.getElementsByTagNameNS(HH_NS, 'fontRef');
      for (var fi = 0; fi < fontRefs.length; fi++) {
        var fr = fontRefs[fi];
        ['hangul','latin','hanja','japanese','other','symbol','user'].forEach(function (k) {
          fr.setAttribute(k, String(newFontId));
        });
      }
    }

    function clone(node) { return node.cloneNode(true); }
    function setAttr(el, k, v) { el.setAttribute(k, v); }
    function appendChildNs(parent, localName, attrs) {
      var el = doc.createElementNS(HH_NS, 'hh:' + localName);
      if (attrs) {
        for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          el.setAttribute(k, attrs[k]);
        }
      }
      parent.appendChild(el);
      return el;
    }

    // 한컴은 charPr 의 강조(bold/italic) 를 자식 요소로 기대한다.
    // 속성 (bold="1") 만으로는 화면에 굵게가 적용되지 않는 케이스가 있어
    // 자식 요소 형태로 추가한다.
    function addVariant(opts) {
      maxId++;
      var n = clone(base);
      setAttr(n, 'id', String(maxId));
      if (opts.height) setAttr(n, 'height', String(opts.height));
      else setAttr(n, 'height', String(bodyHeight));
      if (opts.textColor) setAttr(n, 'textColor', opts.textColor);
      if (opts.shadeColor) setAttr(n, 'shadeColor', opts.shadeColor);
      // 속성 형태도 함께 둔다(일부 파서 호환).
      if (opts.italic) setAttr(n, 'italic', '1');
      if (opts.bold)   setAttr(n, 'bold',   '1');
      // 자식 요소 — 한컴 공식 출력 형태와 일치.
      if (opts.italic) appendChildNs(n, 'italic');
      if (opts.bold)   appendChildNs(n, 'bold');
      if (opts.underline) {
        appendChildNs(n, 'underline', { type: 'BOTTOM', shape: 'SOLID', color: opts.textColor || '#000000' });
      }
      if (opts.strikeout) {
        appendChildNs(n, 'strikeout', { shape: 'CONTINUOUS', color: '#000000' });
      }
      props.appendChild(n);
      return String(maxId);
    }

    // 헤딩은 본문 크기에 비례해서 키운다 (HWP 의 개요 스타일 감각과 비슷하게).
    function h(scale) { return Math.round(bodyHeight * scale); }

    var map = {};
    map.body       = '0';
    map.bold       = addVariant({ bold: true });
    map.italic     = addVariant({ italic: true });
    map.boldItalic = addVariant({ bold: true, italic: true });
    map.strike     = addVariant({ strikeout: true });
    map.code       = addVariant({ shadeColor: '#F0F0F0' });
    map.codeBlock  = addVariant({ textColor: '#F8F8F2' });
    map.link       = addVariant({ underline: true, textColor: '#0563C1' });
    // 본문 크기에 비례한 헤딩 크기 (10pt 기본 기준: H1=20, H2=17, H3=14, H4=12, H5=11, H6=10)
    map.h1 = addVariant({ height: h(2.0), bold: true });
    map.h2 = addVariant({ height: h(1.7), bold: true });
    map.h3 = addVariant({ height: h(1.4), bold: true });
    map.h4 = addVariant({ height: h(1.2), bold: true });
    map.h5 = addVariant({ height: h(1.1), bold: true });
    map.h6 = addVariant({ height: h(1.0), bold: true });
    map.quote = addVariant({ italic: true, textColor: '#595959' });

    // itemCnt 재계산
    props.setAttribute('itemCnt', String(props.getElementsByTagNameNS(HH_NS, 'charPr').length));

    // 가운데 정렬용 paraPr 추가 — paraPr id=0 을 클론해 hh:align horizontal="CENTER" 로.
    var paraMap = { body: '0' };
    paraMap.center = addCenterParaPr(doc);

    // 표 기본 테두리용 borderFill 추가 — 빈 템플릿의 borderFill 은 모두 NONE 이라
    // 표를 그대로 출력하면 테두리 없는 격자만 보인다. SOLID 0.12mm 검정 4변을
    // 가진 borderFill 을 동적으로 추가하고 그 id 를 tableXml() 에 넘긴다.
    // (rhwp 의 basic-table-01.hwpx 표 borderFill 과 같은 구조)
    var borderFillMap = { tableDefault: '2' };
    var bfId = addBorderedFill(doc);
    if (bfId) borderFillMap.tableDefault = bfId;

    // 코드 블록 전용 어두운 배경 borderFill + paraPr
    var codeFillId = addCodeFill(doc);
    paraMap.code = addCodeParaPr(doc, codeFillId);

    var out = serializer.serializeToString(doc);
    out = removeRedundantNsDecls(out);
    out = ensureXmlDecl(out, headerXmlStr);
    return { xml: out, charPr: map, paraPr: paraMap, borderFill: borderFillMap };
  }

  // ── borderFill 추가: 표 본 테두리용 SOLID 0.12mm ──────────────
  //
  // 빈 템플릿 borderFill 은 id=1, id=2 모두 4 변 type="NONE" 이라 표 출력 시
  // 테두리가 안 보인다. 마크다운 표는 일반적으로 격자 테두리가 그려진 모양이
  // 기본 기대치이므로, id=2 를 클론해 4 변을 SOLID 로 바꾼 borderFill 을 새 id
  // 로 추가한다. fillBrush 가 있으면 제거(테두리 전용).
  function addBorderedFill(doc) {
    var bfs = doc.getElementsByTagNameNS(HH_NS, 'borderFills')[0];
    if (!bfs) return null;
    var list = doc.getElementsByTagNameNS(HH_NS, 'borderFill');
    var maxId = 0, base = null;
    for (var i = 0; i < list.length; i++) {
      var idAttr = parseInt(list[i].getAttribute('id'), 10);
      if (!isNaN(idAttr)) {
        if (idAttr > maxId) maxId = idAttr;
        if (idAttr === 2) base = list[i];
      }
    }
    if (!base && list.length) base = list[list.length - 1];
    if (!base) return null;
    var bClone = base.cloneNode(true);
    var newId = maxId + 1;
    bClone.setAttribute('id', String(newId));
    // fillBrush 제거 (있으면) — 표 본 테두리에 채움 불필요
    var brushes = bClone.getElementsByTagNameNS(HC_NS, 'fillBrush');
    while (brushes.length) brushes[0].parentNode.removeChild(brushes[0]);
    // 4 변을 SOLID 0.12mm 검정으로
    ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder'].forEach(function (name) {
      var b = bClone.getElementsByTagNameNS(HH_NS, name)[0];
      if (b) {
        b.setAttribute('type', 'SOLID');
        b.setAttribute('width', '0.12 mm');
        b.setAttribute('color', '#000000');
      }
    });
    bfs.appendChild(bClone);
    bfs.setAttribute('itemCnt', String(doc.getElementsByTagNameNS(HH_NS, 'borderFill').length));
    return String(newId);
  }

  // ── borderFill 추가: 코드 블록 전용 어두운 배경 ──────────────
  //
  // 코드 블록 단락의 배경을 진한 색(#1E1E1E)으로 채우기 위한 borderFill.
  // 테두리 선은 없고 fillBrush 만으로 배경색 지정.
  // id=2(fillBrush 보유)를 클론해 faceColor 를 어두운 색으로 바꾼다.
  function addCodeFill(doc) {
    var bfs = doc.getElementsByTagNameNS(HH_NS, 'borderFills')[0];
    if (!bfs) return null;
    var list = doc.getElementsByTagNameNS(HH_NS, 'borderFill');
    var maxId = 0, base = null;
    for (var i = 0; i < list.length; i++) {
      var idAttr = parseInt(list[i].getAttribute('id'), 10);
      if (!isNaN(idAttr)) {
        if (idAttr > maxId) maxId = idAttr;
        if (idAttr === 2) base = list[i];
      }
    }
    if (!base && list.length) base = list[list.length - 1];
    if (!base) return null;
    var bClone = base.cloneNode(true);
    var newId = maxId + 1;
    bClone.setAttribute('id', String(newId));
    // 4변 테두리 제거 (배경만 사용)
    ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder'].forEach(function (name) {
      var b = bClone.getElementsByTagNameNS(HH_NS, name)[0];
      if (b) b.setAttribute('type', 'NONE');
    });
    // fillBrush: 어두운 배경색
    var brushes = bClone.getElementsByTagNameNS(HC_NS, 'fillBrush');
    var winBrush = null;
    if (brushes.length) {
      winBrush = brushes[0].getElementsByTagNameNS(HC_NS, 'winBrush')[0];
    }
    if (!winBrush) {
      var fb = doc.createElementNS(HC_NS, 'hc:fillBrush');
      winBrush = doc.createElementNS(HC_NS, 'hc:winBrush');
      fb.appendChild(winBrush);
      bClone.appendChild(fb);
    }
    winBrush.setAttribute('faceColor', '#1E1E1E');
    winBrush.setAttribute('hatchColor', '#1E1E1E');
    winBrush.setAttribute('alpha', '0');
    bfs.appendChild(bClone);
    bfs.setAttribute('itemCnt', String(doc.getElementsByTagNameNS(HH_NS, 'borderFill').length));
    return String(newId);
  }

  // ── paraPr 추가: 코드 블록 전용 (어두운 배경 + 좌우 들여쓰기) ──
  function addCodeParaPr(doc, codeFillId) {
    if (!codeFillId) return '0';
    var paraProps = doc.getElementsByTagNameNS(HH_NS, 'paraProperties')[0];
    if (!paraProps) return '0';
    var paraPrs = doc.getElementsByTagNameNS(HH_NS, 'paraPr');
    var maxId = -1, base = null;
    for (var i = 0; i < paraPrs.length; i++) {
      var pid = parseInt(paraPrs[i].getAttribute('id'), 10);
      if (!isNaN(pid)) {
        if (pid > maxId) maxId = pid;
        if (pid === 0) base = paraPrs[i];
      }
    }
    if (!base) return '0';
    var clone = base.cloneNode(true);
    var newId = maxId + 1;
    clone.setAttribute('id', String(newId));
    // border: 코드 fill 참조, ignoreMargin=1 로 여백까지 배경 채움
    var border = clone.getElementsByTagNameNS(HH_NS, 'border')[0];
    if (border) {
      border.setAttribute('borderFillIDRef', codeFillId);
      border.setAttribute('ignoreMargin', '1');
    }
    // 좌우 들여쓰기: 200 HWPUNIT ≈ 5mm
    var margins = clone.getElementsByTagNameNS(HC_NS, 'left');
    if (margins.length) margins[0].setAttribute('value', '200');
    var marginsR = clone.getElementsByTagNameNS(HC_NS, 'right');
    if (marginsR.length) marginsR[0].setAttribute('value', '200');
    // 줄 간격: 100% (기본 160% 는 코드 블록에서 얼룩말처럼 보임)
    var ls = clone.getElementsByTagNameNS(HH_NS, 'lineSpacing')[0];
    if (ls) ls.setAttribute('value', '100');
    paraProps.appendChild(clone);
    paraProps.setAttribute('itemCnt', String(paraProps.getElementsByTagNameNS(HH_NS, 'paraPr').length));
    return String(newId);
  }

  function addCenterParaPr(doc) {
    var paraProps = doc.getElementsByTagNameNS(HH_NS, 'paraProperties')[0];
    if (!paraProps) return '0';
    var paraPrs = doc.getElementsByTagNameNS(HH_NS, 'paraPr');
    var maxId = -1, base = null;
    for (var i = 0; i < paraPrs.length; i++) {
      var pid = parseInt(paraPrs[i].getAttribute('id'), 10);
      if (!isNaN(pid)) {
        if (pid > maxId) maxId = pid;
        if (pid === 0) base = paraPrs[i];
      }
    }
    if (!base) return '0';
    var clone = base.cloneNode(true);
    var newId = maxId + 1;
    clone.setAttribute('id', String(newId));
    var align = clone.getElementsByTagNameNS(HH_NS, 'align')[0];
    if (align) {
      align.setAttribute('horizontal', 'CENTER');
    }
    paraProps.appendChild(clone);
    paraProps.setAttribute('itemCnt', String(paraProps.getElementsByTagNameNS(HH_NS, 'paraPr').length));
    return String(newId);
  }

  // ── 사용자 글꼴 등록 ──────────────────────────────────────────
  //
  // header.xml 의 hh:fontfaces 안에는 lang 별 (HANGUL/LATIN/HANJA/JAPANESE/
  // OTHER/SYMBOL/USER) hh:fontface 블록이 있고 각 블록은 자체 id 공간을 갖는
  // hh:font 목록을 담는다. 사용자 글꼴 한 개를 등록하려면 각 lang 블록마다
  // 같은 face 의 hh:font 를 새 id 로 추가해야 한다.
  // 모든 lang 블록의 새 id 가 일치하도록(모두 같은 다음 id) 보장한 뒤 반환한다.
  function registerUserFont(doc, faceName) {
    var blocks = doc.getElementsByTagNameNS(HH_NS, 'fontface');
    if (!blocks || !blocks.length) return null;
    // 각 블록에서 다음에 사용할 id 의 최대값을 구해 모든 블록이 같은 id 로 추가되게 한다.
    var nextId = 0;
    for (var i = 0; i < blocks.length; i++) {
      var fonts = blocks[i].getElementsByTagNameNS(HH_NS, 'font');
      var mx = -1;
      for (var j = 0; j < fonts.length; j++) {
        var id = parseInt(fonts[j].getAttribute('id'), 10);
        if (!isNaN(id) && id > mx) mx = id;
      }
      if (mx + 1 > nextId) nextId = mx + 1;
    }
    // 각 블록에 같은 id 로 새 font 추가
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      var fnt = doc.createElementNS(HH_NS, 'hh:font');
      fnt.setAttribute('id', String(nextId));
      fnt.setAttribute('face', faceName);
      fnt.setAttribute('type', 'TTF');
      fnt.setAttribute('isEmbedded', '0');
      var info = doc.createElementNS(HH_NS, 'hh:typeInfo');
      info.setAttribute('familyType', 'FCAT_GOTHIC');
      info.setAttribute('weight', '6');
      info.setAttribute('proportion', '4');
      info.setAttribute('contrast', '0');
      info.setAttribute('strokeVariation', '1');
      info.setAttribute('armStyle', '1');
      info.setAttribute('letterform', '1');
      info.setAttribute('midline', '1');
      info.setAttribute('xHeight', '1');
      fnt.appendChild(info);
      block.appendChild(fnt);
      // fontCnt 갱신
      var cnt = parseInt(block.getAttribute('fontCnt'), 10);
      if (!isNaN(cnt)) block.setAttribute('fontCnt', String(cnt + 1));
    }
    return nextId;
  }

  // ── XML 헬퍼 ───────────────────────────────────────────────────
  function removeRedundantNsDecls(xml) {
    var seen = Object.create(null);
    return xml.replace(/ xmlns(?::[a-zA-Z0-9_-]+)?="[^"]*"/g, function (m) {
      if (seen[m]) return '';
      seen[m] = true;
      return m;
    });
  }
  function ensureXmlDecl(serialized, original) {
    if (/^﻿?\s*<\?xml/i.test(serialized)) return serialized;
    var decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    var m = original.match(/^﻿?\s*(<\?xml[^>]*\?>)/i);
    if (m) decl = m[1] + '\n';
    return decl + serialized;
  }
  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // XML 1.0 금지 제어 문자 제거
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // marked v12 는 인라인 텍스트의 `"` `'` `<` `>` `&` 를 HTML 엔티티로 escape 한다.
  // 우리는 XML 에 들어갈 때 다시 escape 하므로, 그 전에 디코드해야 한다.
  // 안 그러면 `"` → marked → `&quot;` → escXml → `&amp;quot;` 가 되어
  // 한컴 화면에 `&quot;` 가 그대로 보인다.
  function decodeHtmlEntities(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');   // &amp; 는 마지막
  }

  // ── section0.xml 빌더 ──────────────────────────────────────────
  //
  // 빈 템플릿의 section0.xml 은 한 단락 안에 secPr(섹션 속성) 을 담고 있다.
  // 그 secPr 가 들어있는 첫 단락은 그대로 두고, 그 뒤에 본문 단락들을 끼워 넣은
  // 새로운 section0.xml 문자열을 만든다. 새 단락은 텍스트로 만들어 직렬화한다.
  function buildSection(originalSectionXml, paragraphsXml) {
    // 마지막 </hs:sec> 직전에 단락 XML 을 삽입
    var close = '</hs:sec>';
    var idx = originalSectionXml.lastIndexOf(close);
    if (idx < 0) throw new Error('section0.xml 에 </hs:sec> 가 없습니다');

    // 템플릿의 마지막 단락(빈 단락)을 제거: 빈 본문 줄이 결과 문서에 남으면 어색.
    // 빈 템플릿의 두 번째 hp:p 는 비어있는 본문 단락이므로 제거한다.
    // 다만 첫 hp:p 는 secPr 가 들어있어 반드시 유지.
    var head = originalSectionXml.slice(0, idx);
    // 마지막 hp:p 닫는 위치를 찾아 거기까지만 유지하는 단순화 처리는 위험하니,
    // 그냥 모든 hp:p 가 닫힌 뒤에 새 단락을 끼워 넣고, 뒤의 빈 단락은 그대로 두자.
    // (빈 한 줄은 일반적인 한글 문서의 끝과 다르지 않다.)
    return head + paragraphsXml + close;
  }

  // ── 단락/런 생성 ──────────────────────────────────────────────
  //
  // 단락(hp:p) → 1개 이상의 런(hp:run) → hp:t / hp:equation
  // 새 단락은 paraPrIDRef/styleIDRef 와 안에 들어갈 runs 배열을 받는다.
  // runs[i] = { type:'text', text, charPrId } | { type:'equation', script, charPrId } | { type:'lineBreak', charPrId }
  function paragraphXml(paraPrIDRef, styleIDRef, runs, idGen) {
    var inner = '';
    if (!runs || !runs.length) {
      inner = '<hp:run charPrIDRef="0"><hp:t/></hp:run>';
    } else {
      // 같은 charPrId 의 연속된 text run 을 하나의 hp:run 으로 묶는다.
      // equation 은 항상 별도 hp:run. 단락 내 줄바꿈(lineBreak)은 다중 단락으로
      // 분리하지 않고 무시한다(HWPX 의 단락 내 line break 명세가 불확실).
      var i = 0;
      while (i < runs.length) {
        var r = runs[i];
        if (r.type === 'lineBreak') { i++; continue; }
        if (r.type === 'equation') {
          inner += equationRunXml(r.script, r.charPrId || '0', idGen.next());
          i++;
          continue;
        }
        // 텍스트 런 묶기 (같은 charPrId 연속분)
        var startCp = r.charPrId || '0';
        var children = '';
        while (i < runs.length) {
          var cur = runs[i];
          if (cur.type === 'equation') break;
          if (cur.type === 'lineBreak') { i++; break; }
          if ((cur.charPrId || '0') !== startCp) break;
          if (cur.type === 'text') {
            children += '<hp:t>' + escXml(cur.text) + '</hp:t>';
          } else if (cur.type === 'tab') {
            children += '<hp:t><hp:tab width="4000" leader="0" type="0"/></hp:t>';
          }
          i++;
        }
        if (!children) children = '<hp:t/>';
        inner += '<hp:run charPrIDRef="' + escXml(startCp) + '">' + children + '</hp:run>';
      }
    }
    return '<hp:p id="0" paraPrIDRef="' + escXml(paraPrIDRef) +
           '" styleIDRef="' + escXml(styleIDRef) +
           '" pageBreak="0" columnBreak="0" merged="0">' + inner + '</hp:p>';
  }

  function equationRunXml(script, charPrId, id) {
    var s = String(script || '').trim();
    return '<hp:run charPrIDRef="' + escXml(charPrId) + '">' +
      '<hp:equation id="' + escXml(id) + '" zOrder="0" numberingType="EQUATION"' +
      ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"' +
      ' version="Equation Version 60" baseLine="0" textColor="#000000"' +
      ' baseUnit="1000" lineMode="CHAR" font="HancomEQN">' +
      '<hp:sz width="0" height="0" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0"' +
      ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP"' +
      ' horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:shapeComment>수식입니다.</hp:shapeComment>' +
      '<hp:script>' + escXml(s) + '</hp:script>' +
      '</hp:equation></hp:run>';
  }

  // ── 표 (hp:tbl) ────────────────────────────────────────────────
  //
  // 표 단락: 단락 안의 hp:run 자식으로 hp:tbl 를 직접 둔다.
  // 마크다운 표는 header row + body rows 로 모델링되어 있어 단순한 격자 변환.
  function tableXml(table, idGen, charPrMap, borderFillId, convertLatex, inlinePHs, inlineSent) {
    var bfId = borderFillId || '2';
    var rows = [];
    if (table.header) {
      var headerCells = table.header.map(function (cell) {
        return { tokens: cell.tokens || [{ type: 'text', text: cell.text || '' }] };
      });
      rows.push({ cells: headerCells, header: true });
    }
    (table.rows || []).forEach(function (row) {
      var cells = row.map(function (cell) {
        return { tokens: cell.tokens || [{ type: 'text', text: cell.text || '' }] };
      });
      rows.push({ cells: cells, header: false });
    });
    if (!rows.length) return '';

    var colCnt = Math.max.apply(null, rows.map(function (r) { return r.cells.length; }));
    var rowCnt = rows.length;
    // 폭(hp:sz width) 은 본문폭 약 42520 단위 — 컬럼당 동일 분배
    var totalW = 42520;
    var colW = Math.floor(totalW / colCnt);
    var rowH = 1500;
    var totalH = rowH * rowCnt;

    var rowsXml = '';
    for (var r = 0; r < rows.length; r++) {
      var cellsXml = '';
      var rowObj = rows[r];
      for (var c = 0; c < colCnt; c++) {
        var cell = rowObj.cells[c] || { tokens: [] };
        var cellTokens = injectInlineMath(cell.tokens || [], convertLatex, inlinePHs, inlineSent);
        var cellRuns = inlineTokensToRuns(cellTokens, charPrMap);
        var headerVal = rowObj.header ? '1' : '0';
        var cellPara = paragraphXml('0', '0', cellRuns, idGen);
        cellsXml +=
          '<hp:tc name="" header="' + headerVal + '" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="' + bfId + '">' +
            '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"' +
            ' linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0"' +
            ' hasTextRef="0" hasNumRef="0">' +
              cellPara +
            '</hp:subList>' +
            '<hp:cellAddr colAddr="' + c + '" rowAddr="' + r + '"/>' +
            '<hp:cellSpan colSpan="1" rowSpan="1"/>' +
            '<hp:cellSz width="' + colW + '" height="' + rowH + '"/>' +
            '<hp:cellMargin left="510" right="510" top="141" bottom="141"/>' +
          '</hp:tc>';
      }
      rowsXml += '<hp:tr>' + cellsXml + '</hp:tr>';
    }

    var tbl =
      '<hp:tbl id="' + idGen.next() + '" zOrder="0" numberingType="TABLE"' +
      ' textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None"' +
      ' pageBreak="CELL" repeatHeader="1" rowCnt="' + rowCnt + '" colCnt="' + colCnt + '"' +
      ' cellSpacing="0" borderFillIDRef="' + bfId + '" noAdjust="0">' +
        '<hp:sz width="' + totalW + '" height="' + totalH + '" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>' +
        '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0"' +
        ' holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP"' +
        ' horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
        '<hp:outMargin left="283" right="283" top="283" bottom="283"/>' +
        '<hp:inMargin left="510" right="510" top="141" bottom="141"/>' +
        rowsXml +
      '</hp:tbl>';
    return '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
           '<hp:run charPrIDRef="0">' + tbl + '<hp:t/></hp:run></hp:p>';
  }

  // ── 인라인 토큰 → runs 변환 ───────────────────────────────────
  //
  // marked.lexer 의 토큰 트리에서 인라인 토큰들을 받아 runs 배열을 만든다.
  // 인자: tokens = marked 의 inline 토큰 배열, charPrMap = extendHeader 결과
  // 옵션 ctx = { bold, italic, strike, code, link } 로 누적 스타일을 표현.
  function inlineTokensToRuns(tokens, charPrMap, ctx) {
    ctx = ctx || {};
    var out = [];
    if (!tokens) return out;

    function cpFor(c) {
      // 우선순위: 코드 > 링크 > 굵게+기울임 > 굵게 > 기울임 > 취소선 > 본문
      if (c.code) return charPrMap.code;
      if (c.link) return charPrMap.link;
      if (c.bold && c.italic) return charPrMap.boldItalic;
      if (c.bold) return charPrMap.bold;
      if (c.italic) return charPrMap.italic;
      if (c.strike) return charPrMap.strike;
      return charPrMap.body;
    }

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      switch (t.type) {
        case 'text':
        case 'escape':
          // marked v12 의 inline text 토큰은 `"` 등을 `&quot;` 로 escape 한 상태로 준다.
          // 우리는 XML 직렬화 시 다시 escape 하므로, 여기서 디코드해야 이중 escape 가 안 일어난다.
          var txt = decodeHtmlEntities(t.text || '');
          if (txt.indexOf('\x01') >= 0) {
            pushAll(out, decodeEmphasisMarkers(txt, charPrMap, ctx));
            break;
          }
          var lines = txt.split('\n');
          for (var li = 0; li < lines.length; li++) {
            if (li > 0) out.push({ type: 'lineBreak', charPrId: cpFor(ctx) });
            if (lines[li]) out.push({ type: 'text', text: lines[li], charPrId: cpFor(ctx) });
          }
          break;
        case 'strong':
          pushAll(out, inlineTokensToRuns(t.tokens || [], charPrMap, Object.assign({}, ctx, { bold: true })));
          break;
        case 'em':
          pushAll(out, inlineTokensToRuns(t.tokens || [], charPrMap, Object.assign({}, ctx, { italic: true })));
          break;
        case 'del':
          pushAll(out, inlineTokensToRuns(t.tokens || [], charPrMap, Object.assign({}, ctx, { strike: true })));
          break;
        case 'codespan':
          out.push({ type: 'text', text: decodeHtmlEntities(t.text || ''), charPrId: charPrMap.code });
          break;
        case 'link':
          // 링크는 텍스트(t.text)만 사용. URL 은 괄호로 첨부.
          var sub = inlineTokensToRuns(t.tokens || [{ type: 'text', text: t.text }], charPrMap, Object.assign({}, ctx, { link: true }));
          pushAll(out, sub);
          if (t.href && t.href !== t.text) {
            out.push({ type: 'text', text: ' (' + t.href + ')', charPrId: charPrMap.link });
          }
          break;
        case 'image':
          // v1: 이미지는 alt 텍스트만 ([그림: alt] 형태로 표시)
          out.push({ type: 'text', text: '[그림: ' + (t.text || t.alt || '') + ']', charPrId: charPrMap.italic });
          break;
        case 'br':
          out.push({ type: 'lineBreak', charPrId: cpFor(ctx) });
          break;
        case 'html':
          // HTML 태그는 텍스트로 처리하지 않고 가능한 한 무시. <br> 만 줄바꿈으로.
          if (/<br\s*\/?>/i.test(t.text || '')) {
            out.push({ type: 'lineBreak', charPrId: cpFor(ctx) });
          }
          break;
        case 'inlineMath': // 우리가 직접 주입하는 토큰
          out.push({ type: 'equation', script: t.script, charPrId: cpFor(ctx) });
          break;
        default:
          if (t.text) out.push({ type: 'text', text: decodeHtmlEntities(t.text), charPrId: cpFor(ctx) });
      }
    }
    return out;
  }

  function pushAll(a, b) { for (var i = 0; i < b.length; i++) a.push(b[i]); }

  // ── 한국어 emphasis 마커 디코더 ────────────────────────────────
  //
  // fixCjkEmphasis 가 삽입한 \x01 마커를 풀어 강조 run 으로 분해한다.
  //   \x01B ... \x01b   ← 굵게
  //   \x01I ... \x01i   ← 기울임
  //   \x01S ... \x01s   ← 취소선
  //   \x01C ... \x01c   ← 인라인 코드
  // 텍스트 토큰 안에 등장한 마커들은 입력 마크다운에서 강조 닫는 기호 뒤에
  // 한글이 바로 붙어 marked 가 강조로 인식하지 못한 케이스를 복구한다.
  function decodeEmphasisMarkers(text, charPrMap, baseCtx) {
    var runs = [];
    var ctx = Object.assign({}, baseCtx || {});

    function cpFor() {
      if (ctx.code) return charPrMap.code;
      if (ctx.link) return charPrMap.link;
      if (ctx.bold && ctx.italic) return charPrMap.boldItalic;
      if (ctx.bold) return charPrMap.bold;
      if (ctx.italic) return charPrMap.italic;
      if (ctx.strike) return charPrMap.strike;
      return charPrMap.body;
    }
    var buf = '';
    function flush() {
      if (!buf) return;
      var lines = buf.split('\n');
      for (var li = 0; li < lines.length; li++) {
        if (li > 0) runs.push({ type: 'lineBreak', charPrId: cpFor() });
        if (lines[li]) runs.push({ type: 'text', text: lines[li], charPrId: cpFor() });
      }
      buf = '';
    }

    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c === 1 /* \x01 */ && i + 1 < text.length) {
        var marker = text[i + 1];
        var handled = true;
        switch (marker) {
          case 'B': flush(); ctx.bold = true; break;
          case 'b': flush(); ctx.bold = false; break;
          case 'I': flush(); ctx.italic = true; break;
          case 'i': flush(); ctx.italic = false; break;
          case 'S': flush(); ctx.strike = true; break;
          case 's': flush(); ctx.strike = false; break;
          case 'C': flush(); ctx.code = true; break;
          case 'c': flush(); ctx.code = false; break;
          default:  handled = false;
        }
        if (handled) { i++; continue; }
      }
      buf += text[i];
    }
    flush();
    return runs;
  }

  // ── 한국어 emphasis 보정 (전처리) ──────────────────────────────
  //
  // 문제: AI 가 만든 마크다운에서 흔히 "**사과**는" 처럼 강조 닫는 기호 직후에
  // 조사(한글) 가 공백 없이 붙는다. CommonMark 명세상 닫는 `**` 가 punctuation
  // (예: `)`) 직후 + 한글 직전이면 닫는 마커로 인정되지 않아 강조가 깨진다.
  //
  // 해결: lexer 전에 이런 패턴을 발견해 강조를 \x01 마커로 변환해 둔다.
  // marked 는 \x01 을 일반 텍스트로 통과시키고, inlineTokensToRuns 의 text
  // 처리 단계에서 decodeEmphasisMarkers 가 다시 강조 run 으로 분해한다.
  //
  // CJK 판정: 한글(완성형·자모) + 일부 한자/일본어. 한글만으로도 대부분 케이스 커버.
  var CJK_CLASS = '[\\uAC00-\\uD7AF\\u3130-\\u318F\\u4E00-\\u9FFF\\u3040-\\u309F\\u30A0-\\u30FF]';

  function fixCjkEmphasis(md) {
    // 1) **bold** + CJK
    md = md.replace(
      new RegExp('\\*\\*([^*\\n]+?)\\*\\*(?=' + CJK_CLASS + ')', 'g'),
      function (_, body) { return '\x01B' + body + '\x01b'; }
    );
    // 2) ~~strike~~ + CJK
    md = md.replace(
      new RegExp('~~([^~\\n]+?)~~(?=' + CJK_CLASS + ')', 'g'),
      function (_, body) { return '\x01S' + body + '\x01s'; }
    );
    // 3) `code` + CJK — CommonMark codespan 은 한글 조사가 직접 붙어도 정상 파싱되므로
    //    여기서 변환하지 않는다. (오히려 인접 codespan 간 backtick 오인식 버그를 유발했음)
    // 4) *em* + CJK — `**` 는 위에서 이미 처리됐으니 단일 `*` 만 잡음
    md = md.replace(
      new RegExp('(^|[^*\\\\])\\*([^*\\n\\s]([^*\\n]*[^*\\n\\s])?)\\*(?=' + CJK_CLASS + ')', 'g'),
      function (_, pre, body) { return pre + '\x01I' + body + '\x01i'; }
    );
    return md;
  }

  // ── 인라인 수식 토큰 주입 ────────────────────────────────────
  //
  // marked 는 기본적으로 $...$ 를 수식으로 인식하지 않을 뿐 아니라,
  // 그 안의 `_`·`*` 를 강조 마커로 오해해 수식 자체를 망가뜨린다. 그래서 lexer 전에
  // preprocessMath() 가 모든 수식을 sentinel 로 치환해 두고, 여기서는 sentinel 만 풀어낸다.
  // 그래도 안전을 위해 raw `$...$` 도 fallback 처리.
  function injectInlineMath(tokens, convertLatex, inlinePHs, inlineSent) {
    if (!tokens) return tokens;
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'text' && t.text) {
        var s = splitInlineSentinel(t.text, inlinePHs, inlineSent);
        if (s) { pushAll(out, s); continue; }
        if (/\$|\\\(/.test(t.text)) {
          pushAll(out, splitMathText(t.text, convertLatex));
          continue;
        }
      }
      if (t.tokens) {
        var clone = Object.assign({}, t);
        clone.tokens = injectInlineMath(t.tokens, convertLatex, inlinePHs, inlineSent);
        out.push(clone);
      } else {
        out.push(t);
      }
    }
    return out;
  }

  function splitInlineSentinel(text, inlinePHs, sent) {
    if (!sent || !inlinePHs || text.indexOf(sent) < 0) return null;
    var re = new RegExp(sent + '(\\d+)' + sent, 'g');
    var out = [];
    var last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
      out.push({ type: 'inlineMath', script: inlinePHs[parseInt(m[1], 10)] });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
    return out;
  }

  function splitMathText(text, convertLatex) {
    var result = [];
    var i = 0, n = text.length;
    var buf = '';
    function flushText() {
      if (buf) { result.push({ type: 'text', text: buf }); buf = ''; }
    }
    while (i < n) {
      if (text[i] === '\\' && text[i + 1] === '(') {
        var end = text.indexOf('\\)', i + 2);
        if (end >= 0) {
          flushText();
          var raw1 = text.slice(i + 2, end);
          result.push({ type: 'inlineMath', script: convertLatex(raw1) });
          i = end + 2; continue;
        }
      }
      if (text[i] === '$') {
        // 닫는 $ 찾기 — 이중 $$는 블록 수식 (인라인 처리에서는 보존)
        if (text[i + 1] === '$') { buf += '$$'; i += 2; continue; }
        var endDollar = text.indexOf('$', i + 1);
        if (endDollar > i + 1) {
          var body = text.slice(i + 1, endDollar);
          if (shouldConvertInlineMath(body)) {
            flushText();
            result.push({ type: 'inlineMath', script: convertLatex(body) });
            i = endDollar + 1; continue;
          }
          // 한국어 포함 $..$ — $ 기호 제거, body를 텍스트로 처리
          // 직후에 \command 패턴이 이어지면 인라인 수식으로 변환
          if (/[가-힣]/.test(body)) {
            buf += body;
            i = endDollar + 1;
            var remKor = text.slice(i);
            var cmKor = remKor.match(/^\\[a-zA-Z]{2,}/);
            if (cmKor) { flushText(); result.push({ type: 'inlineMath', script: convertLatex(cmKor[0]) }); i += cmKor[0].length; }
            continue;
          }
        }
        // 닫는 $ 없는 경우 — $\command 패턴이면 인라인 수식으로 직접 변환
        if (endDollar < 0 && text[i + 1] === '\\') {
          var cmUnc = text.slice(i + 1).match(/^\\[a-zA-Z]{2,}/);
          if (cmUnc) { flushText(); result.push({ type: 'inlineMath', script: convertLatex(cmUnc[0]) }); i += 1 + cmUnc[0].length; continue; }
        }
      }
      buf += text[i++];
    }
    flushText();
    return result;
  }

  // 독립 LaTeX 단락 감지 — 구분자($$) 없이 출력된 수식 블록 처리
  // 한국어 없고, LaTeX 명령 있고, 수식 특유 패턴이 있어야 true
  function isLikelyUndelimitedMath(text) {
    var t = (text || '').trim();
    if (!t || t.length < 3) return false;
    if (/[가-힣]/.test(t)) return false;                          // 한국어 있으면 제외
    if (!/\\[a-zA-Z]/.test(t)) return false;                     // LaTeX 명령 필수
    if (/^`[^`\n]+`$/.test(t)) return false;                     // 인라인 코드 스팬 제외
    // 문서 구조 명령(수식 아님)
    if (/^\\(?:text|textbf|textit|textrm|textsc|section|subsection|subsubsection|begin|end|item|cite|ref|label|title|author|chapter|paragraph|newline|hline|vspace|hspace|noindent)\b/.test(t)) return false;
    // 수식 특유 패턴: 첨자 또는 수식 명령
    return /[_^]\{|[_^][a-zA-Z0-9]/.test(t) ||
      /\\(?:frac|sqrt|sum|int|prod|lim|mu|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|partial|nabla|infty|cdot|times|pm|mp|div|leq|geq|neq|approx|equiv|sim|propto|hat|vec|bar|dot|tilde|overline|underline|ln|exp|sin|cos|tan|log)\b/.test(t);
  }

  function shouldConvertInlineMath(body) {
    var v = body.trim();
    if (!v) return false;
    if (/^\d[\d,]*(?:\.\d+)?$/.test(v)) return false;          // 금액성 숫자
    if (/\\[A-Za-z]+|[_^{}=<>+\-*\/|]/.test(v)) return true;
    if (/[A-Za-z]\d|\d[A-Za-z]/.test(v)) return true;
    if (/^[A-Za-z]{1,3}$/.test(v)) return true;
    if (/^[A-Za-z]{1,3}['′’]+$/.test(v)) return true;
    // 함수형 표기: f(x), N(t), g(x,y), \phi(x) 등 — 짧지만 명백히 수식
    if (/^[A-Za-z]{1,3}\s*\([^()]*\)$/.test(v)) return true;
    // 대괄호 표기: E[X], P[A]
    if (/^[A-Za-z]{1,3}\s*\[[^\[\]]*\]$/.test(v)) return true;
    return false;
  }

  // ── ID 생성기 (기존 ID 와 충돌 방지) ─────────────────────────
  function makeIdGen(start) {
    var n = start || 2000000;
    return { next: function () { n++; return String(n); } };
  }

  // ── 마크다운 토큰 → 단락 XML 배열 ────────────────────────────
  function tokensToParagraphsXml(tokens, charPrMap, idGen, convertLatex, ctx) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      out.push(tokenToXml(tokens[i], charPrMap, idGen, convertLatex, ctx));
    }
    return out.filter(Boolean).join('');
  }

  // 리스트 아이템 텍스트 앞에 사용자가 직접 적어 둔 번호/한글 글머리 표시를
  // 제거한다 (예: `- 1. 첫째` → 마커 `•` + 텍스트 `첫째`).
  // 마커가 두 개 보이는 것을 방지.
  function stripListItemPrefix(text) {
    if (!text) return text;
    return text.replace(/^\s*(?:\d+|[가-힣]|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)、]\s+/, '');
  }

  // 인라인 토큰 트리의 가장 앞쪽 text 토큰에서 사용자 글머리 prefix 를 제거.
  function stripPrefixInTokens(tokens) {
    return stripPrefixInTokensWith(tokens, stripListItemPrefix);
  }

  function stripPrefixInTokensWith(tokens, fn) {
    if (!tokens || !tokens.length) return tokens;
    var t = tokens[0];
    if (t.type === 'text' && typeof t.text === 'string') {
      var stripped = fn(t.text);
      if (stripped !== t.text) {
        tokens = tokens.slice();
        tokens[0] = Object.assign({}, t, { text: stripped });
      }
    } else if (t.tokens && t.tokens.length) {
      var inner = stripPrefixInTokensWith(t.tokens, fn);
      if (inner !== t.tokens) {
        tokens = tokens.slice();
        tokens[0] = Object.assign({}, t, { tokens: inner });
      }
    }
    return tokens;
  }

  // 제목 텍스트 앞에 사용자가 직접 적어 둔 문단 번호를 제거한다.
  // HWP 의 개요 스타일이 이미 자동으로 문단 번호를 붙이므로 안 떼면 번호가 두 개로 보인다.
  //
  // 지원하는 prefix:
  //   ASCII 숫자: 1., 1.1., 1.1.1., 1), 1.1)
  //   ASCII 로마 숫자: I., II., iii., IV)
  //   유니코드 로마 숫자: Ⅰ. Ⅱ. Ⅲ. ⅰ. ⅱ. (U+2160~U+217F) — AI 가 흔히 출력하는 형태
  //   한글 한 글자: 가. 나. 가) 나)
  //   영문 한 글자: A. a. A)
  //   괄호형: (1) (가) (Ⅰ) (I) (a) — 전각 괄호 （） 도 인정
  //   제N장/절/항/편/부 (점·괄호 선택)
  //   복합형: Ⅰ-1. 1-가. 1.A. 등 두 단계 prefix
  //
  // 모든 패턴은 뒤에 공백 + 실제 제목 본문이 있어야만 매칭 — 안전 장치.
  function stripHeadingPrefix(text) {
    if (!text) return text;
    // 두 번까지 적용 (Ⅰ-1. 같은 복합 prefix 대응)
    for (var pass = 0; pass < 2; pass++) {
      var next = stripHeadingPrefixOnce(text);
      if (next === text) break;
      text = next;
    }
    return text;
  }

  function stripHeadingPrefixOnce(text) {
    var patterns = [
      // 제N장/절/항/편/부 (점·괄호 선택)
      /^\s*제\s*\d+\s*[장절항편부](?:\s*[.)])?\s+(\S[\s\S]*)$/,
      // 괄호형: (1), (가), (Ⅰ), (I), (a) — 전각 괄호 포함
      /^\s*[\(（]\s*(?:\d+(?:[.\-]\d+)*|[IVXLCDMivxlcdm]+|[Ⅰ-ⅿ]+|[가-힣]|[A-Za-z])\s*[\)）]\s+(\S[\s\S]*)$/,
      // 숫자 prefix: 1., 1.1., 1-1., 1), 1.1) — 끝 구분자 필수(그래야 `1 텍스트` 같은 본문을 잘라먹지 않음)
      /^\s*\d+(?:[.\-]\d+)*[.)]\s+(\S[\s\S]*)$/,
      // 유니코드 로마 숫자: Ⅰ. Ⅱ. ⅰ. ⅱ.
      /^\s*[Ⅰ-ⅿ]+[.)]\s+(\S[\s\S]*)$/,
      // ASCII 로마 숫자: I., II., III., iv., V)
      /^\s*[IVXLCDM]+[.)]\s+(\S[\s\S]*)$/,
      /^\s*[ivxlcdm]+[.)]\s+(\S[\s\S]*)$/,
      // 한글 한 글자 + 구분자: 가. 나. 가)
      /^\s*[가-힣][.)]\s+(\S[\s\S]*)$/,
      // 영문 한 글자: A. a. A)
      /^\s*[A-Za-z][.)]\s+(\S[\s\S]*)$/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) return m[1];
    }
    return text;
  }

  // 토큰 트리에서 inlineMath 만 들어있고(텍스트는 공백뿐) 인지 검사.
  // → 한 줄짜리 수식이면 가운데 정렬한다.
  function isOnlyInlineMath(tokens) {
    if (!tokens || !tokens.length) return false;
    var hasMath = false;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.type === 'inlineMath') { hasMath = true; continue; }
      if (t.type === 'text' || t.type === 'escape') {
        if ((t.text || '').replace(/\s+/g, '') !== '') return false;
        continue;
      }
      return false;
    }
    return hasMath;
  }

  function tokenToXml(token, charPrMap, idGen, convertLatex, ctx) {
    ctx = ctx || {};
    var paraPrMap = ctx.paraPrMap || { body: '0', center: '0' };
    var inlinePHs = ctx.inlinePHs, inlineSent = ctx.inlineSent;

    switch (token.type) {
      case 'space':
        return paragraphXml('0', '0', [], idGen);

      case 'heading': {
        var hp = PARA_HEADING(token.depth);
        var cp = charPrMap['h' + Math.min(token.depth, 6)] || charPrMap.h6;
        // 제목이 HWP 의 개요 번호 스타일을 받으므로, 사용자가 직접 적어 둔 번호(`I.`, `1.`, `가.`, `1)` 등)를 떼어내
        // 화면에 번호가 두 개로 보이지 않게 한다.
        var headTokens = stripPrefixInTokensWith(
          token.tokens || [{ type: 'text', text: token.text }],
          stripHeadingPrefix
        );
        var sub = injectInlineMath(headTokens, convertLatex, inlinePHs, inlineSent);
        var runs = inlineTokensToRuns(sub, charPrMap).map(function (r) {
          if (r.charPrId === charPrMap.body) r.charPrId = cp;
          return r;
        });
        return paragraphXml(hp.paraPrIDRef, hp.styleIDRef, runs, idGen);
      }

      case 'paragraph': {
        // 구분자 없는 LaTeX 블록 자동 감지 (Gemini 등이 $$ 없이 수식을 출력하는 경우)
        var rawPara = (token.text || '').trim();
        if (isLikelyUndelimitedMath(rawPara)) {
          return paragraphXml(paraPrMap.center, '0', [
            { type: 'equation', script: convertLatex(rawPara), charPrId: charPrMap.body }
          ], idGen);
        }
        var sub2 = injectInlineMath(token.tokens || [], convertLatex, inlinePHs, inlineSent);
        var runs2 = inlineTokensToRuns(sub2, charPrMap);
        var paraId2 = isOnlyInlineMath(sub2) ? paraPrMap.center : '0';
        return paragraphXml(paraId2, '0', runs2, idGen);
      }

      case 'blockquote': {
        var inner = (token.tokens || []).map(function (c) {
          if (c.type === 'paragraph') {
            var ts = injectInlineMath(c.tokens || [], convertLatex, inlinePHs, inlineSent);
            var rs = inlineTokensToRuns(ts, charPrMap).map(function (r) {
              if (r.charPrId === charPrMap.body) r.charPrId = charPrMap.quote;
              return r;
            });
            rs.unshift({ type: 'text', text: '❯ ', charPrId: charPrMap.quote });
            return paragraphXml('0', '0', rs, idGen);
          }
          return tokenToXml(c, charPrMap, idGen, convertLatex, ctx);
        }).join('');
        return inner;
      }

      case 'code': {
        var lines = String(token.text || '').split('\n');
        var blockOut = '';
        var codeParaId = paraPrMap.code || '0';
        var codeCharId = charPrMap.codeBlock || charPrMap.code;
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li];
          if (line) {
            blockOut += paragraphXml(codeParaId, '0', [
              { type: 'text', text: line, charPrId: codeCharId }
            ], idGen);
          } else {
            blockOut += paragraphXml(codeParaId, '0', [], idGen);
          }
        }
        return blockOut;
      }

      case 'hr':
        return paragraphXml('0', '0', [
          { type: 'text', text: '────────────────────────────────────────', charPrId: charPrMap.body }
        ], idGen);

      case 'list': {
        var out = '';
        var ordered = !!token.ordered;
        var startNum = token.start || 1;
        for (var ii = 0; ii < token.items.length; ii++) {
          var item = token.items[ii];
          var marker;
          if (item.task) marker = item.checked ? '☑ ' : '☐ ';
          else if (ordered) marker = String(startNum + ii) + '. ';
          else marker = '• ';

          var itemRuns = [{ type: 'text', text: marker, charPrId: charPrMap.body }];
          var extras = '';
          var sub = item.tokens || [];
          var prefixStripped = false;
          for (var k = 0; k < sub.length; k++) {
            var ch = sub[k];
            if (ch.type === 'text') {
              var srcTokens = ch.tokens || [{ type: 'text', text: ch.text }];
              if (!prefixStripped) { srcTokens = stripPrefixInTokens(srcTokens); prefixStripped = true; }
              var inj = injectInlineMath(srcTokens, convertLatex, inlinePHs, inlineSent);
              pushAll(itemRuns, inlineTokensToRuns(inj, charPrMap));
            } else if (ch.type === 'paragraph') {
              var srcTokens2 = ch.tokens || [];
              if (!prefixStripped) { srcTokens2 = stripPrefixInTokens(srcTokens2); prefixStripped = true; }
              var inj2 = injectInlineMath(srcTokens2, convertLatex, inlinePHs, inlineSent);
              pushAll(itemRuns, inlineTokensToRuns(inj2, charPrMap));
            } else {
              extras += tokenToXml(ch, charPrMap, idGen, convertLatex, ctx);
            }
          }
          out += paragraphXml('0', '0', itemRuns, idGen);
          out += extras;
        }
        return out;
      }

      case 'table': {
        var bfMap = ctx.borderFillMap || {};
        return tableXml(token, idGen, charPrMap, bfMap.tableDefault, convertLatex, inlinePHs, inlineSent);
      }

      case 'html': {
        // HTML 가운데 정렬 태그(<center>, <div align="center">, <p align="center">)는
        // 가운데 정렬 단락으로 처리. 나머지 태그는 거의 무시.
        var raw = (token.text || token.raw || '').trim();
        if (!raw) return '';
        if (/^<br\s*\/?>$/i.test(raw)) {
          return paragraphXml('0', '0', [], idGen);
        }
        var centerMatch = raw.match(/^<(?:center|div|p)\b[^>]*\balign\s*=\s*["']?center["']?[^>]*>([\s\S]*?)<\/(?:center|div|p)>$/i)
          || raw.match(/^<center>([\s\S]*?)<\/center>$/i);
        if (centerMatch) {
          var innerText = centerMatch[1].replace(/<[^>]+>/g, '').trim();
          // 안에 인라인 수식 sentinel 이 있을 수 있으니 풀어준다.
          var innerTokens = [{ type: 'text', text: innerText }];
          var injected = injectInlineMath(innerTokens, convertLatex, inlinePHs, inlineSent);
          var crs = inlineTokensToRuns(injected, charPrMap);
          return paragraphXml(paraPrMap.center, '0', crs, idGen);
        }
        // 평문으로 떨어진 HTML 은 태그 제거 후 그대로 출력
        var plain = raw.replace(/<[^>]+>/g, '');
        if (!plain.trim()) return '';
        return paragraphXml('0', '0', [
          { type: 'text', text: plain, charPrId: charPrMap.body }
        ], idGen);
      }

      default:
        var fallback = token.raw || token.text || '';
        if (!fallback) return '';
        return paragraphXml('0', '0', [
          { type: 'text', text: fallback, charPrId: charPrMap.body }
        ], idGen);
    }
  }

  // ── 마크다운 수식 ($$ ... $$, $...$, \[...\], \(...\)) 사전 처리 ───
  //
  // marked 는 $ 를 모를 뿐 아니라 그 안의 `_`·`*` 를 강조 마커로 오해해 수식을 망가뜨린다.
  // (예: `$\lambda_0$는` 처럼 한국어 조사가 붙으면 `_` 가 마커가 돼 수식 검출이 실패한다.)
  // 그래서 lexer 호출 전에 모든 수식을 미리 발견해 sentinel 로 치환한다.
  //   • 블록 수식 → 새 문단(\n\n SENT \n\n)
  //   • 인라인 수식 → 같은 문단 안에 ISENT
  // 코드 펜스 안의 $$ 는 보호.
  function preprocessMath(md, convertLatex) {
    var blockPHs = [];
    var inlinePHs = [];
    var BSENT = 'MDHWPMBLKPLH';
    var ISENT = 'MDHWPMINLPLH';

    // 1) 코드 펜스 마스킹
    var fences = [];
    var masked = md.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, function (m) {
      var i = fences.length;
      fences.push(m);
      return 'MDHWPFENCE' + i + 'END';
    });

    // 2) 블록 수식 $$ ... $$, \[ ... \], ChatGPT [ \n ... \n? ] 포맷
    masked = masked.replace(/\$\$([\s\S]+?)\$\$/g, function (_m, body) {
      var i = blockPHs.length;
      blockPHs.push(convertLatex(body));
      return '\n\n' + BSENT + i + BSENT + '\n\n';
    });
    // 2a) 잘못 닫힌 display math: $$...$ (닫는 $가 하나인 경우 — Grok 등)
    masked = masked.replace(/\$\$([^\n$]{1,300})\$(?!\$)/g, function (_m, body) {
      var t = body.trim();
      if (!t || !/\\[a-zA-Z]/.test(t)) return _m;
      var i = blockPHs.length;
      blockPHs.push(convertLatex(t));
      return '\n\n' + BSENT + i + BSENT + '\n\n';
    });
    masked = masked.replace(/\\\[([\s\S]+?)\\\]/g, function (_m, body) {
      var i = blockPHs.length;
      blockPHs.push(convertLatex(body));
      return '\n\n' + BSENT + i + BSENT + '\n\n';
    });
    // ChatGPT 블록 수식 포맷: [ 다음 줄에 LaTeX, ] 로 닫힘 (줄바꿈 유무 무관)
    // report-extract.js 에서 변환 실패한 경우의 fallback
    masked = masked.replace(/(?:^|\n)\[\n([\s\S]*?)\n?\](?=\n|$)/gm, function (_m, body) {
      var latex = body.trim().replace(/\n+/g, ' ').trim();
      if (!latex || !/\\[A-Za-z]/.test(latex)) return _m;
      var i = blockPHs.length;
      blockPHs.push(convertLatex(latex));
      return '\n\n' + BSENT + i + BSENT + '\n\n';
    });

    // 3) 인라인 수식 \( ... \), $ ... $
    masked = masked.replace(/\\\(([\s\S]+?)\\\)/g, function (_m, body) {
      var i = inlinePHs.length;
      inlinePHs.push(convertLatex(body));
      return ISENT + i + ISENT;
    });
    // $...$ — 같은 줄, 백슬래시-escape 된 $는 제외, 금액성 숫자 제외
    masked = masked.replace(/(^|[^\\$])\$([^\$\n]+?)\$(?!\d)/g, function (m, pre, body) {
      if (!shouldConvertInlineMath(body)) return m;
      var i = inlinePHs.length;
      inlinePHs.push(convertLatex(body));
      return pre + ISENT + i + ISENT;
    });

    // 3.5) 수식 처리 후 남은 고아 $ 정리 — 한글 바로 앞의 $ 는 수식 아님
    // 단, "$0$이 된다" 처럼 금액성 숫자로 판단해 일부러 sentinel 치환을 건너뛴(shouldConvertInlineMath
    // 참고) 완전히 닫힌 $...$ 쌍은 보호한다. 안 그러면 닫는 $ 만 stray 로 오인해 지워버려
    // "$0$이" → "$0이" 처럼 열린 $ 만 남는다.
    var moneyMasks = [];
    masked = masked.replace(/\$\d[\d,]*(?:\.\d+)?\$/g, function (m) {
      var i = moneyMasks.length;
      moneyMasks.push(m);
      return 'MDHWPMONEYPLH' + i + 'END';
    });
    masked = masked.replace(/\$(?=[가-힣])/g, '');
    masked = masked.replace(/MDHWPMONEYPLH(\d+)END/g, function (_m, i) {
      return moneyMasks[+i];
    });

    // 4) 코드 펜스 복원
    masked = masked.replace(/MDHWPFENCE(\d+)END/g, function (_m, i) {
      return fences[+i];
    });
    return {
      md: masked,
      placeholders: blockPHs,
      sentinel: BSENT,
      inlinePlaceholders: inlinePHs,
      inlineSentinel: ISENT
    };
  }
  function expandBlockMathInToken(token, placeholders, sentinel, charPrMap, idGen) {
    // paragraph 안에 SENT...SENT 패턴이 있으면 그 부분을 수식 단락으로 잘라낸다.
    if (token.type !== 'paragraph') return null;
    var raw = token.text || '';
    var re = new RegExp(sentinel + '(\\d+)' + sentinel, 'g');
    if (!re.test(raw)) return null;
    re.lastIndex = 0;
    var pieces = [];
    var last = 0;
    var m;
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) {
        var pre = raw.slice(last, m.index).trim();
        if (pre) pieces.push({ kind: 'paragraph', text: pre });
      }
      pieces.push({ kind: 'math', script: placeholders[parseInt(m[1], 10)] });
      last = m.index + m[0].length;
    }
    if (last < raw.length) {
      var post = raw.slice(last).trim();
      if (post) pieces.push({ kind: 'paragraph', text: post });
    }
    return pieces;
  }

  // ── 진입점 ────────────────────────────────────────────────────
  //
  // options:
  //   fontFamily — 본문 글꼴 이름 (예: '함초롬바탕', '맑은 고딕')
  //   fontSizePt — 본문 글자 크기 (포인트, 예: 10, 11, 12)
  //   그 외 deps. 키들은 의존성 주입용.
  function convertMarkdown(md, options, deps) {
    // 하위 호환: convertMarkdown(md, deps) 형태로도 호출 가능
    if (options && !deps && (options.JSZip || options.marked || options.LatexToHwp ||
        options.DOMParser || options.XMLSerializer || options.templateUrl)) {
      deps = options;
      options = {};
    }
    options = options || {};
    deps = deps || {};
    var JSZipLib = deps.JSZip || global.JSZip;
    var marked = deps.marked || global.marked;
    var LatexToHwp = deps.LatexToHwp || global.LatexToHwp;
    var DOMParserCls = deps.DOMParser || global.DOMParser;
    var XMLSerializerCls = deps.XMLSerializer || global.XMLSerializer;
    var templateUrl = deps.templateUrl || 'templates/blank.hwpx';

    if (!JSZipLib) return Promise.reject(new Error('JSZip 가 필요합니다'));
    if (!marked) return Promise.reject(new Error('marked 가 필요합니다'));
    if (!LatexToHwp || typeof LatexToHwp.convert !== 'function') {
      return Promise.reject(new Error('LatexToHwp.convert 가 필요합니다'));
    }
    var convertLatex = LatexToHwp.convert;

    // 1) 수식(블록+인라인) 추출 → 토큰화 안 거치도록 sentinel 치환
    var pre = preprocessMath(String(md || ''), convertLatex);

    // 1.5) 한국어 emphasis 보정 — AI 의 "**사과**는" 같은 실수를 살린다
    // 인라인 코드(`...`)를 먼저 sentinel 로 치환해 fixCjkEmphasis 가 인접한 두 codespan 의
    // 닫는 backtick 을 다음 codespan 의 여는 backtick 으로 오인식하는 버그를 방지한다.
    var icodesMask = [];
    pre.md = pre.md.replace(/`[^`\n]+?`/g, function (m) {
      var idx = icodesMask.length;
      icodesMask.push(m);
      return 'MDHWPICODE' + idx + 'END';
    });
    pre.md = fixCjkEmphasis(pre.md);
    pre.md = pre.md.replace(/MDHWPICODE(\d+)END/g, function (_m, i) {
      return icodesMask[+i];
    });

    // 2) marked.lexer 로 토큰화
    var lexer = (typeof marked.lexer === 'function') ? marked.lexer : marked.Lexer.lex;
    var tokens = lexer(pre.md, { gfm: true, breaks: false });

    return loadTemplate(JSZipLib, templateUrl).then(function (zip) {
      // 3) header.xml 확장
      var headerName = 'Contents/header.xml';
      var sectionName = 'Contents/section0.xml';
      return Promise.all([
        zip.file(headerName).async('string'),
        zip.file(sectionName).async('string')
      ]).then(function (xmls) {
        var headerXmlStr = xmls[0];
        var sectionXmlStr = xmls[1];

        var ext = extendHeader(headerXmlStr, new DOMParserCls(), new XMLSerializerCls(), {
          fontFamily: options.fontFamily,
          fontSizePt: options.fontSizePt
        });
        var charPrMap = ext.charPr;
        var paraPrMap = ext.paraPr || { body: '0', center: '0' };
        var borderFillMap = ext.borderFill || { tableDefault: '2' };
        var newHeader = ext.xml;

        var convCtx = {
          inlinePHs: pre.inlinePlaceholders,
          inlineSent: pre.inlineSentinel,
          paraPrMap: paraPrMap,
          borderFillMap: borderFillMap
        };

        // 4) section0 본문 단락들 생성
        var idGen = makeIdGen(3000000);
        var bodyParagraphs = '';
        for (var i = 0; i < tokens.length; i++) {
          var token = tokens[i];
          var expanded = (token.type === 'paragraph')
            ? expandBlockMathInToken(token, pre.placeholders, pre.sentinel, charPrMap, idGen)
            : null;
          if (expanded) {
            for (var j = 0; j < expanded.length; j++) {
              var piece = expanded[j];
              if (piece.kind === 'math') {
                // 블록 수식은 가운데 정렬 단락으로.
                bodyParagraphs += paragraphXml(paraPrMap.center, '0', [
                  { type: 'equation', script: piece.script, charPrId: charPrMap.body }
                ], idGen);
              } else {
                var sub = marked.lexer(piece.text, { gfm: true, breaks: false });
                bodyParagraphs += tokensToParagraphsXml(sub, charPrMap, idGen, convertLatex, convCtx);
              }
            }
          } else {
            bodyParagraphs += tokenToXml(token, charPrMap, idGen, convertLatex, convCtx);
          }
        }

        var newSection = buildSection(sectionXmlStr, bodyParagraphs);

        // 5) ZIP 재구성
        return rebuildZip(JSZipLib, zip, {
          'Contents/header.xml': newHeader,
          'Contents/section0.xml': newSection
        });
      });
    });
  }

  // ── ZIP 재구성 (mimetype 우선·STORED 보존) ─────────────────────
  function rebuildZip(JSZipLib, originalZip, updates) {
    var out = new JSZipLib();
    var names = Object.keys(originalZip.files).filter(function (n) { return !originalZip.files[n].dir; });
    var ordered = [];
    if (names.indexOf('mimetype') !== -1) ordered.push('mimetype');
    for (var i = 0; i < names.length; i++) {
      if (names[i] !== 'mimetype') ordered.push(names[i]);
    }
    return Promise.all(ordered.map(function (name) {
      if (Object.prototype.hasOwnProperty.call(updates, name)) {
        return Promise.resolve([name, updates[name]]);
      }
      return originalZip.file(name).async('uint8array').then(function (data) { return [name, data]; });
    })).then(function (entries) {
      var map = {};
      entries.forEach(function (e) { map[e[0]] = e[1]; });
      ordered.forEach(function (name) {
        var opts = name === 'mimetype'
          ? { compression: 'STORE', createFolders: false }
          : { compression: 'DEFLATE', createFolders: false };
        out.file(name, map[name], opts);
      });
      // Chrome 의 "안전하지 않은 다운로드 차단" 경고는 application/octet-stream 다운로드를
      // 잠재적 위험으로 간주할 때 자주 발생한다. HWPX 는 ZIP 컨테이너이므로
      // 한컴 전용 MIME 으로 명시하면 브라우저가 알려진 문서 형식으로 인식해 경고가 사라진다.
      return out.generateAsync({ type: 'blob', mimeType: 'application/vnd.hancom.hwpx' });
    });
  }

  // ── 파일명 ────────────────────────────────────────────────────
  function makeOutputName(name) {
    if (!name) return 'output.hwpx';
    var dot = name.lastIndexOf('.');
    var stem = dot >= 0 ? name.slice(0, dot) : name;
    return stem + '.hwpx';
  }

  var api = {
    convertMarkdown: convertMarkdown,
    makeOutputName: makeOutputName
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MarkdownToHwpx = api;
})(typeof window !== 'undefined' ? window : globalThis);
