# AutoFix AI — Chatbot Backend

شات بوت تشخيص أعطال العربيات (كتابة + صورة + صوت) باستخدام Gemini، وبيدور على أقرب ورش (Google Places)
وأقرب أوناش ومراكز صيانة (من الباك إند الأساسي `smart-autofix-app`).

## التشغيل

```bash
npm install
cp .env.example .env   # وحط المفاتيح
npm start              # http://localhost:3000
npm test               # اختبارات من غير نت
```

> صفحة الويب التجريبية (`public/index.html`) محتاجة **https أو localhost** عشان الموقع والميكروفون يشتغلوا.
> فتحها من `http://192.168.x.x:3000` على الموبايل مش هيسمح بالموقع ولا بالميكروفون.

## الـ API (للربط مع تطبيق Flutter)

كل الطلبات ممكن تبعت `Authorization: Bearer <accessToken>` — نفس توكن تطبيق AutoFix.
السيرفر بيتأكد منه عن طريق `GET {MAIN_API_URL}/user/` وبيستخدم id المستخدم كمالك للمحادثات.
من غير توكن (وضع التجربة) لازم تبعت `userId`، والوضع ده بيتقفل بـ `REQUIRE_AUTH=true`.

### `POST /diagnose` — `multipart/form-data`

| الحقل | مطلوب | الوصف |
|---|---|---|
| `sessionId` | ✔ | معرّف المحادثة (6–64 حرف: `A-Z a-z 0-9 _ -`) — التطبيق بيولّده |
| `message` | واحد على الأقل من الثلاثة | نص المستخدم |
| `image` | | صورة (jpeg/png/webp/heic) حد أقصى 10MB |
| `audio` | | تسجيل صوتي (ogg/m4a/aac/mp3/wav/webm) حد أقصى 10MB |
| `latitude`, `longitude` | مستحسن | مكان المستخدم — ابعته مع كل رسالة لو متاح |
| `silent` | | `"1"` لرسالة داخلية مش بتتعرض (زي "تم تحديد الموقع" بعد ما المستخدم يسمح بالموقع) |
| `userId` | من غير توكن بس | |

الرد:

```json
{
  "risk_level": "safe | dangerous | need_more_info",
  "message": "الرد اللي يتعرض للمستخدم",
  "next_question": "سؤال توضيحي أو null (موجود كمان جوه message)",
  "transcribed_text": "النص المفرّغ من الصوت (لو بعت audio)",
  "location_needed": true,
  "nearby_garages":    [{ "name", "address", "phone", "rating", "distanceKm", "location": {"latitude","longitude"}, "mapsUrl" }],
  "nearby_tow_trucks": [{ "name", "phone", "rating", "distanceKm", "isAvailable", "location", "mapsUrl" }]
}
```

- `location_needed: true` ← اطلب إذن الموقع، وبعدين ابعت `silent=1` مع الإحداثيات.
- الأخطاء: `{ "error": "...", "retryable": true }` — لو `retryable` اعرض زرار "إعادة المحاولة".
  أكواد: `400` بيانات ناقصة، `401` التوكن انتهى، `409` لسه بيرد على الرسالة اللي قبلها، `413` ملف كبير،
  `415` نوع ملف مش مدعوم، `429` طلبات كتير، `502/503` الذكاء الاصطناعي مشغول.

### المحادثات

- `GET /api/conversations` ← `{ conversations: [{ id, title, updatedAt }] }`
- `GET /api/conversations/:id` ← `{ id, title, messages: [...] }`
- `DELETE /api/conversations/:id`
- `GET /health` ← `{ status: "ok" }` (لـ Render health check)

## النشر على Render

- Build: `npm install` — Start: `npm start`
- حط `GEMINI_API_KEY` و `GOOGLE_PLACES_API_KEY` في Environment (مش في الكود).
- ملفات `data/users` بتتمسح مع كل deploy على الخطة المجانية — للإنتاج انقلوا المحادثات لـ MongoDB
  (نفس قاعدة بيانات الباك إند الأساسي).
