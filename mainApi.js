// mainApi.js
// ==== الربط مع الباك إند الأساسي بتاع AutoFix (smart-autofix-app) ====
// منه بناخد: التحقق من توكن المستخدم، أقرب الأوناش، وأقرب مراكز الصيانة.
require("dotenv").config({ quiet: true });

const MAIN_API_URL = (process.env.MAIN_API_URL || "https://smart-autofix-app.onrender.com").replace(/\/+$/, "");
// Render المجاني بينام، وأول طلب بعد النوم ممكن ياخد ~40 ثانية
const MAIN_API_TIMEOUT_MS = Number(process.env.MAIN_API_TIMEOUT_MS) || 45000;

async function mainApiGet(pathAndQuery, headers = {}) {
  const response = await fetch(`${MAIN_API_URL}/${pathAndQuery}`, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(MAIN_API_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(body?.message || `Main API ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

// بيانات الباك إند الأساسي فيها أرقام بالشكل ده "+2001255309316" (صفر زيادة بعد كود الدولة)
// والصح "+201255309316"، فبنصلحها قبل ما نعرضها للمستخدم
function normalizeEgyptPhone(phone) {
  if (typeof phone !== "string") return null;
  const p = phone.replace(/[\s-]/g, "");
  if (p.startsWith("+200")) return "+20" + p.slice(4);
  return p || null;
}

// ==== التحقق من توكن المستخدم عن طريق الباك إند الأساسي ====
// بنبعت نفس الـ Authorization header لـ GET /user/ ولو رجع بيانات المستخدم يبقى التوكن سليم.
// الكاش بيمنع إننا نسأل الباك إند الأساسي مع كل رسالة.
const tokenCache = new Map(); // authHeader -> { userId, expiresAt }
const TOKEN_CACHE_MS = 5 * 60 * 1000;

function extractUserId(body) {
  const candidates = [body?.data?.user, body?.data, body?.user, body];
  for (const c of candidates) {
    const id = c?._id || c?.id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

async function verifyUserToken(authHeader) {
  const cached = tokenCache.get(authHeader);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const body = await mainApiGet("user/", { Authorization: authHeader });
  const id = extractUserId(body);
  if (!id) throw Object.assign(new Error("مقدرناش نحدد المستخدم من التوكن"), { status: 401 });

  // نفس شكل الـ IDs اللي السيرفر بيقبلها في ملفات المحادثات
  const userId = "u_" + String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  tokenCache.set(authHeader, { userId, expiresAt: Date.now() + TOKEN_CACHE_MS });
  return userId;
}

// ==== أقرب الأوناش (من قاعدة بيانات التطبيق) ====
async function findNearbyTowTrucks(latitude, longitude, limit = 5) {
  const body = await mainApiGet(`tow-trucks/nearby?lat=${latitude}&lng=${longitude}&limit=${limit}`);
  return (body?.data || []).slice(0, limit).map((t) => ({
    name: t.name || "ونش",
    phone: normalizeEgyptPhone(t.phone),
    rating: t.rating ?? null,
    distanceKm: t.distanceKm ?? null,
    isAvailable: t.isAvailable ?? null,
    location: t.location?.coordinates
      ? { latitude: t.location.coordinates[1], longitude: t.location.coordinates[0] }
      : null,
  }));
}

// ==== أقرب مراكز الصيانة (من قاعدة بيانات التطبيق) — بنستخدمها لو Google Places فشل ====
async function findNearbyServiceCenters(latitude, longitude, limit = 5) {
  const body = await mainApiGet(`service-centers/nearby?lat=${latitude}&lng=${longitude}&limit=${limit}`);
  return (body?.data || []).slice(0, limit).map((c) => ({
    name: c.name || "مركز صيانة",
    address: c.address || "",
    phone: normalizeEgyptPhone(c.phone) || "غير متاح",
    rating: c.rating ?? null,
    openNow: null,
    distanceKm: c.distanceKm ?? null,
    location: c.location?.coordinates
      ? { latitude: c.location.coordinates[1], longitude: c.location.coordinates[0] }
      : null,
  }));
}

module.exports = {
  MAIN_API_URL,
  verifyUserToken,
  findNearbyTowTrucks,
  findNearbyServiceCenters,
  normalizeEgyptPhone,
};
