require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JUDGE0_URL = (process.env.JUDGE0_URL || "https://ce.judge0.com").replace(/\/+$/, "");
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || "";
const JUDGE0_API_HOST = process.env.JUDGE0_API_HOST || "";
const JUDGE0_AUTH_TOKEN = process.env.JUDGE0_AUTH_TOKEN || "";
const JUDGE0_LANGUAGE_ID = Number(process.env.JUDGE0_LANGUAGE_ID || 54); // C++ (GCC 9.2.0)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const EXAM_DURATION_SECONDS = 2 * 60 * 60;
const googleTokenClient = new OAuth2Client(GOOGLE_CLIENT_ID);
let sheetsClientPromise = null;

function getSheetsClient() {
  if (sheetsClientPromise) return sheetsClientPromise;
  sheetsClientPromise = (async () => {
    if (!GOOGLE_SHEET_ID) throw new Error("GOOGLE_SHEET_ID is not configured.");
    let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
    if (!raw && process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) raw = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8");
    if (!raw) throw new Error("Google Sheets service account credentials are not configured.");
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    return google.sheets({ version: "v4", auth: await auth.getClient() });
  })();
  return sheetsClientPromise;
}
async function readSheet(range) {
  const sheets = await getSheetsClient();
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range });
  return result.data.values || [];
}
async function appendSheet(range, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [values] } });
}
async function updateSheet(range, values) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range, valueInputOption: "RAW", requestBody: { values: [values] } });
}
async function findStudent(email) {
  const rows = await readSheet("Students!A2:C");
  const index = rows.findIndex(row => String(row[0] || "").toLowerCase() === email.toLowerCase());
  return index < 0 ? null : { rowNumber: index + 2, values: rows[index] };
}
async function findAttempt(email) {
  const rows = await readSheet("Attempts!A2:K");
  const index = rows.findIndex(row => String(row[0] || "").toLowerCase() === email.toLowerCase());
  return index < 0 ? null : { rowNumber: index + 2, values: rows[index] };
}
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ email: user.email, name: user.name, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function getSession(req) {
  if (!SESSION_SECRET) return null;
  const cookie = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("beschool_session="));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice("beschool_session=".length));
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return user.exp > Date.now() ? user : null;
  } catch { return null; }
}
function requireAuth(req, res, next) {
  const user = getSession(req);
  if (!user) return res.status(401).json({ error: "Please sign in with Google first." });
  req.user = user;
  next();
}
async function requireActiveAttempt(req, res, next) {
  try {
    const attempt = await findAttempt(req.user.email);
    if (!attempt || attempt.values[3] !== "IN_PROGRESS") return res.status(403).json({ error: "There is no active exam attempt for this account." });
    if (Date.now() > new Date(attempt.values[2]).getTime()) return res.status(403).json({ error: "The exam time has expired. Submit your answers now." });
    req.examAttempt = attempt;
    next();
  } catch (error) { res.status(503).json({ error: `Could not verify the active attempt: ${error.message}` }); }
}

function attemptPayload(attempt) {
  if (!attempt) return null;
  const v = attempt.values;
  const start = new Date(v[1]);
  const end = new Date(v[2]);
  return { email: v[0], startTime: v[1], endTime: v[2], status: v[3], score: v[4] || "", submittedAt: v[5] || "", remainingSeconds: Math.max(0, Math.ceil((end.getTime() - Date.now()) / 1000)) };
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const ANSWER_KEY = [0, 1, 2, 3, 0, 1, 2, 3, 0, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 3];
const PROBLEMS = [
  {
    id: 0, title: "Array Statistics", marks: 5,
    tests: [
      { input: "10 20 30 40 50\n", expected: "50 10 30" },
      { input: "-5 -1 -9 -3 -7\n", expected: "-1 -9 -5" },
      { input: "2 2 2 2 2\n", expected: "2 2 2" },
      { input: "100 0 50 25 75\n", expected: "100 0 50" }
    ]
  },
  {
    id: 1, title: "String Analyzer", marks: 8,
    tests: [
      { input: "Hello World 123\n", expected: "2 8 3" },
      { input: "ABCxyz007\n", expected: "3 3 3" },
      { input: "NoDigits\n", expected: "2 6 0" },
      { input: "12345\n", expected: "0 0 5" }
    ]
  },
  {
    id: 2, title: "Recursive Array Sum", marks: 12,
    tests: [
      { input: "5\n1 2 3 4 5\n", expected: "15" },
      { input: "5\n-1 -2 -3 -4 -5\n", expected: "-15" },
      { input: "1\n99\n", expected: "99" },
      { input: "6\n10 0 -10 20 -5 5\n", expected: "20" }
    ]
  },
  {
    id: 3, title: "Pointer-Based Swap & Sort", marks: 15,
    tests: [
      { input: "5 4 3 2 1\n", expected: "1 2 3 4 5" },
      { input: "10 10 -1 0 5\n", expected: "-1 0 5 10 10" },
      { input: "7 2 9 2 1\n", expected: "1 2 2 7 9" },
      { input: "-5 -10 0 8 3\n", expected: "-10 -5 0 3 8" }
    ]
  }
];

const rateBuckets = new Map();
const startingEmails = new Set();
function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (bucket.count > 45) return res.status(429).json({ error: "Too many requests. Please wait a minute." });
  next();
}
app.use("/api", rateLimit);

