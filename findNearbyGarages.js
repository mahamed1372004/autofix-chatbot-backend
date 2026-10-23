// findNearbyGarages.js
require("dotenv").config({ quiet: true });

async function findNearbyGarages(latitude, longitude, radiusMeters = 5000) {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY مش متظبط في .env");
  }

  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.location,places.rating,places.currentOpeningHours.openNow",
      },
      body: JSON.stringify({
        includedTypes: ["car_repair"],
        maxResultCount: 5,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: { latitude, longitude },
            radius: radiusMeters,
          },
        },
        languageCode: "ar",
      }),
    }
  );

  const data = await response.json();

  // قبل كده لو المفتاح غلط أو الـ API مش مفعّل كان بيرجع [] بصمت وكأن مفيش ورش
  if (!response.ok || data.error) {
    throw new Error(`Google Places ${response.status}: ${data.error?.message || "unknown error"}`);
  }

  if (!data.places) {
    return [];
  }

  return data.places.map((place) => ({
    name: place.displayName?.text || "بدون اسم",
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || "غير متاح",
    rating: place.rating || null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    location: place.location,
  }));
}

module.exports = { findNearbyGarages };