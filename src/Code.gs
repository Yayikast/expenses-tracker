/**
 * Code.gs
 * The web app is an API: your GitHub Pages site sends requests here with fetch().
 *
 * Every request is JSON: { action, args, session }
 * Every reply is JSON:   { ok: true, result } or { ok: false, error, code }
 *
 * Only "login" works without a session. Login needs a Google sign-in token
 * that belongs to the owner of this script (you). See auth.gs.
 */

var ACTIONS = {
  getAppData: function (args) { return getAppData_(); },
  saveTransaction: function (args) { return saveTransaction_(args[0]); },
  deleteTransaction: function (args) { return deleteTransaction_(args[0]); },
  saveSettings: function (args) { return saveSettings_(args[0]); },
  readSlip: function (args) { return readSlip_(args[0]); },
  discardSlip: function (args) { return discardSlip_(args[0]); },
  getSlipImage: function (args) { return getSlipImage_(args[0]); },
  logout: function (args, session) { return logout_(session); },
  logoutAll: function () { return logoutAll_(); }
};

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.', code: 'BAD_REQUEST' });
  }

  try {
    if (req.action === 'login') {
      return json_({ ok: true, result: login_(req.args && req.args[0]) });
    }
    var who = checkSession_(req.session);
    if (!who) return json_({ ok: false, error: 'Please sign in again.', code: 'AUTH' });

    var fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'Unknown action.', code: 'BAD_REQUEST' });
    var result = fn(req.args || [], req.session);
    if (req.action === 'getAppData') result.user = { email: who.email };
    return json_({ ok: true, result: result });
  } catch (err) {
    var msg = String(err && err.message || err);
    var code = /^AUTH:/.test(msg) ? 'AUTH' : 'ERROR';
    return json_({ ok: false, error: msg.replace(/^AUTH:\s*/, ''), code: code });
  }
}

/** Opening the script URL in a browser just shows this. The real app is on GitHub Pages. */
function doGet() {
  return ContentService.createTextOutput('Expenses Tracker API is running. Open the app from your GitHub Pages link.');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
