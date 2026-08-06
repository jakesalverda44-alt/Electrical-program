// Copy this file to `config.js` and fill in the key. `config.js` is gitignored —
// the API key authorizes lead creation against the live CRM, so it must not be
// committed (render.yaml keeps AUTOMATION_API_KEY dashboard-managed for the same
// reason). Chrome loads `config.js`, not this file.
//
// CRM_API_KEY must match AUTOMATION_API_KEY in the Render dashboard
// (accurate-power-crm → Environment). See README.md.
const CRM_BASE_URL = 'https://electrical-program.onrender.com/api';
const CRM_API_KEY = 'paste-the-automation-api-key-here';
