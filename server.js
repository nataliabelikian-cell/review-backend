const express = require("express");
const cors = require("cors");
const axios = require("axios");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY;

function isPhoneQuery(query) {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 7;
}

function getStreetSearchText(query) {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\s+/g, " ")
    .trim();
}

app.get("/autocomplete", async (req, res) => {
  try {
    const query = req.query.q || req.query.query;

    if (!query || query.length < 2) {
      return res.json({ predictions: [] });
    }

    if (isPhoneQuery(query)) {
      const phoneResponse = await axios.get(
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
        {
          params: {
            input: query,
            inputtype: "phonenumber",
            key: GOOGLE_API_KEY,
            fields: "name,formatted_address,place_id"
          }
        }
      );

      return res.json({
        predictions: (phoneResponse.data.candidates || []).map((item) => ({
          description: `${item.name}, ${item.formatted_address || ""}`,
          placeId: item.place_id
        }))
      });
    }

    const hasNumber = /\d/.test(query);

    if (hasNumber) {
      const addressResponse = await axios.get(
        "https://maps.googleapis.com/maps/api/place/autocomplete/json",
        {
          params: {
            input: query,
            key: GOOGLE_API_KEY,
            components: "country:us",
            language: "en",
            region: "us",
            types: "address"
          }
        }
      );

      const addressPredictions = addressResponse.data.predictions || [];
      const businesses = [];
      const seen = new Set();

      const streetSearchText = getStreetSearchText(query);
      const streetNumber = streetSearchText.match(/\d+/)?.[0] || "";

      for (const prediction of addressPredictions.slice(0, 3)) {
        const detailsResponse = await axios.get(
          "https://maps.googleapis.com/maps/api/place/details/json",
          {
            params: {
              place_id: prediction.place_id,
              key: GOOGLE_API_KEY,
              fields: "geometry"
            }
          }
        );

        const location = detailsResponse.data.result?.geometry?.location;
        if (!location) continue;

        const nearbyResponse = await axios.get(
          "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
          {
            params: {
              location: `${location.lat},${location.lng}`,
              rankby: "distance",
              type: "establishment",
              key: GOOGLE_API_KEY,
              language: "en"
            }
          }
        );

        const results = nearbyResponse.data.results || [];

        results.forEach((item) => {
          const address = getStreetSearchText(item.vicinity || "");

          if (streetNumber && !address.includes(streetNumber)) {
            return;
          }

          if (!seen.has(item.place_id)) {
            seen.add(item.place_id);

            businesses.push({
              description: `${item.name}, ${item.vicinity || ""}`,
              placeId: item.place_id
            });
          }
        });
      }

      return res.json({
        predictions: businesses.slice(0, 20)
      });
    }

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input: query,
          key: GOOGLE_API_KEY,
          components: "country:us",
          language: "en",
          region: "us",
          types: "establishment"
        }
      }
    );

    return res.json({
      predictions: (response.data.predictions || []).map((item) => ({
        description: item.description,
        placeId: item.place_id
      }))
    });

  } catch (error) {
    console.error("Autocomplete error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "Autocomplete failed",
      details: error.response?.data || error.message
    });
  }
});

app.get("/business-search", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.json({ predictions: [] });
    }

    const geoResponse = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: query,
          key: GOOGLE_API_KEY,
          components: "country:US"
        }
      }
    );

    const location = geoResponse.data.results?.[0]?.geometry?.location;

    if (!location) {
      return res.json({ predictions: [] });
    }

    const nearbyResponse = await axios.get(
      "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
      {
        params: {
          location: `${location.lat},${location.lng}`,
          rankby: "distance",
          type: "establishment",
          key: GOOGLE_API_KEY,
          language: "en"
        }
      }
    );

    const results = nearbyResponse.data.results || [];
    const streetSearchText = getStreetSearchText(query);
    const streetNumber = streetSearchText.match(/\d+/)?.[0] || "";

    const filtered = results.filter((item) => {
      const address = getStreetSearchText(item.vicinity || "");
      return streetNumber ? address.includes(streetNumber) : true;
    });

    return res.json({
      predictions: filtered.slice(0, 20).map((item) => ({
        description: `${item.name}, ${item.vicinity || ""}`,
        placeId: item.place_id
      }))
    });

  } catch (error) {
    console.error("Business search error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "Business search failed"
    });
  }
});

app.get("/place-details", async (req, res) => {
  try {
    const placeId = req.query.place_id || req.query.placeId;

    if (!placeId) {
      return res.status(400).json({ error: "place_id is required" });
    }

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: {
          place_id: placeId,
          key: GOOGLE_API_KEY,
          fields:
            "name,formatted_address,rating,user_ratings_total,photos,formatted_phone_number,website,place_id,url,types"
        }
      }
    );

    const place = response.data.result || {};

    let image = "";

    if (place.photos?.length) {
      image = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`;
    }

    return res.json({
      name: place.name || "",
      address: place.formatted_address || "",
      rating: place.rating || 0,
      reviewsCount: place.user_ratings_total || 0,
      image,
      phone: place.formatted_phone_number || "",
      website: place.website || "",
      placeId: place.place_id || "",
      locationLink: place.url || "",
      types: place.types || []
    });

  } catch (error) {
    console.error("Place details error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "Place details failed"
    });
  }
});

app.get("/reviews", async (req, res) => {
  try {
    let url = req.query.url;
    const placeId = req.query.placeId || req.query.place_id;

    if (!url && placeId) {
      const detailsResponse = await axios.get(
        "https://maps.googleapis.com/maps/api/place/details/json",
        {
          params: {
            place_id: placeId,
            key: GOOGLE_API_KEY,
            fields: "url"
          }
        }
      );

      url = detailsResponse.data.result?.url;
    }

    if (!url) {
      return res.status(400).json({
        error: "URL or placeId is required"
      });
    }

    const response = await axios.get(
      "https://api.app.outscraper.com/maps/reviews-v3",
      {
        params: {
          query: url,
          reviewsLimit: 100,
          sort: "newest",
          async: false
        },
        headers: {
          "X-API-KEY": OUTSCRAPER_API_KEY
        }
      }
    );

    const reviews =
      response.data.data?.[0]?.reviews_data ||
      response.data.data?.[0]?.[0]?.reviews_data ||
      [];

    return res.json({ reviews });

  } catch (error) {
    console.error("Reviews error:", error.response?.data || error.message);

    return res.status(500).json({
      error: "Reviews failed",
      details: error.response?.data || error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});