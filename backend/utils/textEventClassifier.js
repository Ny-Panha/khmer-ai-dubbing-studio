/**
 * Shared Text Event Classifier, Vertical Text Reconstruction,
 * and Continuous On-Screen Introduction Consolidator.
 *
 * Used uniformly across Hybrid OCR, Gemini-only OCR, Fast OCR,
 * chunk stitching, Stage 5 reconciliation, Speaker ID, Stage 6,
 * and targeted episode repair — with zero hardcoded story names or episode IDs.
 */

const TEXT_CATEGORIES = Object.freeze({
  DIALOGUE: 'dialogue',
  CHARACTER_INTRODUCTION: 'character_introduction',
  MONSTER_INTRODUCTION: 'monster_introduction',
  LOCATION_INTRODUCTION: 'location_introduction',
  TIME_CARD: 'time_card',
  STORY_LORE: 'story_lore',
  SYSTEM_ANNOUNCEMENT: 'system_announcement',
  WATERMARK: 'watermark',
  DECORATIVE: 'decorative',
});

const VALID_TEXT_CATEGORY_SET = new Set(Object.values(TEXT_CATEGORIES));

const INTRO_NARRATION_CATEGORIES = new Set([
  TEXT_CATEGORIES.CHARACTER_INTRODUCTION,
  TEXT_CATEGORIES.MONSTER_INTRODUCTION,
  TEXT_CATEGORIES.LOCATION_INTRODUCTION,
  TEXT_CATEGORIES.STORY_LORE,
]);

const CONSOLIDATABLE_NON_DIALOGUE_CATEGORIES = new Set([
  TEXT_CATEGORIES.CHARACTER_INTRODUCTION,
  TEXT_CATEGORIES.MONSTER_INTRODUCTION,
  TEXT_CATEGORIES.LOCATION_INTRODUCTION,
  TEXT_CATEGORIES.TIME_CARD,
  TEXT_CATEGORIES.STORY_LORE,
  TEXT_CATEGORIES.SYSTEM_ANNOUNCEMENT,
]);

const NARRATOR_SPEAKER_LABEL = 'អ្នករៀបរាប់';
const NARRATOR_SPEAKER_ID = 'spk_narrator';

const HANZI_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fa5]/;
const ALL_HANZI_RE = /[\u3400-\u4dbf\u4e00-\u9fa5]+/g;
const SENTENCE_PUNCT_RE = /[。？！?!…]/;
const DIALOGUE_PRONOUN_OR_PARTICLE_RE = /[我你他她它咱您们吗呢吧呀啊哦嗯哈呵嘛呗啦哟喂]/;
const SPOKEN_CLAUSE_GRAMMAR_RE = /[的得着了过把被给让对从以虽然但是如果因为所以只要只有才能已经正在]/;

