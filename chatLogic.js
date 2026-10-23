// chatLogic.js
// دوال بسيطة من غير أي اتصال بالنت، منفصلة عن server.js عشان نقدر نختبرها (npm test)

// ==== فهم رد المستخدم على "تحب أبعتلك ورش؟" ====
// قبل كده كان بيدور على الكلمة جوه النص (includes)، فـ"اه ابعتلي الاقرب" كانت بتتفهم "لأ"
// عشان "الاقرب" جواها "لا"، و"ابعتلي رقم الونش" كانت بتتفهم موافقة على الورش.
// دلوقتي بنقارن كلمات كاملة بعد توحيد الحروف.
function normalizeArabic(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // التشكيل والتطويل
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

const TOW_WORDS = ["ونش", "الونش", "اونش", "الاونش", "ونشات", "سطحه", "tow"];
const NEGATION_PHRASES = ["مش عايز", "مش عاوز", "مش محتاج", "مش لازم", "مش دلوقتي", "مش مهم"];
const NO_WORDS = ["لا", "no", "nope", "متبعتش", "بلاش", "لاشكرا"];
const YES_WORDS = ["اه", "ايوه", "ايوا", "اوك", "تمام", "ماشي", "موافق", "يلا", "ياريت", "ابعت", "ابعتلي", "ابعتها", "ابعتهم", "عايز", "عاوز", "yes", "ok", "okay", "sure", "yep"];
const QUESTION_WORDS = ["هل", "ازاي", "ليه", "امتي", "فين", "ايه", "اي", "ينفع", "اقدر", "كام"];

// بيرجع "yes" | "no" | "tow" | null (null = كلام تاني، يروح للموديل)
function detectIntent(message) {
  const raw = String(message || "");
  const words = normalizeArabic(raw).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const padded = ` ${words.join(" ")} `;
  const hasWord = (list) => list.some((w) => words.includes(w));

  if (NEGATION_PHRASES.some((p) => padded.includes(` ${p} `))) return "no";
  if (hasWord(TOW_WORDS)) return "tow";
  // سؤال حقيقي ("تمام بس هل في خطورة؟") نسيبه للموديل يرد عليه بدل ما نعتبره موافقة
  if (/[?؟]/.test(raw) || hasWord(QUESTION_WORDS)) return null;
  if (hasWord(NO_WORDS)) return "no";
  if (hasWord(YES_WORDS)) return "yes";
  return null;
}

function parseCoords(latitude, longitude) {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ==== قراءة رد الموديل والتأكد إنه بالشكل المتفق عليه ====
const RISK_LEVELS = ["safe", "dangerous", "need_more_info"];

function parseModelReply(rawText) {
  let obj;
  try {
    obj = JSON.parse(rawText);
  } catch (e) {
    const match = String(rawText || "").match(/\{[\s\S]*\}/); // أحيانًا بيلف الـ JSON بـ ```json
    if (!match) return null;
    try {
      obj = JSON.parse(match[0]);
    } catch (e2) {
      return null;
    }
  }
  if (!obj || typeof obj.message !== "string" || !obj.message.trim()) return null;

  let message = obj.message.trim();
  const question = typeof obj.next_question === "string" ? obj.next_question.trim() : "";
  // الواجهة والتطبيق بيعرضوا message بس، فلو السؤال التوضيحي جه في next_question لوحده كان بيضيع
  if (question && question !== "null" && !message.includes(question)) {
    message += `\n\n${question}`;
  }
  return {
    risk_level: RISK_LEVELS.includes(obj.risk_level) ? obj.risk_level : "need_more_info",
    message,
    next_question: question && question !== "null" ? question : null,
  };
}

module.exports = { normalizeArabic, detectIntent, parseCoords, parseModelReply };