function judgeHeaders() {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (JUDGE0_API_KEY) headers["X-RapidAPI-Key"] = JUDGE0_API_KEY;
  if (JUDGE0_AUTH_TOKEN) headers["X-Auth-Token"] = JUDGE0_AUTH_TOKEN;
  if (JUDGE0_API_HOST) headers["X-RapidAPI-Host"] = JUDGE0_API_HOST;
  return headers;
}
function requireJudge0(res) {
  if (!JUDGE0_URL) {
    res.status(503).json({ error: "Compiler is not configured yet. Set JUDGE0_URL in the server .env file, then restart the server." });
    return false;
  }
  return true;
}
async function createSubmission(source_code, stdin) {
  const endpoint = `${JUDGE0_URL}/submissions/?base64_encoded=false&wait=false`;
  const response = await fetch(endpoint, {
    method: "POST", headers: judgeHeaders(),
    body: JSON.stringify({
      source_code, language_id: JUDGE0_LANGUAGE_ID, stdin,
      cpu_time_limit: 2, cpu_extra_time: 0.5, wall_time_limit: 5,
      memory_limit: 128000, stack_limit: 64000,
      max_file_size: 1024
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Judge0 returned HTTP ${response.status}`);
  if (!body.token) throw new Error("Compiler did not return a submission token.");
  return body.token;
}
async function pollSubmission(token) {
  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 700));
    const response = await fetch(`${JUDGE0_URL}/submissions/${encodeURIComponent(token)}?base64_encoded=false`, { headers: judgeHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Compiler status request failed (${response.status})`);
    if (body.status && body.status.id > 2) return body;
  }
  throw new Error("Compilation is taking too long. Please try again.");
}
async function executeCpp(source_code, stdin) {
  const token = await createSubmission(source_code, stdin);
  return await pollSubmission(token);
}
function compilerResult(result) {
  const status = result.status?.description || "Unknown";
  return {
    status, statusId: result.status?.id || 0,
    stdout: result.stdout || "", stderr: result.stderr || "",
    compileOutput: result.compile_output || "",
    message: result.message || "",
    time: result.time || null, memory: result.memory || null
  };
}
function normalizedTokens(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}
function outputsMatch(actual, expected) {
  const a = normalizedTokens(actual), e = normalizedTokens(expected);
  if (a.length !== e.length) return false;
  return a.every((v, i) => {
    const an = Number(v), en = Number(e[i]);
    if (v !== "" && e[i] !== "" && Number.isFinite(an) && Number.isFinite(en)) {
      return Math.abs(an - en) <= 0.011 * Math.max(1, Math.abs(en));
    }
    return v === e[i];
  });
}
function safeSource(body) {
  return typeof body.source_code === "string" && body.source_code.trim().length > 0 &&
    body.source_code.length <= 30000 && !body.source_code.includes("\u0000");
}
app.get("/api/config", (req, res) => res.json({ googleClientId: GOOGLE_CLIENT_ID, examDurationSeconds: EXAM_DURATION_SECONDS }));

app.post("/api/auth/google", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !SESSION_SECRET) return res.status(503).json({ error: "Google login is not configured yet." });
  const credential = req.body?.credential;
  if (typeof credential !== "string" || credential.length > 10000) return res.status(400).json({ error: "Missing Google credential." });
  try {
    const ticket = await googleTokenClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.email || p.email_verified !== true) return res.status(403).json({ error: "Use a verified Google account to continue." });
    const user = { email: p.email.toLowerCase(), name: p.name || p.given_name || "Student" };
    const token = makeSession(user);
    const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `beschool_session=${encodeURIComponent(token)}; HttpOnly${secureCookie}; SameSite=Lax; Path=/; Max-Age=28800`);
    res.json({ user });
  } catch (error) {
    res.status(401).json({ error: "Google sign-in verification failed. Please try again." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `beschool_session=; HttpOnly${secureCookie}; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const attempt = await findAttempt(req.user.email);
    const student = await findStudent(req.user.email);
    const attemptInfo = attemptPayload(attempt);
    if (attemptInfo && student) attemptInfo.fullName = student.values[1] || req.user.name;
    let draft = null;
    if (attempt) {
      try { draft = { answers: JSON.parse(attempt.values[6] || "[]"), code: attempt.values.slice(7, 11).map(x => x || "") }; } catch { draft = null; }
    }
    res.json({ user: { email: req.user.email, name: req.user.name }, attempt: attemptInfo, draft });
  } catch (error) { res.status(503).json({ error: `Could not read exam records from Google Sheets: ${error.message}` }); }
});

app.post("/api/start", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 100) return res.status(400).json({ error: "Enter your full name." });
  const email = req.user.email;
  if (startingEmails.has(email)) return res.status(409).json({ error: "Your exam start is already being processed. Refresh and sign in again." });
  startingEmails.add(email);
  try {
    const existing = await findAttempt(email);
    if (existing) return res.status(409).json({ error: "This Google account has already used its exam attempt.", attempt: attemptPayload(existing) });
    const student = await findStudent(email);
    const now = new Date();
    const end = new Date(now.getTime() + EXAM_DURATION_SECONDS * 1000);
    if (!student) await appendSheet("Students!A:C", [email, name, now.toISOString()]);
    else await updateSheet(`Students!B${student.rowNumber}:B${student.rowNumber}`, [name]);
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: "Attempts!G1:K1", valueInputOption: "RAW", requestBody: { values: [["answers_json", "code_1", "code_2", "code_3", "code_4"]] } });
    await appendSheet("Attempts!A:K", [email, now.toISOString(), end.toISOString(), "IN_PROGRESS", "", "", "[]", "", "", "", ""]);
    res.json({ ok: true, attempt: { email, startTime: now.toISOString(), endTime: end.toISOString(), status: "IN_PROGRESS", remainingSeconds: EXAM_DURATION_SECONDS } });
  } catch (error) { res.status(503).json({ error: `Could not start the exam. Check Google Sheets access and configuration: ${error.message}` }); }
  finally { startingEmails.delete(email); }
});

app.post("/api/save-draft", requireAuth, async (req, res) => {
  const { answers, code } = req.body || {};
  if (!Array.isArray(answers) || answers.length !== 30 || !answers.every(x => x === null || (Number.isInteger(x) && x >= 0 && x <= 3))) return res.status(400).json({ error: "Invalid MCQ draft." });
  if (!Array.isArray(code) || code.length !== 4 || !code.every(x => typeof x === "string" && x.length <= 30000)) return res.status(400).json({ error: "Invalid coding draft." });
  try {
    const attempt = await findAttempt(req.user.email);
    if (!attempt || attempt.values[3] !== "IN_PROGRESS") return res.status(403).json({ error: "No active attempt is available to save." });
    if (Date.now() > new Date(attempt.values[2]).getTime()) return res.status(403).json({ error: "The exam deadline has passed." });
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Attempts!G${attempt.rowNumber}:K${attempt.rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[JSON.stringify(answers), ...code]] } });
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) { res.status(503).json({ error: `Could not save your answers: ${error.message}` }); }
});

app.get("/api/attempt", requireAuth, async (req, res) => {
  try {
    const attempt = await findAttempt(req.user.email);
    if (!attempt) return res.status(404).json({ error: "No exam attempt was found for this Google account." });
    const data = attemptPayload(attempt);
    if (data.status === "IN_PROGRESS" && data.remainingSeconds <= 0) data.expired = true;
    res.json({ attempt: data });
  } catch (error) { res.status(503).json({ error: `Could not read the exam attempt: ${error.message}` }); }
});

app.post("/api/run", requireAuth, requireActiveAttempt, async (req, res) => {
  if (!requireJudge0(res)) return;
  const { source_code, stdin = "" } = req.body || {};
  if (!safeSource(req.body || {})) return res.status(400).json({ error: "Enter valid C++ source code (maximum 30,000 characters)." });
  if (typeof stdin !== "string" || stdin.length > 10000) return res.status(400).json({ error: "Input is too long (maximum 10,000 characters)." });
  try {
    const result = await executeCpp(source_code, stdin);
    res.json(compilerResult(result));
  } catch (error) {
    res.status(502).json({ error: error.message || "Compiler service error." });
  }
});

app.post("/api/submit", requireAuth, async (req, res) => {
  if (!requireJudge0(res)) return;
  const { name, group = "", answers, code } = req.body || {};
  let storedAttempt;
  try {
    storedAttempt = await findAttempt(req.user.email);
    if (!storedAttempt) return res.status(403).json({ error: "No active exam attempt exists for this Google account." });
    if (storedAttempt.values[3] !== "IN_PROGRESS") return res.status(409).json({ error: "This exam attempt has already been submitted." });
    if (Date.now() > new Date(storedAttempt.values[2]).getTime() + 30000) return res.status(403).json({ error: "The exam deadline has passed. The submission grace period has expired." });
  } catch (error) { return res.status(503).json({ error: `Could not verify your attempt: ${error.message}` }); }
  if (typeof name !== "string" || !name.trim() || name.length > 100) return res.status(400).json({ error: "Candidate name is required." });
  if (!Array.isArray(answers) || answers.length !== 30 || !answers.every(x => x === null || (Number.isInteger(x) && x >= 0 && x <= 3))) return res.status(400).json({ error: "Invalid MCQ answer sheet." });
  if (!Array.isArray(code) || code.length !== 4 || !code.every(x => typeof x === "string" && x.length <= 30000)) return res.status(400).json({ error: "Invalid coding answer sheet." });

  const correct = answers.reduce((sum, answer, i) => sum + (answer === ANSWER_KEY[i] ? 1 : 0), 0);
  const mcqScore = correct * 2;
  const codingResults = [];
  for (const problem of PROBLEMS) {
    const source = code[problem.id];
    if (!source.trim()) {
      codingResults.push({ id: problem.id, title: problem.title, marks: problem.marks, score: 0, passed: 0, total: problem.tests.length, status: "Not submitted" });
      continue;
    }
    let passed = 0, compileError = null, runtimeError = false;
    for (const test of problem.tests) {
      try {
        const result = await executeCpp(source, test.input);
        if (result.status?.id === 3 && outputsMatch(result.stdout, test.expected)) passed++;
        else if (result.status?.id === 6) compileError = result.compile_output || result.stderr || "Compilation error";
        else if (result.status?.id > 3) runtimeError = true;
      } catch (error) {
        return res.status(502).json({ error: `Compiler service failed while grading ${problem.title}: ${error.message}` });
      }
    }
    const score = Math.round((passed / problem.tests.length) * problem.marks * 100) / 100;
    codingResults.push({
      id: problem.id, title: problem.title, marks: problem.marks, score,
      passed, total: problem.tests.length,
      status: passed === problem.tests.length ? "All tests passed" : compileError ? "Compilation error" : runtimeError ? "Runtime error" : "Some tests failed",
      compileError: compileError ? String(compileError).slice(0, 3000) : undefined
    });
  }
  const codingScore = Math.round(codingResults.reduce((sum, item) => sum + item.score, 0) * 100) / 100;
  const totalScore = Math.round((mcqScore + codingScore) * 100) / 100;
  const submittedAt = new Date().toISOString();
  const attemptStatus = Date.now() > new Date(storedAttempt.values[2]).getTime() ? "TIMED_OUT" : "SUBMITTED";
  try {
    await updateSheet(`Attempts!D${storedAttempt.rowNumber}:F${storedAttempt.rowNumber}`, [attemptStatus, totalScore, submittedAt]);
  } catch (error) { return res.status(503).json({ error: `Your exam was graded, but the result could not be saved to Google Sheets: ${error.message}` }); }
  res.json({
    candidate: { name: name.trim(), group: String(group).slice(0, 80), email: req.user.email },
    submittedAt,
    mcq: { score: mcqScore, max: 60, correct, total: 30, answerKey: ANSWER_KEY },
    coding: { score: codingScore, max: 40, problems: codingResults },
    total: { score: totalScore, max: 100 }
  });
});

app.get("/api/health", (req, res) => res.json({ ok: true, compilerConfigured: Boolean(JUDGE0_URL), googleLoginConfigured: Boolean(GOOGLE_CLIENT_ID && SESSION_SECRET), sheetsConfigured: Boolean(GOOGLE_SHEET_ID && (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)) }));
app.listen(PORT, () => console.log(`BeSchool C++ Exam Platform running at http://localhost:${PORT}`));