const WATERMARK_PATTERNS = [
  /(?:抖音|快手|小红书|哔哩哔哩|bilibili|西瓜视频|腾讯视频|爱奇艺|优酷|芒果TV)/i,
  /(?:关注|订阅|点赞|投币|收藏|转发|分享|水印|防盗|搬运|偷了.*视频)/,
  /(?:剧场|影视|动漫|短剧|解说)(?:号|社|君|台|TV)?$/,
  /^[@＠#]/,
];

const TIME_CARD_RE = /^(?:数|几|一|二|两|三|四|五|六|七|八|九|十|百|千|万|\d+)?(?:秒|刻|分钟|分|小时|时辰|天|日|周|星期|个月|月|载|年|纪元|世纪)(?:后|前|以后|以前|之后|之前|后半夜|前夜)?$|^片刻(?:后|之间)?$|^次日(?:清晨|傍晚|凌晨)?$|^当晚$|^翌[日年]$|^(?:古|上古|远古|太古|千年前|万年前|数年前|多年后|几年前|几年后)$/;

const MONSTER_RANK_RE = /[一二三四五六七八九十百千万\d]+(?:阶|级|品|星|重|境|代)/;
const MONSTER_NOUN_RE = /(?:兽|妖|魔|怪|龙|蛟|蟒|蛛|蝎|狼|虎|狮|豹|熊|猿|鹰|雕|傀儡|尸|鬼|煞|蛛皇|巨兽|妖兽|凶兽|魔兽|灵兽|神兽|异兽|圣兽|魂兽|荒兽)/;
const LOCATION_NOUN_RE = /(?:山脉?|山谷|峡谷|深渊|禁地|秘境|遗迹|古殿|大殿|宫殿|神殿|宗门?|派|阁|楼|塔|城|镇|村|府|庄|岛|域|界|洲|州|国|海|湖|渊|林|洞|岭|峰|关|崖|荒|原|空|落|室|厅|口|场|区|市|地|殿|顶)$/;
const END_CARD_RE = /^(?:本季完|未完待续|全剧终|剧终|敬请期待|下集预告|第?[一二三四五六七八九十百\d]+[季部章集回]?完)$/;
const CHARACTER_TITLE_NOUN_RE = /(?:宗主|长老|堂主|殿主|阁主|门主|谷主|峰主|城主|少主|圣女|圣子|神子|皇帝|皇上|太后|皇后|皇妃|贵妃|王爷|太子|公主|皇子|将军|元帅|都督|大人|先生|医师|炼药师|师兄|师姐|师弟|师妹|师父|师尊|老祖|前辈|董事长|总裁|经理|秘书|队长|首领|护法|使者|天尊|大帝|武帝|剑仙|尊者|真人|道长|仙子)$/;
const STORY_LORE_MARKER_RE = /(?:相传|传说|自古|当年|上古|太古|此地乃|此处乃|传闻|曾有|乃是|诞生于|修炼体系|境界划分|势力分布)/;
const SYSTEM_ANNOUNCEMENT_RE = /^(?:恭喜|检测|系统|警告|提示|获得|激活|绑定|冷却时间|通关|奖励|宿主|玩家|规则[一二三四五六七八九十\d])/;

function extractNormalizedHanzi(text = '') {
  const matches = String(text || '').match(ALL_HANZI_RE);
  return matches ? matches.join('') : '';
}

function normalizeSubtitleSurface(text = '') {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reconstruct reading order for OCR bounding boxes that form one or more vertical Chinese text columns.
 * Traditional Chinese vertical title cards stack glyphs top-to-bottom within a column,
 * and order multiple vertical columns right-to-left (when columns sit horizontally separated).
 *
 * @param {Array<{ text: string, bbox?: Array, xMin?: number, xMax?: number, yMin?: number, yMax?: number, conf?: number }>} boxes
 * @returns {{ text: string, orientation: 'vertical'|'horizontal', columnsCount: number }}
 */
function reconstructVerticalChineseText(boxes = []) {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return { text: '', orientation: 'horizontal', columnsCount: 0 };
  }

  const normalized = boxes
    .map((b) => {
      if (!b || !b.text) return null;
      const txt = String(b.text).trim();
      if (!txt) return null;
      let xMin = typeof b.xMin === 'number' ? b.xMin : null;
      let xMax = typeof b.xMax === 'number' ? b.xMax : null;
      let yMin = typeof b.yMin === 'number' ? b.yMin : null;
      let yMax = typeof b.yMax === 'number' ? b.yMax : null;
      if ((xMin === null || yMin === null) && Array.isArray(b.bbox) && b.bbox.length >= 4) {
        const xs = b.bbox.map((pt) => Number(pt[0]) || 0);
        const ys = b.bbox.map((pt) => Number(pt[1]) || 0);
        xMin = Math.min(...xs);
        xMax = Math.max(...xs);
        yMin = Math.min(...ys);
        yMax = Math.max(...ys);
      }
      if (xMin === null) xMin = 0;
      if (xMax === null) xMax = xMin + 1;
      if (yMin === null) yMin = 0;
      if (yMax === null) yMax = yMin + 1;
      const w = Math.max(0.001, xMax - xMin);
      const h = Math.max(0.001, yMax - yMin);
      return {
        text: txt,
        xMin,
        xMax,
        yMin,
        yMax,
        xCenter: (xMin + xMax) / 2,
        yCenter: (yMin + yMax) / 2,
        w,
        h,
        conf: typeof b.conf === 'number' ? b.conf : 0.9,
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    return { text: '', orientation: 'horizontal', columnsCount: 0 };
  }

  // Group into vertical columns using horizontal center proximity
  const columns = [];
  for (const item of normalized) {
    let targetCol = null;
    for (const col of columns) {
      const colW = Math.max(col.avgW, item.w);
      if (Math.abs(item.xCenter - col.avgX) <= colW * 0.95) {
        targetCol = col;
        break;
      }
    }
    if (!targetCol) {
      columns.push({
        items: [item],
        avgX: item.xCenter,
        avgW: item.w,
      });
    } else {
      targetCol.items.push(item);
      targetCol.avgX = targetCol.items.reduce((acc, it) => acc + it.xCenter, 0) / targetCol.items.length;
      targetCol.avgW = targetCol.items.reduce((acc, it) => acc + it.w, 0) / targetCol.items.length;
    }
  }

  // Order vertical columns right-to-left; within each column order glyphs top-to-bottom
  columns.sort((a, b) => b.avgX - a.avgX);
  const colTexts = columns.map((col) => {
    col.items.sort((a, b) => a.yCenter - b.yCenter);
    return col.items.map((it) => it.text).join('');
  });

  const isVerticalLayout =
    normalized.some((it) => it.h > it.w * 1.45 && extractNormalizedHanzi(it.text).length >= 2) ||
    columns.some((col) => col.items.length >= 2 && (col.items[col.items.length - 1].yCenter - col.items[0].yCenter) > col.avgW * 1.1);

  return {
    text: colTexts.join(colTexts.length > 1 ? ' ' : '').trim(),
    orientation: isVerticalLayout ? 'vertical' : 'horizontal',
    columnsCount: columns.length,
  };
}

/**
 * Classify detected on-screen Chinese text structurally and contextually into one of the
 * 9 canonical text categories without hardcoding story-specific names or episodes.
 */
function classifyTextEvent({
  text = '',
  textCategory = '',
  position = 'bottom_subtitle',
  orientation = 'horizontal',
  textRegion = '',
  deliveryType = 'dialogue',
  isCenterBottom = null,
} = {}) {
  const clean = normalizeSubtitleSurface(text);
  const explicit = String(textCategory || '').trim().toLowerCase();
  if (VALID_TEXT_CATEGORY_SET.has(explicit) && explicit !== TEXT_CATEGORIES.DIALOGUE) {
    return explicit;
  }

  if (!clean) return TEXT_CATEGORIES.DECORATIVE;

  const hanzi = extractNormalizedHanzi(clean);
  if (!hanzi) {
    if (WATERMARK_PATTERNS.some((re) => re.test(clean))) return TEXT_CATEGORIES.WATERMARK;
    return TEXT_CATEGORIES.DECORATIVE;
  }

  if (WATERMARK_PATTERNS.some((re) => re.test(clean))) {
    return TEXT_CATEGORIES.WATERMARK;
  }

  if (END_CARD_RE.test(hanzi)) {
    return TEXT_CATEGORIES.DECORATIVE;
  }

  if (TIME_CARD_RE.test(hanzi)) {
    return TEXT_CATEGORIES.TIME_CARD;
  }

  if (SYSTEM_ANNOUNCEMENT_RE.test(hanzi) || /^【.*】$/.test(clean)) {
    return TEXT_CATEGORIES.SYSTEM_ANNOUNCEMENT;
  }

  const posLower = String(position || '').toLowerCase();
  const oriLower = String(orientation || '').toLowerCase();
  const regionLower = String(textRegion || '').toLowerCase();
  const isTitleCardOrSide =
    posLower === 'title_card' ||
    oriLower === 'vertical' ||
    ['left_vertical', 'right_vertical', 'top_center', 'full_center'].includes(regionLower);

  // Explicit center-bottom horizontal line with dialogue cues stays dialogue unless strong intro structure applies
  const hasSentenceEnd = SENTENCE_PUNCT_RE.test(clean);
  const hasDialogueSpeechParticle = DIALOGUE_PRONOUN_OR_PARTICLE_RE.test(hanzi);
  const hasSpokenGrammar = SPOKEN_CLAUSE_GRAMMAR_RE.test(hanzi);

  if (isTitleCardOrSide || (!hasSentenceEnd && !hasDialogueSpeechParticle && !hasSpokenGrammar && isCenterBottom === false)) {
    if (MONSTER_RANK_RE.test(hanzi) && MONSTER_NOUN_RE.test(hanzi) && hanzi.length <= 16 && !hasSpokenGrammar) {
      return TEXT_CATEGORIES.MONSTER_INTRODUCTION;
    }
    if (STORY_LORE_MARKER_RE.test(hanzi) || (posLower === 'title_card' && hanzi.length >= 14)) {
      return TEXT_CATEGORIES.STORY_LORE;
    }
    if (LOCATION_NOUN_RE.test(hanzi) && hanzi.length <= 14 && !hasDialogueSpeechParticle && !hasSpokenGrammar) {
      return TEXT_CATEGORIES.LOCATION_INTRODUCTION;
    }
    if (CHARACTER_TITLE_NOUN_RE.test(hanzi) && hanzi.length <= 16 && !hasSpokenGrammar) {
      return TEXT_CATEGORIES.CHARACTER_INTRODUCTION;
    }
    if (oriLower === 'vertical' || posLower === 'title_card') {
      if (MONSTER_NOUN_RE.test(hanzi) && hanzi.length <= 12) {
        return TEXT_CATEGORIES.MONSTER_INTRODUCTION;
      }
      if (hanzi.length >= 12) {
        return TEXT_CATEGORIES.STORY_LORE;
      }
      return TEXT_CATEGORIES.CHARACTER_INTRODUCTION;
    }
  }

  // Even if mis-tagged as bottom_subtitle by an ROI-clipped model, unambiguous rank+monster noun card with zero dialogue syntax
  if (!hasSentenceEnd && !hasDialogueSpeechParticle && !hasSpokenGrammar && hanzi.length <= 10 && MONSTER_RANK_RE.test(hanzi) && MONSTER_NOUN_RE.test(hanzi)) {
    return TEXT_CATEGORIES.MONSTER_INTRODUCTION;
  }

  if (explicit === TEXT_CATEGORIES.DIALOGUE) {
    return TEXT_CATEGORIES.DIALOGUE;
  }
  if (String(deliveryType || '').toLowerCase() === 'narration' && isTitleCardOrSide) {
    return TEXT_CATEGORIES.STORY_LORE;
  }
  return TEXT_CATEGORIES.DIALOGUE;
}

function isIntroductionCategory(category = '') {
  return INTRO_NARRATION_CATEGORIES.has(String(category || '').toLowerCase());
}

function isNonSpokenMetadataCategory(category = '') {
  const norm = String(category || '').toLowerCase();
  return norm === TEXT_CATEGORIES.WATERMARK || norm === TEXT_CATEGORIES.DECORATIVE;
}

function isConsolidatableIntroOrTitle(seg = {}) {
  const cat = classifyTextEvent({
    text: seg.originalChineseText || seg.chineseText || seg.textZh || '',
    textCategory: seg.textCategory,
    position: seg.position,
    orientation: seg.orientation,
    textRegion: seg.textRegion,
    deliveryType: seg.deliveryType,
  });
  return (
    CONSOLIDATABLE_NON_DIALOGUE_CATEGORIES.has(cat) ||
    String(seg.position || '').toLowerCase() === 'title_card' ||
    String(seg.orientation || '').toLowerCase() === 'vertical'
  );
}

/**
 * Character-level Dice/Levenshtein-based similarity for short Chinese OCR titles/introductions.
 * Catches OCR single-character blur substitutions (e.g. '三阶白巨兽' vs '三阶岩石巨兽') cleanly.
 */
function computeChineseCharSimilarity(textA = '', textB = '') {
  const a = extractNormalizedHanzi(textA);
  const b = extractNormalizedHanzi(textB);
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  // Check suffix/prefix overlap + LCS length
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const lcs = dp[m][n];
  return (2 * lcs) / (m + n);
}

/**
 * Check if `fragmentText` is a partial prefix/suffix tail of `fullText` (e.g. bottom overhanging char '兽' of '三阶岩石巨兽').
 */
function isTailOrSubstringFragment(fragmentText = '', fullText = '') {
  const f = extractNormalizedHanzi(fragmentText);
  const g = extractNormalizedHanzi(fullText);
  if (!f || !g) return false;
  if (f === g) return true;
  if (f.length < g.length && g.includes(f)) {
    // Either trailing edge character(s) of vertical column OR multi-char contiguous slice
    return f.length >= 2 || g.endsWith(f) || g.startsWith(f);
  }
  return false;
}

/**
 * Check whether every Hanzi character of the shorter string appears in exact left-to-right
 * order inside the longer string (catches partial fade-in OCR reads like '内口' inside '内城庄园门口'
 * without matching distinct sibling names like '内城广场' vs '内城大殿').
 */
function isOrderedHanziSubsequence(shortText = '', longText = '') {
  const s = extractNormalizedHanzi(shortText);
  const l = extractNormalizedHanzi(longText);
  if (!s || !l || s.length < 2 || s.length > l.length) return false;
  let si = 0;
  for (let li = 0; li < l.length && si < s.length; li++) {
    if (l[li] === s[si]) si++;
  }
  return si === s.length;
}

/**
 * Determine whether two temporal observations/cues belong to ONE continuous on-screen introduction event.
 * Strict guard: NEVER collapses ordinary spoken dialogue lines!
 */
function areContinuousIntroductionEvents(segA = {}, segB = {}, { maxGapSec = 0.75, rawObservations = [] } = {}) {
  if (!segA || !segB) return false;

  const textA = normalizeSubtitleSurface(segA.originalChineseText || segA.chineseText || segA.textZh || '');
  const textB = normalizeSubtitleSurface(segB.originalChineseText || segB.chineseText || segB.textZh || '');
  const hanziA = extractNormalizedHanzi(textA);
  const hanziB = extractNormalizedHanzi(textB);
  if (!hanziA || !hanziB) return false;

  const catA = classifyTextEvent({ ...segA, text: textA });
  const catB = classifyTextEvent({ ...segB, text: textB });

  const introA = isConsolidatableIntroOrTitle({ ...segA, textCategory: catA });
  const introB = isConsolidatableIntroOrTitle({ ...segB, textCategory: catB });

  // Requirement #9 & #10 guard:
  // If NEITHER is an introduction/title card, NEVER consolidate as an intro event (protects repeated spoken dialogue!).
  if (!introA && !introB) return false;

  const sA = Number(segA.startSec ?? segA.timestampSec ?? 0);
  const eA = Number(segA.endSec ?? (sA + Number(segA.duration || 0.75)));
  const sB = Number(segB.startSec ?? segB.timestampSec ?? 0);
  const eB = Number(segB.endSec ?? (sB + Number(segB.duration || 0.75)));

  const firstStart = Math.min(sA, sB);
  const firstEnd = sA <= sB ? eA : eB;
  const secondStart = Math.max(sA, sB);
  const gap = parseFloat((secondStart - firstEnd).toFixed(2));
  const overlaps = secondStart <= firstEnd + 0.12;

  if (gap > maxGapSec) return false;

  // Never bridge across a confirmed empty gap if separated (unless literally overlapping)
  if (!overlaps && gap > 0.15 && Array.isArray(rawObservations) && rawObservations.length > 0) {
    const hasEmptyBetween = rawObservations.some(
      (o) => o && (o.isVerifiedEmpty || (!o.hasText && o.isVerified)) && o.timestampSec > firstEnd + 0.05 && o.timestampSec < secondStart - 0.05
    );
    if (hasEmptyBetween) return false;
  }

  // Case 1: One is an introduction/title card and the other is an overlapping/adjacent 1-2 char overhang fragment (e.g., bottom '兽' inside '三阶岩石巨兽')
  if ((introA !== introB)) {
    if (!overlaps && gap > 0.25) return false;
    const introText = introA ? hanziA : hanziB;
    const otherText = introA ? hanziB : hanziA;
    if (otherText.length <= 2 && isTailOrSubstringFragment(otherText, introText)) {
      return true;
    }
    // Requirement #9: Genuine simultaneous dialogue (>=3 Hanzi not a fragment of intro card) stays SEPARATE!
    return false;
  }

  // Case 2: Both are introduction/title cards
  if (hanziA === hanziB) return true;
  if (isTailOrSubstringFragment(hanziA, hanziB) || isTailOrSubstringFragment(hanziB, hanziA)) return true;
  if (isOrderedHanziSubsequence(hanziA, hanziB) || isOrderedHanziSubsequence(hanziB, hanziA)) return true;

  const sim = computeChineseCharSimilarity(hanziA, hanziB);
  if (sim >= 0.58) return true;

  // Same introduction category OR overlapping/touching multi-line wrap where shorter card characters
  // strongly overlap longer complete card (e.g. wrapped vertical OCR '城外哀诡危城' vs '哀诡界邪诡王城外')
  const regionA = String(segA.textRegion || '').toLowerCase();
  const regionB = String(segB.textRegion || '').toLowerCase();
  const sameRegion = !regionA || !regionB || regionA === regionB;
  if (sameRegion && (overlaps || gap <= 0.45)) {
    const commonChars = new Set([...hanziA].filter((ch) => hanziB.includes(ch)));
    const minLen = Math.min(new Set([...hanziA]).size, new Set([...hanziB]).size);
    if (catA === catB && commonChars.size >= Math.min(3, minLen)) {
      return true;
    }
    if (commonChars.size >= 3 && minLen > 0 && (commonChars.size / minLen) >= 0.65) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether every Hanzi character of the shorter string appears in exact left-to-right
 * order inside the longer string (catches partial fade-in OCR reads like '内口' inside '内城庄园门口'
 * without matching distinct sibling names like '内城广场' vs '内城大殿').
 */
function isOrderedHanziSubsequence(shortText = '', longText = '') {
  const s = extractNormalizedHanzi(shortText);
  const l = extractNormalizedHanzi(longText);
  if (!s || !l || s.length < 2 || s.length > l.length) return false;
  let si = 0;
  for (let li = 0; li < l.length && si < s.length; li++) {
    if (l[li] === s[si]) si++;
  }
  return si === s.length;
}

/**
 * Score candidate observation/cue text quality so consolidation always keeps the cleanest,
 * most complete, sharp OCR read rather than a blurry fade-in variant or 1-char tail fragment.
 */
function scoreIntroTextCandidate(seg = {}) {
  const txt = normalizeSubtitleSurface(seg.originalChineseText || seg.chineseText || seg.textZh || '');
  const hanzi = extractNormalizedHanzi(txt);
  const lenScore = Math.min(20, hanzi.length) * 10;
  const sharpBonus = (seg.isSharp === false || seg.uncertainOcr || seg.ocrConfidence === 'low') ? 0 : 12;
  const posBonus = (String(seg.position || '').toLowerCase() === 'title_card' || String(seg.orientation || '').toLowerCase() === 'vertical') ? 10 : 0;
  const geminiBonus = String(seg.ocrEngine || '').includes('gemini') || seg.ocrConfidence === 'high' ? 5 : 0;
  const confBonus = typeof seg.confidence === 'number' ? seg.confidence * 5 : 2;
  const obsCountBonus = Math.min(10, Number(seg.frameCount || 1)) * 2;
  return lenScore + sharpBonus + posBonus + geminiBonus + confBonus + obsCountBonus;
}

/**
 * Consolidate fragmented/fluctuating/overlapping continuous introduction events BEFORE sourceCueId minting
 * (or during chunk stitching / Fast OCR dedup / targeted episode repair).
 *
 * Strictly preserves:
 * - Ordinary dialogue cues (including simultaneous dialogue alongside intro cards)
 * - Genuine repeated dialogue across pauses/turns
 * - Watermark/decorative filtering
 */
function consolidateContinuousIntroductionCues(cues = [], { rawObservations = [], maxGapSec = 0.75, dropNonSpokenMetadata = true } = {}) {
  if (!Array.isArray(cues) || cues.length === 0) return [];

  const enriched = cues
    .map((cue) => {
      const txt = normalizeSubtitleSurface(cue.originalChineseText || cue.chineseText || cue.textZh || cue.text || '');
      if (!txt) return null;
      const textCategory = classifyTextEvent({
        text: txt,
        textCategory: cue.textCategory,
        position: cue.position,
        orientation: cue.orientation,
        textRegion: cue.textRegion,
        deliveryType: cue.deliveryType,
      });
      if (dropNonSpokenMetadata && isNonSpokenMetadataCategory(textCategory)) {
        return null;
      }
      const startSec = parseFloat(Number(cue.startSec ?? cue.sourceStartSec ?? 0).toFixed(2));
      const endSec = parseFloat(Math.max(startSec + 0.35, Number(cue.endSec ?? cue.sourceEndSec ?? (startSec + 1.2))).toFixed(2));
      const isIntro = isIntroductionCategory(textCategory);
      return {
        ...cue,
        startSec,
        endSec,
        duration: parseFloat((endSec - startSec).toFixed(2)),
        textZh: txt,
        originalChineseText: txt,
        chineseText: txt,
        textCategory,
        orientation: cue.orientation || (cue.position === 'title_card' ? 'vertical' : 'horizontal'),
        ...(isIntro ? {
          position: cue.position === 'bottom_subtitle' ? 'title_card' : (cue.position || 'title_card'),
          deliveryType: cue.deliveryType === 'dialogue' || cue.deliveryType === 'out_loud' || !cue.deliveryType
            ? 'narration'
            : cue.deliveryType,
        } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec);

  const output = [];

  for (const seg of enriched) {
    // Search backward among active/recent items in `output` (important when an intro card & simultaneous dialogue interleave)
    let matchedPrev = null;
    for (let i = output.length - 1; i >= 0; i--) {
      const cand = output[i];
      if (seg.startSec - cand.endSec > Math.max(maxGapSec, 1.5)) break;
      if (areContinuousIntroductionEvents(cand, seg, { maxGapSec, rawObservations })) {
        matchedPrev = cand;
        break;
      }
    }

    if (!matchedPrev) {
      output.push({ ...seg });
      continue;
    }

    const prevScore = scoreIntroTextCandidate(matchedPrev);
    const curScore = scoreIntroTextCandidate(seg);
    const winner = curScore > prevScore ? seg : matchedPrev;
    const mergedStart = parseFloat(Math.min(matchedPrev.startSec, seg.startSec).toFixed(2));
    const mergedEnd = parseFloat(Math.max(matchedPrev.endSec, seg.endSec).toFixed(2));

    // Preserve immutable sourceCueId from winner if present (or earliest non-fragment cue)
    const preferredSourceCueId = winner.sourceCueId || matchedPrev.sourceCueId || seg.sourceCueId || null;

    // Preserve user manual text edit if present on any merged cue
    const manualSeg = [matchedPrev, seg].find((s) => s.manualTextOverridden || s.userOverridden);
    const winnerText = manualSeg
      ? (manualSeg.originalChineseText || winner.originalChineseText)
      : winner.originalChineseText;

    matchedPrev.startSec = mergedStart;
    matchedPrev.endSec = mergedEnd;
    matchedPrev.duration = parseFloat(Math.max(0.35, mergedEnd - mergedStart).toFixed(2));
    matchedPrev.sourceStartSec = mergedStart;
    matchedPrev.sourceEndSec = mergedEnd;
    matchedPrev.textZh = winnerText;
    matchedPrev.originalChineseText = winnerText;
    matchedPrev.chineseText = winnerText;
    matchedPrev.textCategory = isIntroductionCategory(winner.textCategory)
      ? winner.textCategory
      : (isIntroductionCategory(matchedPrev.textCategory) ? matchedPrev.textCategory : seg.textCategory);
    matchedPrev.position = winner.position === 'title_card' || matchedPrev.position === 'title_card' || seg.position === 'title_card'
      ? 'title_card'
      : winner.position;
    matchedPrev.orientation = winner.orientation === 'vertical' || matchedPrev.orientation === 'vertical' || seg.orientation === 'vertical'
      ? 'vertical'
      : (winner.orientation || 'horizontal');
    matchedPrev.textRegion = winner.textRegion || matchedPrev.textRegion || seg.textRegion || '';
    matchedPrev.deliveryType = isIntroductionCategory(matchedPrev.textCategory)
      ? 'narration'
      : (winner.deliveryType || matchedPrev.deliveryType || 'dialogue');
    matchedPrev.isSharp = Boolean(matchedPrev.isSharp || seg.isSharp);
    if (matchedPrev.ocrConfidence !== 'high' && seg.ocrConfidence === 'high') {
      matchedPrev.ocrConfidence = 'high';
    }
    matchedPrev.frameCount = (matchedPrev.frameCount || 1) + (seg.frameCount || 1);
    if (preferredSourceCueId) {
      matchedPrev.sourceCueId = preferredSourceCueId;
    }
    if (manualSeg) {
      matchedPrev.manualTextOverridden = Boolean(manualSeg.manualTextOverridden);
      matchedPrev.userOverridden = Boolean(manualSeg.userOverridden);
      if (manualSeg.khmerTranslatedText) {
        matchedPrev.khmerTranslatedText = manualSeg.khmerTranslatedText;
        matchedPrev.khmerText = manualSeg.khmerText || manualSeg.khmerTranslatedText;
        matchedPrev.khmer = manualSeg.khmer || manualSeg.khmerTranslatedText;
      }
    }
    if (matchedPrev.speakerVisualHint === '' && seg.speakerVisualHint) {
      matchedPrev.speakerVisualHint = seg.speakerVisualHint;
    }
    if (matchedPrev.genderVotes && seg.genderVotes) {
      for (const [k, v] of Object.entries(seg.genderVotes)) {
        matchedPrev.genderVotes[k] = (matchedPrev.genderVotes[k] || 0) + v;
      }
    }
    const mergedIds = new Set([
      ...(Array.isArray(matchedPrev.consolidatedFromSourceCueIds) ? matchedPrev.consolidatedFromSourceCueIds : (matchedPrev.sourceCueId ? [matchedPrev.sourceCueId] : [])),
      ...(Array.isArray(seg.consolidatedFromSourceCueIds) ? seg.consolidatedFromSourceCueIds : (seg.sourceCueId ? [seg.sourceCueId] : [])),
    ]);
    if (mergedIds.size > 0) {
      matchedPrev.consolidatedFromSourceCueIds = Array.from(mergedIds);
    }
  }

  return output;
}

/**
 * Deterministic narrator metadata helper for unspoken / narrative introductions.
 */
function buildNarratorMetadataForIntro(narratorGender = 'male') {
  const normGender = String(narratorGender || 'male').toLowerCase() === 'female' ? 'female' : 'male';
  const voiceId = normGender === 'female' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';
  return {
    speaker: NARRATOR_SPEAKER_LABEL,
    speakerName: NARRATOR_SPEAKER_LABEL,
    speakerId: NARRATOR_SPEAKER_ID,
    characterId: NARRATOR_SPEAKER_ID,
    gender: normGender,
    voiceGender: normGender,
    speakerGender: normGender.toUpperCase(),
    characterGender: normGender.toUpperCase(),
    voiceActorTimbre: normGender.toUpperCase(),
    voiceId,
    khmerVoiceId: voiceId,
    voice: voiceId,
    deliveryType: 'narration',
    speakerStatus: 'verified',
    speakerVerified: true,
    speakerReviewNeeded: false,
    unverifiedSpeaker: false,
    voiceAssignmentSource: 'automatic',
    hasVerifiedName: true,
  };
}

module.exports = {
  TEXT_CATEGORIES,
  INTRO_NARRATION_CATEGORIES,
  CONSOLIDATABLE_NON_DIALOGUE_CATEGORIES,
  NARRATOR_SPEAKER_LABEL,
  NARRATOR_SPEAKER_ID,
  extractNormalizedHanzi,
  normalizeSubtitleSurface,
  reconstructVerticalChineseText,
  classifyTextEvent,
  isIntroductionCategory,
  isNonSpokenMetadataCategory,
  isConsolidatableIntroOrTitle,
  computeChineseCharSimilarity,
  isTailOrSubstringFragment,
  areContinuousIntroductionEvents,
  scoreIntroTextCandidate,
  consolidateContinuousIntroductionCues,
  buildNarratorMetadataForIntro,
};
