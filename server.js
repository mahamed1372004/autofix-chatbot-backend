require("dotenv").config({ quiet: true });
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { findNearbyGarages } = require("./findNearbyGarages");
const { verifyUserToken, findNearbyTowTrucks, findNearbyServiceCenters } = require("./mainApi");
const { detectIntent, parseCoords, parseModelReply } = require("./chatLogic");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY مش موجود في .env — انسخ .env.example لـ .env وحط المفتاح");
  process.exit(1);
}

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.set("trust proxy", 1); // على Render الطلبات بتعدي على proxy، ده بيخلي req.ip هو IP المستخدم الحقيقي
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==== أعطال لازم تتصنف "dangerous" دايمًا مهما كانت بسيطة ====
// الموديل لوحده ساعات بيصنف أعطال خطيرة على إنها "safe" ويدي المستخدم خطوات يعملها بنفسه
// (حصلت فعلًا في محادثة تجريبية: طقطقة الدركسيون اتصنفت safe).
// TODO(فريق AutoFix): كمّلوا القائمة من خبرتكم — كل سطر وصف قصير لعَرَض أو نظام.
const ALWAYS_DANGEROUS = [
  "أي مشكلة في الفرامل (الدواسة بتنزل لتحت، صوت احتكاك حديد، العربية بتسحب لجنب وهي بتفرمل)",
  "أي مشكلة في الدركسيون أو العفشة (طقطقة أو تقل مع اللف، رعشة في الطارة، العربية مش ماشية مستقيم)",
  "لمبة ضغط الزيت الحمرا أو لمبة الحرارة الحمرا أو مؤشر الحرارة في الأحمر",
];

const SYSTEM_PROMPT = `
أنت مساعد ذكي متخصص في تشخيص أعطال السيارات باللهجة المصرية.
مهمتك:
1. اسأل المستخدم أسئلة تشخيصية لو المعلومات مش كافية.
2. لما تتأكد من طبيعة العطل، قيّم مستوى الخطورة:
   - "safe": يقدر يصلحه بنفسه بإرشادك خطوة خطوة وبحذر شديد.
   - "dangerous": لازم يروح ورشة فورًا، ومتديهوش أي تعليمات صيانة.
   الأعطال دي تتصنف "dangerous" دايمًا حتى لو شكلها بسيط، ومتديش فيها خطوات إصلاح:
${ALWAYS_DANGEROUS.map((item) => `   • ${item}`).join("\n")}
   لو مش متأكد بين "safe" و"dangerous"، اختار "dangerous".
3. لو "safe"، اديله الخطوات مرقمة وبالتفصيل، مع تحذيرات السلامة قبل كل خطوة حساسة.
4. لو "dangerous"، وضّح ليه الحالة خطيرة والتحذيرات المهمة (زي ميفتحش غطا الردياتير وهو سخن مثلاً). ماتسألوش عن الورش، ده هيتحصل تلقائيًا من السيرفر بعد كده.
5. لو رسالة المستخدم فيها وصف بين قوسين مربعين زي [صوت ...] يبقى ده صوت متسجل من العربية نفسها، استخدمه في التشخيص.
أسلوب الرد (مهم جدًا):
- اتكلم بلهجة مصرية بسيطة ومحترمة ومهذبة، زي مهندس صيانة ودود بيكلم عميل.
- ممنوع تمامًا استخدام ألقاب أو نداءات زي: "يا باشا"، "يا سيدي"، "يا برنس"، "يا معلم"، "يا ريس"، "يا فندم"، "يا صاحبي".
- ممنوع تبدأ الرد بكلمة "بص" أو "اسمع" أو "طيب" أو "ماشي" أو "أهلاً" أو "مساء النور". ابدأ الرد مباشرة بالمعلومة المفيدة أو بالسؤال التشخيصي. ممنوع تبدأ بجمل مجاملة أو تعاطف أو دعاء زي "ألف سلامة" أو "سلامتك" أو "حمدلله على السلامة" أو "معلش". اتكلم بأسلوب فني محترف زي ميكانيكي خبير بيشخص العطل.
- خليك مباشر ومرتب ومطمئن، من غير مزاح ولا مبالغة في الود.
- ممنوع تمامًا تذكر أي رقم تليفون أو خط ساخن أو رقم طوارئ أو رقم ونش في ردك، حتى لو معروف (زي 122 أو 123 أو 180 أو 112). التطبيق بيعرض أرقام الطوارئ والونش للمستخدم لوحده تحت ردك، فلو لزم قول "تواصل مع الونش" قولها من غير أي رقم.
6. رد دايمًا بصيغة JSON بالشكل ده فقط، من غير أي نص زيادة أو Markdown:
{
  "risk_level": "safe" | "dangerous" | "need_more_info",
  "message": "الرد اللي هيتعرض للمستخدم (ولو عندك سؤال توضيحي حطه في آخر الرسالة)",
  "next_question": "سؤال توضيحي لو محتاج (أو null)"
}
`;

