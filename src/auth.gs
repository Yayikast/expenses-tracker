/**
 * auth.gs
 * Sign in with Google, but only YOU are let in.
 *
 * 1. The app sends Google to show its account chooser. Google sends back an "ID token"
 *    (a signed note saying "this person is yayika...@gmail.com").
 * 2. login_() asks Google to confirm the token is real, made for OUR app (client ID),
 *    not expired, and that the email is the owner of this script.
 * 3. If all good, we hand out a random session key that the phone keeps for 30 days,
 *    so you don't have to sign in every time.
 *
 * Sessions are stored (hashed) in Script Properties. "Sign out all devices" clears them.
 */

var SESSION_DAYS = 30;

/** payload: { idToken, nonce } */
function login_(payload) {
  if (!payload || !payload.idToken) throw new Error('AUTH: Sign-in failed. Please try again.');
  if (!CONFIG.GOOGLE_CLIENT_ID || /PASTE/.test(CONFIG.GOOGLE_CLIENT_ID)) {
    throw new Error('Set GOOGLE_CLIENT_ID in config.gs first.');
  }

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(payload.idToken), {
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: Google could not confirm your sign-in. Please try again.');
  var info = JSON.parse(res.getContentText());

  var issuerOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  var notExpired = Number(info.exp) * 1000 > Date.now();
  var verified = info.email_verified === true || info.email_verified === 'true';
  var nonceOk = !payload.nonce || info.nonce === payload.nonce;

  if (info.aud !== CONFIG.GOOGLE_CLIENT_ID || !issuerOk || !notExpired || !nonceOk) {
    throw new Error('AUTH: Sign-in failed. Please try again.');
  }
  if (!verified || !isAllowedEmail_(info.email)) {
    throw new Error('AUTH: ' + info.email + ' does not have access. Sign in with the account that owns this app.');
  }

  cleanExpiredSessions_();
  var session = Utilities.getUuid() + Utilities.getUuid();
  var expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  PropertiesService.getScriptProperties().setProperty(sessionKey_(session),
    JSON.stringify({ email: info.email, expires: expires, created: Date.now() }));

  return { session: session, email: info.email, expires: expires };
}

/** Returns { email } for a valid session, or null. */
function checkSession_(session) {
  if (!session || String(session).length < 40) return null;
  var raw = PropertiesService.getScriptProperties().getProperty(sessionKey_(session));
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (s.expires < Date.now() || !isAllowedEmail_(s.email)) {
    PropertiesService.getScriptProperties().deleteProperty(sessionKey_(session));
    return null;
  }
  return { email: s.email };
}

function logout_(session) {
  PropertiesService.getScriptProperties().deleteProperty(sessionKey_(session));
  return true;
}

/** Signs out every phone and computer. */
function logoutAll_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0) props.deleteProperty(k); });
  return true;
}

/** You can also run this from the Apps Script editor if you ever lose a phone. */
function signOutEverywhere() {
  logoutAll_();
  Logger.log('All devices signed out.');
}

function isAllowedEmail_(email) {
  email = String(email || '').toLowerCase();
  if (!email) return false;
  // The owner of the script (you), unless you list emails in config.gs
  var allowed = (CONFIG.ALLOWED_EMAILS || []).map(function (e) { return String(e).toLowerCase(); });
  if (!allowed.length) allowed = [String(Session.getEffectiveUser().getEmail() || '').toLowerCase()];
  return allowed.indexOf(email) >= 0;
}

function sessionKey_(session) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(session));
  return 'sess_' + bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function cleanExpiredSessions_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).expires < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}
