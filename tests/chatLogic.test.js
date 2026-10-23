// npm test — اختبارات من غير نت ومن غير مفاتيح API
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectIntent, parseCoords, parseModelReply } = require("../chatLogic");
const { normalizeEgyptPhone } = require("../mainApi");

test("detectIntent: الحالات اللي كانت بتتفهم غلط قبل كده", () => {
  // "الاقرب" جواها "لا" — كانت بترجع no
  assert.equal(detectIntent("اه ابعتلي الاقرب"), "yes");
  // "لازم" جواها "لا" — كانت بترجع no
  assert.equal(detectIntent("لازم اروح ورشة؟"), null);
  // طلب ونش كان بيتفهم موافقة على الورش (ظاهر في الفيديو)
  assert.equal(detectIntent("ابعتلي رقم الونش"), "tow");
  assert.equal(detectIntent("اقصد ابعتلي رقم الونش الحكومي"), "tow");
  // سؤال جانبي كان بيتفهم موافقة
  assert.equal(detectIntent("تمام بس هل في خطورة لو مشيت بيها؟"), null);
  assert.equal(detectIntent("طيب ينفع اصلحها انا"), null);
});

test("detectIntent: موافقة ورفض عادي", () => {
  assert.equal(detectIntent("اه"), "yes");
  assert.equal(detectIntent("أيوه"), "yes");
  assert.equal(detectIntent("ok"), "yes");
  assert.equal(detectIntent("لأ شكرا"), "no");
  assert.equal(detectIntent("لا"), "no");
  assert.equal(detectIntent("مش عايز"), "no");
  assert.equal(detectIntent("لا مش عايز ونش"), "no");
  assert.equal(detectIntent("لا ابعتلي ونش بدل الورش"), "tow");
  assert.equal(detectIntent("العربية بتسخن بسرعة"), null);
  assert.equal(detectIntent(""), null);
});

test("parseModelReply: السؤال التوضيحي مايضيعش", () => {
  const r = parseModelReply(JSON.stringify({
    risk_level: "need_more_info",
    message: "محتاج أعرف تفاصيل أكتر.",
    next_question: "الدخان لونه إيه؟",
  }));
  assert.equal(r.risk_level, "need_more_info");
  assert.match(r.message, /الدخان لونه إيه؟/);
});

test("parseModelReply: JSON ملفوف بـ markdown أو ناقص", () => {
  const wrapped = '```json\n{"risk_level":"safe","message":"غيّر الفيوز","next_question":null}\n```';
  assert.equal(parseModelReply(wrapped).message, "غيّر الفيوز");
  assert.equal(parseModelReply("مش JSON خالص"), null);
  assert.equal(parseModelReply('{"risk_level":"safe"}'), null);
  // risk_level غريب يتحول need_more_info بدل ما الواجهة تعرض تاج غلط
  assert.equal(parseModelReply('{"risk_level":"high","message":"x"}').risk_level, "need_more_info");
});

test("parseCoords", () => {
  assert.deepEqual(parseCoords("30.0444", "31.2357"), { lat: 30.0444, lng: 31.2357 });
  assert.equal(parseCoords(undefined, "31"), null);
  assert.equal(parseCoords("200", "31"), null);
});

test("normalizeEgyptPhone: أرقام الباك إند الأساسي فيها صفر زيادة", () => {
  assert.equal(normalizeEgyptPhone("+2001255309316"), "+201255309316");
  assert.equal(normalizeEgyptPhone("+201255309316"), "+201255309316");
  assert.equal(normalizeEgyptPhone("010 1234 5678"), "01012345678");
  assert.equal(normalizeEgyptPhone(undefined), null);
});