// ==== تخزين دائم للمحادثات: ملف JSON لكل مستخدم داخل data/users ====
// كل مستخدم (userId) ليه محادثاته الخاصة، وبتفضل محفوظة حتى لو السيرفر اتقفل واتفتح.
// ملاحظة: على Render المجاني الملفات دي بتتمسح مع كل deploy/restart — للإنتاج انقلوها لقاعدة بيانات.
const DATA_DIR = path.join(__dirname, "data", "users");
fs.mkdirSync(DATA_DIR, { recursive: true });

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/; // يمنع أي محاولة تلاعب بمسار الملفات
const isValidId = (x) => typeof x === "string" && ID_RE.test(x);
const userCache = {};

function loadUser(userId) {
  if (userCache[userId]) return userCache[userId];
  let data = { conversations: {} };
  try {
    data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${userId}.json`), "utf8"));
    if (!data.conversations) data.conversations = {};
  } catch (e) {
    // مستخدم جديد أو الملف مش موجود
  }
  userCache[userId] = data;
  return data;
}

function saveUser(userId) {
  const file = path.join(DATA_DIR, `${userId}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(userCache[userId]));
  fs.renameSync(tmp, file); // كتابة آمنة: لو الجهاز وقف في النص الملف القديم مايبوظش
}

function getConversation(userId, convId) {
  const user = loadUser(userId);
  if (!user.conversations[convId]) {
    user.conversations[convId] = {
      id: convId,
      title: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [], // السياق اللي بيتبعت لـ Gemini
      ui: [], // الرسائل اللي بتتعرض للمستخدم
      state: { awaitingGarageConsent: false, awaitingLocationOnly: false, pendingSearch: null },
    };
  }
  return user.conversations[convId];
}

// آخر 30 رسالة بس بتتبعت لـ Gemini عشان المحادثات الطويلة ماتبطّأش الرد
function recentHistory(history, max = 30) {
  const slice = history.slice(-max);
  while (slice.length && slice[0].role !== "user") slice.shift();
  return slice;
}

const mapsUrl = (loc) =>
  loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)
    ? `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`
    : null;

// ==== البحث عن ورش أو أوناش قريبة ====
// الورش: Google Places الأول (بيانات حقيقية)، ولو فشل أو مرجعش حاجة نستخدم مراكز الصيانة
// من الباك إند الأساسي. الأوناش: من الباك إند الأساسي بتاع التطبيق.
async function searchNearby(kind, coords) {
  console.log(`[بحث ${kind}] lat=${coords.lat}, lng=${coords.lng}`);

  if (kind === "tow") {
    let trucks = [];
    try {
      trucks = await findNearbyTowTrucks(coords.lat, coords.lng);
    } catch (err) {
      console.error("[بحث أوناش] فشل:", err.message);
    }
    trucks = trucks.map((t) => ({ ...t, mapsUrl: mapsUrl(t.location) }));
    return {
      risk_level: "dangerous",
      message: trucks.length
        ? "ده أقرب الأوناش ليك:"
        : "مقدرتش ألاقي ونش قريب منك دلوقتي. استخدم أرقام الطوارئ والإغاثة اللي في زرار 🚨.",
      nearby_tow_trucks: trucks,
    };
  }

  let garages = [];
  try {
    garages = await findNearbyGarages(coords.lat, coords.lng);
  } catch (err) {
    console.error("[بحث ورش] Google Places فشل:", err.message);
  }
  if (!garages.length) {
    try {
      garages = await findNearbyServiceCenters(coords.lat, coords.lng);
    } catch (err) {
      console.error("[بحث ورش] مراكز الصيانة من الباك إند الأساسي فشلت:", err.message);
    }
  }
  garages = garages.map((g) => ({ ...g, mapsUrl: mapsUrl(g.location) }));
  console.log(`[بحث ${kind}] عدد النتائج: ${garages.length}`);
  return {
    risk_level: "dangerous",
    message: garages.length ? "ده أقرب الورش المتاحة قريبة منك:" : "مقدرتش ألاقي ورش قريبة منك دلوقتي.",
    nearby_garages: garages,
  };
}

