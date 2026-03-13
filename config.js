// ─────────────────────────────────────────────────────────
//  FAMILY CALENDAR — CONFIGURATION
//  Fill in your Google API credentials below before deploying
// ─────────────────────────────────────────────────────────

const CONFIG = {
  // 1. Go to https://console.cloud.google.com/
  // 2. Create a project → Enable "Google Calendar API"
  // 3. Create OAuth 2.0 credentials (Web application)
  // 4. Add your GitHub Pages URL to "Authorized JavaScript origins"
  //    e.g. https://yourusername.github.io
  // 5. Paste your Client ID below:
  GOOGLE_CLIENT_ID: "985640991891-q492knegenifsdntd2715b86mthillt4.apps.googleusercontent.com",

  // Your Google API Key (from same console → API & Services → Credentials → API Key)
  GOOGLE_API_KEY: "AIzaSyDv9qJ85ytrUAYZjwnt8vKTkufn5TP3-H4",

  // Google Calendar API discovery doc & scope
  DISCOVERY_DOC: "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
  SCOPES: "https://www.googleapis.com/auth/calendar",

  // Family members and their colors
  MEMBERS: {
    Madeleine: { color: "#8b5cf6", light: "#ede9fe" },
    Caroline:  { color: "#ec4899", light: "#fce7f3" },
    Steven:    { color: "#3b82f6", light: "#dbeafe" },
  },

  // How many days ahead to show in agenda view
  AGENDA_DAYS: 30,
};
