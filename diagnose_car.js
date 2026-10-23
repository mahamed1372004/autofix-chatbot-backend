require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// System instruction بيحدد شخصية وسلوك الشات بوت
const SYSTEM_PROMPT = `
أنت مساعد ذكي متخصص في تشخيص أعطال السيارات باللهجة المصرية.
مهمتك:
1. اسأل المستخدم أسئلة تشخيصية لو المعلومات مش كافية.
2. لما تتأكد من طبيعة العطل، قيّم مستوى الخطورة:
   - "safe": يقدر يصلحه بنفسه بإرشادك خطوة خطوة وبحذر شديد.
   - "dangerous": لازم يروح ورشة فورًا، ومتديهوش أي تعليمات صيانة.
3. لو "safe"، اديله الخطوات مرقمة وبالتفصيل، مع تحذيرات السلامة قبل كل خطوة حساسة.
4. لو "dangerous"، وضّح ليه، وقوله إنك هتقترح له أقرب ورشة.
5. رد دايمًا بصيغة JSON بالشكل ده فقط، من غير أي نص زيادة أو Markdown:
{
  "risk_level": "safe" | "dangerous" | "need_more_info",
  "message": "الرد اللي هيتعرض للمستخدم",
  "next_question": "سؤال توضيحي لو محتاج (أو null)"
}
`;

async function diagnoseCarIssue({ userText, imagePath }) {
  const parts = [];

  // لو المستخدم بعت صورة
  if (imagePath) {
    const imageData = fs.readFileSync(imagePath).toString("base64");
    parts.push({
      inlineData: {
        mimeType: "image/jpeg", // غيّرها حسب نوع الصورة (image/png, image/webp...)
        data: imageData,
      },
    });
  }

  // النص
  parts.push({ text: userText });

  const response = await ai.models.generateContent({
    model: "gemini-3.6-flash",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json", // بيجبر الموديل يرد JSON صحيح
    },
  });

  const rawText = response.text;

  try {
    return JSON.parse(rawText);
  } catch (err) {
    console.error("فشل في تحليل رد الموديل كـ JSON:", rawText);
    throw err;
  }
}

// مثال استخدام
(async () => {
  const result = await diagnoseCarIssue({
    userText: "العربية بتعمل صوت غريب لما بدور المكينة وفيه دخان أبيض من الشكمان",
    // imagePath: "./car_photo.jpg", // فك التعليق دي لو عندك صورة فعلية جوه نفس المجلد
  });

  console.log(result);
  // لو result.risk_level === "dangerous" -> نادِ على دالة البحث عن أقرب ورشة
})();