// ==== استدعاء Gemini مع timeout + إعادة محاولة + موديلات احتياطية ====
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const REQUEST_TIMEOUT_MS = 20000; // أي طلب يتقطع بعد 20 ثانية بدل ما يعلّق
const COOLDOWN_MS = 2 * 60 * 1000; // لو موديل فشل، نتجنبه دقيقتين
const modelCooldownUntil = {};

const BUSY_MESSAGE = "الخدمة مشغولة لحظة بسبب ضغط على الذكاء الاصطناعي. جرّب تاني كمان ثواني.";

function isRetryableError(err) {
  const status = err.status || err.code;
  if (status === 503 || status === 429 || status === 500 || status === 504) return true;
  // أخطاء الشبكة / الـ timeout (زي fetch failed و HeadersTimeoutError)
  const text = `${err.name || ""} ${err.message || ""} ${err.cause?.code || ""}`;
  return /fetch failed|timeout|timed out|abort|ECONNRESET|UND_ERR/i.test(text);
}

async function generateWithRetry(request, attemptsPerModel = 1) {
  const all = [request.model, ...FALLBACK_MODELS.filter((m) => m !== request.model)];
  // الموديلات اللي مش في فترة تهدئة الأول، وبعدين الباقي كآخر حل
  const now = Date.now();
  const ready = all.filter((m) => (modelCooldownUntil[m] || 0) <= now);
  const cooling = all.filter((m) => (modelCooldownUntil[m] || 0) > now);
  const models = [...ready, ...cooling];
  let lastErr;

  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      try {
        if (model !== request.model) console.log(`[Gemini] استخدام الموديل: ${model}`);
        const response = await ai.models.generateContent({
          ...request,
          model,
          config: {
            ...(request.config || {}),
            httpOptions: { timeout: REQUEST_TIMEOUT_MS },
          },
        });
        return response;
      } catch (err) {
        lastErr = err;
        const status = err.status || err.code || err.cause?.code || "network";
        if (!isRetryableError(err)) throw err; // خطأ حقيقي (مفتاح غلط، طلب غلط...)
        console.warn(`[Gemini] ${model} فشل (${status}) — هنجرب الموديل التالي`);
        modelCooldownUntil[model] = Date.now() + COOLDOWN_MS;
      }
    }
  }
  throw lastErr;
}

// ==== تحويل الصوت لنص باستخدام Gemini ====
// لو التسجيل صوت العربية نفسها (مش كلام)، بنطلب وصف للصوت بدل ما يضيع في التفريغ
async function transcribeAudio(buffer, mimeType) {
  const response = await generateWithRetry({
    model: PRIMARY_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: buffer.toString("base64") } },
          {
            text:
              "فرّغ الكلام في التسجيل الصوتي ده حرفيًا كنص باللهجة المصرية. " +
              "لو التسجيل مفيهوش كلام وفيه صوت صادر من العربية (زي طقطقة أو صفير أو خبط في الموتور)، " +
              "اكتب وصف قصير للصوت بين قوسين مربعين، زي: [صوت صفير عالي بيزيد مع دوس البنزين]. " +
              "رجّع النص بس من غير أي تعليق أو شرح زيادة.",
          },
        ],
      },
    ],
  });

  return (response.text || "").trim();
}

// ==== رفع الملفات: في الذاكرة بدل مجلد uploads ====
// قبل كده الصور اللي بتيجي وإحنا مستنيين موافقة/موقع ماكانتش بتتمسح وبتفضل في uploads/ للأبد.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  ogg: "audio/ogg", opus: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", flac: "audio/flac",
};

// تطبيقات الموبايل ساعات بتبعت الملف كـ application/octet-stream، فبنعرف نوعه من الامتداد
function fileMime(file) {
  const type = (file.mimetype || "").split(";")[0];
  if (type && type !== "application/octet-stream") return type === "video/webm" && file.fieldname === "audio" ? "audio/webm" : type;
  const ext = path.extname(file.originalname || "").slice(1).toLowerCase();
  return EXT_MIME[ext] || type;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 },
  fileFilter: (req, file, cb) => {
    const mime = fileMime(file);
    const ok =
      (file.fieldname === "image" && mime.startsWith("image/")) ||
      (file.fieldname === "audio" && mime.startsWith("audio/"));
    if (ok) return cb(null, true);
    cb(Object.assign(new Error("نوع الملف ده مش مدعوم. ابعت صورة أو تسجيل صوتي بس."), { code: "UNSUPPORTED_FILE" }));
  },
});

