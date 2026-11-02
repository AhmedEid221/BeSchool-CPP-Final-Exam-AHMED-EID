# BeSchool C++ Final Exam — Google Login + Google Sheets

Express-based C++17 examination platform with Google Identity Services sign-in, one attempt per verified Google email, a server-authoritative 120-minute timer, Google Sheets attempt records, and Judge0-based grading.

## Features
- Google sign-in is verified on the server using the Google OAuth Web Client ID.
- A Google account can create only one attempt. Attempt state is stored in the `Attempts` sheet.
- The two-hour timer starts when `/api/start` successfully creates the attempt.
- The deadline is calculated and checked by the server, not by the browser clock.
- The same browser restores saved answers/code from local storage and resumes using the server's original deadline.
- MCQs and coding tasks are graded on the server; only the final score and status are stored in Sheets.
- C++17 code execution uses Judge0 CE by default.

## Google Sheet structure
Spreadsheet ID: `1HP2b_pHOPD-HyZ9ihGIbZSk1CLeFJclH3-GwVuDDY`

Create two tabs with these exact names and headers in row 1:

**Students**
`email | full_name | created_at`

**Attempts**
`email | start_time | end_time | status | score | submitted_at | answers_json | code_1 | code_2 | code_3 | code_4`

Share the spreadsheet with the service-account email as **Editor**. Keep General access restricted.

## Environment variables
- `GOOGLE_CLIENT_ID`: OAuth 2.0 Web application client ID.
- `GOOGLE_SHEET_ID`: Spreadsheet ID above.
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`: Base64-encoded contents of the downloaded service-account JSON key. Keep secret; never commit it.
- `SESSION_SECRET`: Long random secret used to sign the HttpOnly session cookie. Render Blueprint can generate this automatically.
- `JUDGE0_URL`: defaults to `https://ce.judge0.com`.
- `JUDGE0_LANGUAGE_ID`: defaults to `54` (C++).
- `PORT`: provided automatically by Render.

## Google OAuth setup (after deployment)
1. In Google Auth Platform, configure the app for External audience.
2. While the app is in Testing, add the intended student Google accounts as test users. Testing-mode apps are restricted to listed test users.
3. Create an OAuth client with application type **Web application**.
4. Add the deployed Render origin (for example `https://your-service.onrender.com`) under **Authorized JavaScript origins**.
5. This app uses Google Identity Services ID-token callback; no redirect URI is required for this flow.
6. Set the resulting client ID as `GOOGLE_CLIENT_ID` in Render.

## Run locally
```bash
npm install
cp .env.example .env
npm start
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, and `SESSION_SECRET` in `.env` before testing Google login. For local HTTP testing, create a separate OAuth JavaScript origin `http://localhost:3000`.

## Important operational notes
- In-progress answers and code are saved in Google Sheets and also cached in the browser for recovery. The authoritative deadline and one-attempt state are stored server-side in Sheets.
- The platform stores answer/code drafts in the Attempts sheet while the exam is active, then stores final score/status on submission.
- Judge0's public endpoint may be rate-limited or unavailable. Test all four coding tasks before the exam.
- Render Free services may sleep after inactivity. Open the site and verify it is awake before students arrive.
- This is an exam workflow, not a kiosk/lockdown browser; it cannot prevent screenshots, external devices, or all forms of cheating.
