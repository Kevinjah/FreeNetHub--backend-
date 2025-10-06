
FreeNetHub-backend v3
Includes Google OAuth (light), telco SIM & WiFi provisioning stubs, simulated payments, admin-create endpoint.

Quick start:
1. npm install
2. copy .env.example .env and fill keys
3. node server.js
4. Visit /api/status and /auth/google (see README for full Google OAuth setup)

Google OAuth notes:
- Create OAuth credentials at Google Cloud Console. Set redirect URI to: https://<your-render-url>/auth/google/callback
- Fill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Render env or .env for local testing.