// ==== الحقول اللي السيرفر بيقبلها: صورة و/أو صوت ====
const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "audio", maxCount: 1 },
]);

// ==== حماية مفتاح Gemini من الاستخدام الزيادة: عدد طلبات محدود في الدقيقة لكل IP ====
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const requestLog = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, times] of requestLog) {
    if (!times.some((t) => t > cutoff)) requestLog.delete(ip);
  }
}, 5 * 60000).unref();

function rateLimit(req, res, next) {
  const now = Date.now();
  const times = (requestLog.get(req.ip) || []).filter((t) => now - t < 60000);
  if (times.length >= RATE_LIMIT_PER_MIN) {
    return res.status(429).json({ error: "طلبات كتير ورا بعض. استنى دقيقة وجرّب تاني.", retryable: true });
  }
  times.push(now);
  requestLog.set(req.ip, times);
  next();
}

// ==== تحديد المستخدم ====
// من تطبيق Flutter: بييجي Authorization header (نفس توكن الباك إند الأساسي) وبنتحقق منه هناك.
// من صفحة الويب التجريبية: userId من localStorage — ودي ممكن تتقفل بـ REQUIRE_AUTH=true.
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";

async function resolveUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    try {
      req.userId = await verifyUserToken(authHeader);
      return next();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return res.status(401).json({ error: "جلسة الدخول انتهت، سجّل دخول تاني." });
      }
      console.error("[Auth] فشل التحقق من التوكن:", err.message);
      return res.status(503).json({ error: "مقدرناش نتأكد من حسابك دلوقتي، جرّب تاني.", retryable: true });
    }
  }
  if (REQUIRE_AUTH) return res.status(401).json({ error: "لازم تسجّل دخول الأول." });

  const userId = req.body?.userId || req.query?.userId;
  if (!isValidId(userId)) return res.status(400).json({ error: "userId غير صالح" });
  req.userId = userId;
  next();
}

