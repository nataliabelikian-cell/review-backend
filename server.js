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

app.get("/autocomplete", async (req, res) => {
  try {
    const query = req.query.q || req.query.query;

    if (!query || query.length < 2) {
      return res.json({ predictions: [] });
    }

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input: query,
          key: GOOGLE_API_KEY,
          components: "country:us",
          language: "en",
          region: "us"
        }
      }
    );

    console.log("GOOGLE RESPONSE:", response.data);

    if (response.data.status !== "OK") {
      return res.json({
        predictions: [],
        googleStatus: response.data.status,
        googleError: response.data.error_message || null
      });
    }

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
    if (!query) return res.json({ predictions: [] });

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
          radius: 120,
          type: "establishment",
          key: GOOGLE_API_KEY,
          language: "en"
        }
      }
    );

    const results = nearbyResponse.data.results || [];

    res.json({
      predictions: results.map((item) => ({
        description: `${item.name}, ${item.vicinity || ""}`,
        placeId: item.place_id
      }))
    });
  } catch (error) {
    console.error("Business search error:", error.response?.data || error.message);
    res.status(500).json({ error: "Business search failed" });
  }
});

app.get("/place-details", async (req, res) => {
  try {
    const placeId = req.query.place_id || req.query.placeId;
    if (!placeId) return res.status(400).json({ error: "place_id is required" });

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: {
          place_id: placeId,
          key: GOOGLE_API_KEY,
          fields: "name,formatted_address,rating,user_ratings_total,photos,formatted_phone_number,website,place_id,url,types"
        }
      }
    );

    const place = response.data.result || {};

    let image = "";
    if (place.photos?.length) {
      image = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${place.photos[0].photo_reference}&key=${GOOGLE_API_KEY}`;
    }

    res.json({
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
    res.status(500).json({ error: "Place details failed" });
  }
});

app.get("/reviews", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const response = await axios.get(
      "https://api.app.outscraper.com/maps/reviews-v3",
      {
        params: {
          query: url,
          reviewsLimit: 20,
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

    res.json(reviews);
  } catch (error) {
    console.error("Reviews error:", error.response?.data || error.message);
    res.status(500).json({ error: "Reviews failed" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});