// طلب واحد بس في نفس الوقت لكل محادثة، عشان رسالتين ورا بعض مايبوظوش الـ state والـ history
const busyConversations = new Set();

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/diagnose", rateLimit, uploadFields, resolveUser, async (req, res) => {
  const userId = req.userId;
  const { sessionId, latitude, longitude, silent } = req.body;
  if (!isValidId(sessionId)) {
    return res.status(400).json({ error: "sessionId مطلوب" });
  }

  const lockKey = `${userId}/${sessionId}`;
  if (busyConversations.has(lockKey)) {
    return res.status(409).json({ error: "لسه بجهّز الرد على رسالتك اللي قبلها، استنى ثانية.", retryable: true });
  }
  busyConversations.add(lockKey);

  try {
    let message = typeof req.body.message === "string" ? req.body.message.trim() : "";
    const imageFile = req.files?.image?.[0];
    const audioFile = req.files?.audio?.[0];
    const coords = parseCoords(latitude, longitude);

    // لازم يبقى فيه نص، أو صوت، أو صورة على الأقل
    if (!message && !audioFile && !imageFile) {
      return res.status(400).json({ error: "لازم تبعت message أو audio أو image" });
    }

    // ==== لو فيه صوت، حوّله لنص الأول ====
    if (audioFile) {
      let transcribedText;
      try {
        transcribedText = await transcribeAudio(audioFile.buffer, fileMime(audioFile));
      } catch (err) {
        console.error("فشل تحويل الصوت لنص:", err);
        if (isRetryableError(err)) {
          return res.status(503).json({ error: BUSY_MESSAGE, retryable: true });
        }
        return res.status(500).json({ error: "حصل خطأ أثناء تحويل الصوت لنص" });
      }
      if (!transcribedText) {
        return res.status(400).json({ error: "مقدرتش أسمع حاجة واضحة في التسجيل، جرّب تسجل تاني." });
      }
      // لو المستخدم بعت نص وصوت مع بعض، ندمجهم. غير كده النص المفرغ هو الرسالة
      message = message ? `${message} ${transcribedText}` : transcribedText;
    }

    // لو المستخدم بعت صورة بس من غير نص، حط نص افتراضي بسيط عشان الموديل يبقى عنده سياق
    if (!message && imageFile) {
      message = "شايف الصورة دي، إيه المشكلة؟";
    }

    const conv = getConversation(userId, sessionId);
    const state = conv.state;
    const history = conv.history;
    const isSilent = silent === "1"; // رسالة داخلية من التطبيق (زي إرسال الموقع) مش بتظهر للمستخدم
    const intent = imageFile ? null : detectIntent(message); // صورة جديدة = مشكلة جديدة دايمًا

    // بيحفظ الرسالتين (المستخدم + البوت) ويرد على التطبيق
    const finish = (payload, opts = {}) => {
      if (audioFile) payload.transcribed_text = message; // الواجهة بتعرضه كتأكيد "🎤 سمعت: ..."
      if (!isSilent) {
        conv.ui.push({ role: "user", text: message, hasImage: !!imageFile, viaAudio: !!audioFile });
        if (!conv.title) conv.title = String(message).slice(0, 40);
      }
      conv.ui.push({
        role: "bot",
        text: payload.message,
        risk_level: payload.risk_level,
        nearby_garages: payload.nearby_garages,
        nearby_tow_trucks: payload.nearby_tow_trucks,
        transcribed_text: payload.transcribed_text,
      });
      if (!opts.modelAlreadyInHistory) {
        // نحفظ رد البوت في سياق Gemini كمان عشان يفتكر اللي قاله (زي نتيجة البحث عن الورش)
        let modelText = payload.message;
        if (Array.isArray(payload.nearby_garages)) {
          modelText += payload.nearby_garages.length
            ? `\n[التطبيق عرض ${payload.nearby_garages.length} ورش قريبة للمستخدم]`
            : "\n[البحث ملقاش ورش قريبة]";
        }
        if (Array.isArray(payload.nearby_tow_trucks)) {
          modelText += payload.nearby_tow_trucks.length
            ? `\n[التطبيق عرض ${payload.nearby_tow_trucks.length} أوناش قريبة للمستخدم]`
            : "\n[البحث ملقاش أوناش قريبة]";
        }
        history.push({ role: "model", parts: [{ text: modelText }] });
      }
      conv.updatedAt = Date.now();
      saveUser(userId);
      return res.json(payload);
    };

    const askForLocation = (kind) => {
      state.awaitingLocationOnly = true;
      state.pendingSearch = kind;
      return finish({
        risk_level: "dangerous",
        message:
          kind === "tow"
            ? "تمام، محتاج بس مكانك الحالي عشان أقدر أدورلك على أقرب ونش."
            : "تمام، محتاج بس مكانك الحالي عشان أقدر أدورلك على أقرب ورشة.",
        location_needed: true,
      });
    };

    const declineSearch = () => {
      state.awaitingGarageConsent = false;
      state.awaitingLocationOnly = false;
      state.pendingSearch = null;
      return finish({
        risk_level: "dangerous",
        message: "تمام، خليك بس حذر ومتحاولش تصلحها بنفسك، والأفضل تتواصل مع ميكانيكي تعرفه أو ونش أقرب وقت ممكن.",
      });
    };

    // ==== الحالة 0: إحنا مستنيين الإحداثيات بس (المستخدم وافق بالفعل) ====
    if (state.awaitingLocationOnly && !imageFile) {
      if (isSilent || intent === "yes" || intent === "tow") {
        history.push({ role: "user", parts: [{ text: message }] });
        const kind = intent === "tow" ? "tow" : state.pendingSearch || "garages";
        if (!coords) return askForLocation(kind);
        state.awaitingLocationOnly = false;
        state.pendingSearch = null;
        return finish(await searchNearby(kind, coords));
      }
      if (intent === "no") {
        history.push({ role: "user", parts: [{ text: message }] });
        return declineSearch();
      }
      // كلام جديد خالص: قبل كده كان بيفضل يرد "محتاج إذن الموقع" على أي رسالة للأبد
      // (ظاهر في الفيديو). دلوقتي بنلغي الانتظار ونكمل تشخيص عادي.
      state.awaitingLocationOnly = false;
      state.pendingSearch = null;
    }

    // ==== الحالة 1: إحنا مستنيين رد المستخدم على "تحب أبعتلك ورش؟" (أو طلب ونش في أي وقت) ====
    if ((state.awaitingGarageConsent && (intent === "yes" || intent === "no")) || intent === "tow") {
      history.push({ role: "user", parts: [{ text: message }] });
      state.awaitingGarageConsent = false;
      state.awaitingLocationOnly = false;
      if (intent === "no") return declineSearch();

      const kind = intent === "tow" ? "tow" : "garages";
      if (coords) return finish(await searchNearby(kind, coords));
      return askForLocation(kind);
    }

    // ==== الحالة 2: تشخيص عادي ====
    // ده كمان بيرد على الأسئلة الجانبية وإحنا مستنيين الموافقة، بس بسياق المحادثة كله
    // (قبل كده كانت بتروح لموديل تاني من غير السياق، والصور كانت بتتجاهل).
    // أي تشخيص جديد بيلغي أي بحث معلّق، عشان "اه" بعد كده تتفهم على السؤال الجديد بس
    state.awaitingGarageConsent = false;
    state.awaitingLocationOnly = false;
    state.pendingSearch = null;
    const parts = [];

    if (imageFile) {
      parts.push({
        inlineData: {
          mimeType: fileMime(imageFile),
          data: imageFile.buffer.toString("base64"),
        },
      });
    }

    parts.push({ text: message });
    history.push({ role: "user", parts });

    let response;
    try {
      response = await generateWithRetry({
        model: PRIMARY_MODEL,
        contents: recentHistory(history),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
        },
      });
    } catch (err) {
      history.pop(); // نشيل رسالة المستخدم اللي ماتردش عليها، عشان إعادة المحاولة متتكررش
      throw err;
    }

    const rawText = response.text;
    const parsed = parseModelReply(rawText);

    if (!parsed) {
      history.pop(); // من غير كده كانت رسالة المستخدم بتفضل في السياق من غير رد
      console.error("فشل تحليل رد الموديل:", rawText);
      return res.status(502).json({ error: "الرد مكانش واضح، جرّب تاني.", retryable: true });
    }

    history.push({ role: "model", parts: [{ text: rawText }] });

    // نشيل بيانات الصورة من الـ history بعد أول رد (الموديل وصفها في رده بالفعل)
    // ده بيخلي الرسائل اللي بعدها أسرع وأخف بكتير
    for (const entry of history) {
      if (entry.role === "user" && entry.parts.some((p) => p.inlineData)) {
        entry.parts = [
          { text: "[المستخدم أرسل صورة]" },
          ...entry.parts.filter((p) => !p.inlineData),
        ];
      }
    }

    if (parsed.risk_level === "dangerous") {
      state.awaitingGarageConsent = true;
      parsed.message += "\n\nتحب أبعتلك أقرب ورش صيانة قريبة منك؟ (اه/لأ) — ولو محتاج ونش اكتب «ونش».";
    }

    finish(parsed, { modelAlreadyInHistory: true });
  } catch (err) {
    console.error(err);
    if (isRetryableError(err)) {
      return res.status(503).json({ error: BUSY_MESSAGE, retryable: true });
    }
    res.status(500).json({ error: "حصل خطأ في السيرفر" });
  } finally {
    busyConversations.delete(lockKey);
  }
});

// ==== قائمة محادثات المستخدم (الأحدث الأول) ====
app.get("/api/conversations", resolveUser, (req, res) => {
  const list = Object.values(loadUser(req.userId).conversations)
    .filter((c) => c.ui.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title || "محادثة جديدة", updatedAt: c.updatedAt }));
  res.json({ conversations: list });
});

// ==== رسائل محادثة معينة (عشان نكمل من حيث وقفنا) ====
app.get("/api/conversations/:id", resolveUser, (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "معرّف غير صالح" });
  const conv = loadUser(req.userId).conversations[id];
  if (!conv) return res.status(404).json({ error: "المحادثة مش موجودة" });
  res.json({ id: conv.id, title: conv.title, messages: conv.ui });
});

// ==== حذف محادثة ====
app.delete("/api/conversations/:id", resolveUser, (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: "معرّف غير صالح" });
  const user = loadUser(req.userId);
  delete user.conversations[id];
  saveUser(req.userId);
  res.json({ status: "تم حذف المحادثة" });
});

// ==== أخطاء الرفع (ملف كبير / نوع مش مدعوم) بترجع JSON بدل صفحة HTML ====
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? "الملف كبير، الحد الأقصى 10 ميجا." : "الملف المرفوع مش مقبول.",
    });
  }
  if (err?.code === "UNSUPPORTED_FILE") return res.status(415).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "حصل خطأ في السيرفر" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`السيرفر شغال على http://localhost:${PORT}`);
});
