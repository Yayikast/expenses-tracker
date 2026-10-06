/**
 * parsers.gs
 * Reads the text of a Thai payment slip and pulls out the useful fields.
 * Pure functions only (no Google services), so they can be tested on a PC with Node.
 *
 * Main entry points:
 *   parseSlipQr(qrText)            -> { bankCode, bank, ref } or null
 *   parseSlipText(ocrText, qrInfo) -> draft transaction fields
 *   guessCategory(payee, hint, rules)
 *
 * To support a new bank: add its QR code number to BANK_CODES, a detector to
 * detectBank(), and a parser function to SLIP_PARSERS.
 */

/** Thai bank codes used in the slip QR code (Bank of Thailand codes). */
var BANK_CODES = {
  '002': 'Bangkok Bank',
  '004': 'Kasikorn',
  '006': 'Krungthai',
  '011': 'ttb',
  '014': 'SCB',
  '025': 'Krungsri',
  '030': 'GSB',
  '034': 'BAAC',
  '069': 'Kiatnakin',
  '073': 'LH Bank'
};

var EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

var TH_MONTHS_SHORT = {
  'มค': 1, 'กพ': 2, 'มีค': 3, 'เมย': 4, 'พค': 5, 'มิย': 6,
  'กค': 7, 'สค': 8, 'กย': 9, 'ตค': 10, 'พย': 11, 'ธค': 12
};

var TH_MONTHS_LONG = {
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
};

/* ------------------------------------------------------------------ */
/* QR code                                                             */
/* ------------------------------------------------------------------ */

/**
 * Thai slip QR codes use TLV format (Tag, Length, Value), e.g.
 * "0046 0006000001 0103025 0225KSA... 5102TH 9104F69B"
 * Tag 00 holds: 00 = API id, 01 = sending bank code, 02 = transaction ref.
 */
function parseTlv_(text) {
  var out = {};
  var i = 0;
  while (i + 4 <= text.length) {
    var tag = text.substr(i, 2);
    var len = parseInt(text.substr(i + 2, 2), 10);
    if (isNaN(len)) return null;
    out[tag] = text.substr(i + 4, len);
    i += 4 + len;
  }
  return i === text.length ? out : null;
}

function parseSlipQr(qrText) {
  if (!qrText) return null;
  var top = parseTlv_(String(qrText).trim());
  if (!top || !top['00']) return null;
  var inner = parseTlv_(top['00']);
  if (!inner || !inner['02']) return null;
  var code = inner['01'] || '';
  return {
    bankCode: code,
    bank: BANK_CODES[code] || '',
    ref: inner['02']
  };
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function normalizeText_(text) {
  return String(text || '')
    // Thai digits -> Arabic digits
    .replace(/[๐-๙]/g, function (d) { return String(d.charCodeAt(0) - 0x0E50); })
    // OCR often writes ำ as two characters (ํ + า) and แ as two เ: join them back
    .replace(/\u0E4D\u0E32/g, '\u0E33')
    .replace(/\u0E40\u0E40/g, '\u0E41')
    // invisible zero-width characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ');
}

function toLines_(text) {
  return normalizeText_(text).split('\n')
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l.length > 0; });
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Converts a 2 or 4 digit year (Thai Buddhist or normal) to a normal 4 digit year. */
function normalizeYear_(y) {
  y = parseInt(y, 10);
  if (y >= 2400) return y - 543;          // 2569 -> 2026
  if (y >= 1900) return y;                // 2026
  if (y >= 50) return 2500 + y - 543;     // 69 -> 2569 -> 2026 (Thai short year)
  return 2000 + y;                        // 26 -> 2026
}

function isValidDate_(y, m, d) {
  if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  var dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1;
}

/** Finds the first date in the text. Returns 'YYYY-MM-DD' or ''. */
function findDate_(text) {
  var t = normalizeText_(text);
  var m;

  // 30 Sep 2026 / 06 Sep 26
  var en = /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4}|\d{2})(?!\d)/i;
  m = t.match(en);
  if (m) {
    var y1 = normalizeYear_(m[3]), mo1 = EN_MONTHS[m[2].toLowerCase()], d1 = +m[1];
    if (isValidDate_(y1, mo1, d1)) return y1 + '-' + pad2_(mo1) + '-' + pad2_(d1);
  }

  // 29 ก.ย. 2569 / 29 ก.ย. 69
  var thShort = /(\d{1,2})\s*((?:ม|ก|มี|เม|พ|มิ|ส|ต|ธ)\s*\.?\s*(?:ค|พ|ย)\s*\.?)\s*(\d{4}|\d{2})(?!\d)/;
  m = t.match(thShort);
  if (m) {
    var key = m[2].replace(/[\s.]/g, '');
    var mo2 = TH_MONTHS_SHORT[key];
    var y2 = normalizeYear_(m[3]), d2 = +m[1];
    if (mo2 && isValidDate_(y2, mo2, d2)) return y2 + '-' + pad2_(mo2) + '-' + pad2_(d2);
  }

  // 29 กันยายน 2569
  for (var name in TH_MONTHS_LONG) {
    var re = new RegExp('(\\d{1,2})\\s*' + name + '\\s*(\\d{4}|\\d{2})(?!\\d)');
    m = t.match(re);
    if (m) {
      var y3 = normalizeYear_(m[2]), mo3 = TH_MONTHS_LONG[name], d3 = +m[1];
      if (isValidDate_(y3, mo3, d3)) return y3 + '-' + pad2_(mo3) + '-' + pad2_(d3);
    }
  }

  // 29/09/2569 or 29-09-26
  m = t.match(/(?:^|[^\d])(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})(?!\d)/);
  if (m) {
    var y4 = normalizeYear_(m[3]), mo4 = +m[2], d4 = +m[1];
    if (isValidDate_(y4, mo4, d4)) return y4 + '-' + pad2_(mo4) + '-' + pad2_(d4);
  }
  return '';
}

/** Finds the first HH:MM time (colon only, so amounts like 15.43 are not mistaken). */
function findTime_(text) {
  var re = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?!\d)/g;
  var m = re.exec(normalizeText_(text));
  return m ? pad2_(+m[1]) + ':' + m[2] : '';
}

var NUMBER_RE_ = /-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?/g;
var FEE_RE_ = /fee|ค่าธรรมเนียม|ค่าบริการ\s*$|ส่วนลด|สิทธิ|discount|balance|คงเหลือ/i;
var CURRENCY_RE_ = /(THB|บาท|฿|unin|unn|tHe|TH8|8aht)/i;

function toNumber_(s) {
  var n = parseFloat(String(s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/** Numbers in a line, ignoring long digit runs (account numbers, refs) and times. */
function numbersIn_(line) {
  var clean = line
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')   // times
    .replace(/[A-Za-z]*\d{9,}[A-Za-z0-9]*/g, ' '); // refs / long ids
  var out = [];
  var m;
  NUMBER_RE_.lastIndex = 0;
  while ((m = NUMBER_RE_.exec(clean)) !== null) {
    var n = toNumber_(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

/** A line that is basically just an amount, e.g. "195.00 THB" or "96.20 บาท". */
function isAmountLine_(line) {
  return /^-?[\d,]+(\.\d{1,2})?\s*(THB|บาท|฿|[A-Za-z]{2,4})?\.?$/.test(line.trim());
}

/** A label like "จำนวนเงินที่ชำระ" still matches if OCR put spaces inside it. */
function labelRegex_(label) {
  var chars = String(label).replace(/\s/g, '').split('').map(function (c) { return c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); });
  return new RegExp(chars.join('\\s*'), 'i');
}

/**
 * Looks for a label (e.g. "Amount") and returns its number.
 *
 * Handles the ways OCR lays out a two-column slip:
 *   same line       "จำนวนเงินที่ชำระ 96.20 บาท"
 *   value below     "Amount" / "276.00 THB"
 *   all labels first, then all values (common for Google Drive OCR):
 *       ค่าสินค้า/บริการ        <- label 1
 *       สิทธิไทยช่วยไทยพลัส      <- label 2
 *       จำนวนเงินที่ชำระ        <- label 3  (the one we want)
 *       189 บาท                <- value 1
 *       -92.80 บาท             <- value 2
 *       96.20 บาท              <- value 3  (so we must take THIS one, not the first)
 *     The label's position among its neighbouring labels picks the matching value.
 *
 * opts.allowFee: the label itself is a fee/discount label (normally skipped)
 * opts.signed:   return the size of a negative amount too (for discounts)
 */
function amountAfterLabel_(lines, labels, opts) {
  opts = opts || {};
  var wanted = function (n) { return opts.signed ? n !== 0 : n > 0; };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    for (var k = 0; k < labels.length; k++) {
      var m = line.match(labelRegex_(labels[k]));
      if (!m) continue;
      var before = line.substr(0, m.index + m[0].length);
      if (!opts.allowFee && FEE_RE_.test(before) && !/จำนวนเงิน|amount/i.test(labels[k])) continue;

      // 1. Number on the same line
      var nums = numbersIn_(line.substr(m.index + m[0].length)).filter(wanted);
      if (nums.length) return Math.abs(nums[0]);

      // 2. Number(s) below. Count labels right before/after ours and the values that follow.
      var after = 0, j = i + 1;
      while (j < lines.length && !isAmountLine_(lines[j]) && after < 6) { after++; j++; }
      var values = [];
      while (j < lines.length && isAmountLine_(lines[j])) { values.push(numbersIn_(lines[j])[0]); j++; }
      if (!values.length) continue;
      var labelsBefore = 0;
      for (var b = i - 1; b >= 0 && !isAmountLine_(lines[b]); b--) labelsBefore++;
      var total = labelsBefore + after + 1;
      var pick;
      if (values.length === total) pick = labelsBefore;                 // one value per label
      else if (values.length < total) pick = values.length - 1 - after;  // extra text lines above the labels
      else pick = labelsBefore;                                          // extra values below
      if (after === 0 && labelsBefore === 0) pick = 0;
      if (pick < 0 || pick >= values.length) pick = 0;
      var v = values[pick];
      if (v !== undefined && v !== null && wanted(v)) return Math.abs(v);
      for (var q = 0; q < values.length; q++) if (wanted(values[q])) return Math.abs(values[q]);
    }
  }
  return null;
}

/** Fallback for slips where the total is printed last: the bottom-most amount with a currency word. */
function lastCurrencyAmount_(lines) {
  var last = null;
  lines.forEach(function (line) {
    if (FEE_RE_.test(line) || !CURRENCY_RE_.test(line)) return;
    numbersIn_(line).forEach(function (n) { if (n > 0) last = n; });
  });
  return last;
}

/** Fallback: largest number that has a currency word next to it, skipping fee lines. */
function largestCurrencyAmount_(lines) {
  var best = null;
  lines.forEach(function (line) {
    if (FEE_RE_.test(line) || !CURRENCY_RE_.test(line)) return;
    numbersIn_(line).forEach(function (n) {
      if (n > 0 && (best === null || n > best)) best = n;
    });
  });
  return best;
}

/** Masked or plain account numbers: XXX-1-37405-X, 091-0-xxx453, 013-555-4-XXXX203-0 */
function isAccountLine_(line) {
  var s = line.replace(/\s/g, '');
  return /^[\dXx*]{3}-[\dXx*]{1,3}-[\dXx*]{3,6}(-[\dXx*]{1,6})?(-[\dXx*])?$/.test(s) ||
    /^(G-?Wallet|Wallet)\s*ID/i.test(line) ||
    /^[Xx*]{3,}[\dXx*-]*\d+$/.test(s);
}

var BANK_NAME_LINE_RE_ = /^(bangkok bank|krungsri|kasikorn ?bank|kbank|scb|krungthai|ttb|gsb|ธนาคาร.*|กรุงศรี|กสิกรไทย|ไทยพาณิชย์|กรุงไทย|กรุงเทพ)$/i;
var NOISE_LINE_RE_ = /^(service code|biller|customer ref|merchant ref|ref\b|reference|memo|note|บันทึก|เลขที่|รหัส)/i;

function cleanPayee_(s) {
  return String(s || '')
    .replace(/\(\s*QR\s*by[^)]*\)/i, '')
    .replace(/^(to|ไปยัง|ถึง|ผู้รับ|รับเงิน)\s*[:\-]?\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Payee after a "To" / "ไปยัง" label (same line or next line). */
function payeeAfterLabel_(lines) {
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^(to|ไปยัง|ถึง|ผู้รับ(?:เงิน)?|รับเงิน)\s*[:\-]?\s*(.*)$/i);
    if (!m) continue;
    if (m[2] && m[2].length > 1 && !isAccountLine_(m[2])) return cleanPayee_(m[2]);
    for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) {
      if (!isAccountLine_(lines[j]) && !NOISE_LINE_RE_.test(lines[j]) && lines[j].length > 1) return cleanPayee_(lines[j]);
    }
  }
  return '';
}

/** First non-noise line after the sender's account line (skips a bank name line). */
function payeeAfterSenderAccount_(lines) {
  var accIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (isAccountLine_(lines[i])) { accIdx = i; break; }
  }
  if (accIdx === -1) return '';
  for (var j = accIdx + 1; j < Math.min(lines.length, accIdx + 5); j++) {
    var l = lines[j];
    if (BANK_NAME_LINE_RE_.test(l) || isAccountLine_(l) || NOISE_LINE_RE_.test(l)) continue;
    if (/^(to|from|ไปยัง|จาก)$/i.test(l)) continue;
    if (/^[^A-Za-z0-9ก-๙]*$/.test(l) || l.length < 2) continue; // icons / junk
    return cleanPayee_(l);
  }
  return '';
}

/** Text after a label like "Ref No." either on the same line or the next one. */
function valueAfterLabel_(lines, labelRe, valueRe) {
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(labelRe);
    if (!m) continue;
    var rest = lines[i].substr(m.index + m[0].length).replace(/\s/g, '');
    var v = rest.match(valueRe);
    if (v) return v[0];
    if (i + 1 < lines.length) {
      var v2 = lines[i + 1].replace(/\s/g, '').match(valueRe);
      if (v2) return v2[0];
    }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Bank detection and bank-specific parsers                            */
/* ------------------------------------------------------------------ */

function detectBank(text, qrInfo) {
  if (qrInfo && qrInfo.bank) return qrInfo.bank;
  var t = normalizeText_(text).toLowerCase();
  if (/เป๋าตัง|paotang|g-?wallet/.test(t)) return 'Paotang';
  if (/krungsri|กรุงศรี|\bksa\d/.test(t)) return 'Krungsri';
  if (/bangkok bank|ธนาคารกรุงเทพ|bualuang|บัวหลวง/.test(t)) return 'Bangkok Bank';
  return '';
}

var SLIP_PARSERS = {
  'Krungsri': function (lines, text) {
    return {
      amount: amountAfterLabel_(lines, ['Amount', 'จำนวนเงิน']),
      payee: payeeAfterLabel_(lines) || payeeAfterSenderAccount_(lines),
      ref: valueAfterLabel_(lines, /^(Ref\.?\s*No\.?|เลขที่รายการ|เลขที่อ้างอิง)\s*:?\s*(?=[^\d\s]|$)/i, /^[A-Z]{2,4}\d{10,}[A-Za-z0-9]*/)
    };
  },
  'Bangkok Bank': function (lines, text) {
    return {
      amount: amountAfterLabel_(lines, ['Amount', 'จำนวนเงิน']),
      payee: payeeAfterLabel_(lines) || payeeAfterSenderAccount_(lines),
      ref: valueAfterLabel_(lines, /(Transaction reference|เลขที่อ้างอิงรายการ|หมายเลขอ้างอิงรายการ)/i, /\d{15,}/)
    };
  },
  'Paotang': function (lines, text) {
    // Paotang shows: price (ค่าสินค้า/บริการ) at the top, any discount/co-pay (สิทธิ... -xx) and
    // the amount actually paid (จำนวนเงินที่ชำระ) at the bottom. We always want the amount paid.
    var paid = amountAfterLabel_(lines, ['จำนวนเงินที่ชำระ', 'ยอดเงินที่ชำระ', 'ยอดชำระ', 'ชำระทั้งสิ้น']);
    var full = amountAfterLabel_(lines, ['ค่าสินค้า/บริการ', 'ค่าสินค้า', 'ราคา']);
    var discount = amountAfterLabel_(lines, ['สิทธิ', 'ส่วนลด', 'คูปอง'], { allowFee: true, signed: true });
    if (!discount) {
      // Label unreadable? A negative amount on the slip is the discount.
      lines.forEach(function (l) { if (!discount && CURRENCY_RE_.test(l)) numbersIn_(l).forEach(function (n) { if (n < 0) discount = -n; }); });
    }
    if (paid === null) paid = lastCurrencyAmount_(lines);   // the paid amount is printed last
    if (full === null && discount) {
      // price is the first amount on the slip
      for (var f = 0; f < lines.length && full === null; f++) {
        if (CURRENCY_RE_.test(lines[f])) { var fn = numbersIn_(lines[f]).filter(function (n) { return n > 0; }); if (fn.length) full = fn[0]; }
      }
    }
    // Check with the slip's own sum: price - discount = paid
    if (full && discount && full > discount) {
      var expected = Math.round((full - discount) * 100) / 100;
      if (paid === null || Math.abs(paid - full) < 0.005) paid = expected;
    }
    // Government co-pay slips (ไทยช่วยไทย 60/40, คนละครึ่ง...): you never pay the full price.
    // If only the full price could be read, leave the amount empty so you type it in,
    // rather than guessing (the government share is not always exactly 60%).
    var coPay = /สิทธิ|ไทยช่วยไทย|คนละครึ่ง|60\s*\/\s*40|40\s*\/\s*60/.test(text);
    if (coPay && !discount && full && paid !== null && Math.abs(paid - full) < 0.005) paid = '';
    var out = {
      amount: paid,
      payee: '',
      ref: '',
      categoryHint: '',
      note: ''
    };
    // Payee is the first real line after the G-Wallet line
    for (var i = 0; i < lines.length; i++) {
      if (/G-?Wallet/i.test(lines[i])) {
        for (var j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          if (/^[^A-Za-z0-9ก-๙]*$/.test(lines[j])) continue;
          out.payee = cleanPayee_(lines[j]);
          // Paotang shows a shop type line below the name, e.g. "อาหาร ของหวาน เครื่องดื่ม"
          if (j + 1 < lines.length && /อาหาร|ของหวาน|เครื่องดื่ม|เดินทาง|สินค้า|บริการ|ร้าน/.test(lines[j + 1]) &&
              !/ค่าสินค้า|จำนวนเงิน/.test(lines[j + 1])) {
            out.categoryHint = lines[j + 1];
          }
          break;
        }
        break;
      }
    }
    // Reference is a UUID; OCR sometimes reads 0 as O
    var uuid = normalizeText_(text)
      .match(/[0-9a-fo]{8}-[0-9a-fo]{4}-[0-9a-fo]{4}-[0-9a-fo]{4}-[0-9a-fo]{12}/i);
    if (uuid) out.ref = uuid[0].toLowerCase().replace(/o/g, '0');

    // Co-payment schemes (e.g. ไทยช่วยไทยพลัส): keep full price and subsidy in the note
    var subsidyLine = lines.filter(function (l) { return /สิทธิ|ส่วนลด|คูปอง/.test(l); })[0];
    if (full && out.amount && full > out.amount) {
      var subsidy = Math.round((full - out.amount) * 100) / 100;
      var scheme = subsidyLine ? subsidyLine.replace(/-?[\d,.]+\s*(บาท)?\s*$/, '').trim() : 'discount';
      out.note = 'Full price ' + full.toFixed(2) + ', ' + scheme + ' -' + subsidy.toFixed(2);
    }
    return out;
  }
};

function genericParser_(lines, text) {
  return {
    amount: amountAfterLabel_(lines, ['จำนวนเงินที่ชำระ', 'Amount', 'จำนวนเงิน', 'ยอดชำระ', 'Total']),
    payee: payeeAfterLabel_(lines) || payeeAfterSenderAccount_(lines),
    ref: valueAfterLabel_(lines, /(Transaction reference|Ref\.?\s*No\.?|เลขที่รายการ|เลขที่อ้างอิง|รหัสอ้างอิง)/i, /[A-Za-z0-9-]{10,}/)
  };
}

/**
 * Turns slip text into draft transaction fields.
 * Every field may be empty; the user fixes anything missing on the review card.
 */
function parseSlipText(ocrText, qrInfo) {
  var text = normalizeText_(ocrText);
  var lines = toLines_(text);
  var bank = detectBank(text, qrInfo);
  var parser = SLIP_PARSERS[bank] || genericParser_;
  var r = parser(lines, text) || {};

  var amount = r.amount;
  // '' means the bank parser decided it can't tell: leave it for you to fill in
  if (amount === null || amount === undefined) amount = largestCurrencyAmount_(lines);

  var ref = (qrInfo && qrInfo.ref) ? qrInfo.ref : String(r.ref || '').replace(/\s/g, '');

  return {
    bank: bank,
    date: findDate_(text),
    time: findTime_(text),
    amount: amount === null || amount === undefined || amount === '' ? '' : Math.round(amount * 100) / 100,
    payee: r.payee || '',
    ref: ref,
    refSource: (qrInfo && qrInfo.ref) ? 'qr' : (ref ? 'text' : ''),
    categoryHint: r.categoryHint || '',
    note: r.note || ''
  };
}

/* ------------------------------------------------------------------ */
/* Category guess                                                      */
/* ------------------------------------------------------------------ */

function normalizePayee(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * rules: [{ pattern, category, match: 'exact' | 'contains' }]
 * Exact rules (learned from your past saves) win over contains rules.
 */
function guessCategory(payee, hint, rules) {
  var p = normalizePayee(payee);
  rules = rules || [];
  if (p) {
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].match === 'exact' && normalizePayee(rules[i].pattern) === p) return rules[i].category;
    }
    for (var j = 0; j < rules.length; j++) {
      var pat = normalizePayee(rules[j].pattern);
      if (rules[j].match !== 'exact' && pat && p.indexOf(pat) !== -1) return rules[j].category;
    }
  }
  var h = String(hint || '');
  if (/ของหวาน|ขนม|เบเกอรี่|dessert|bakery|cake/i.test(h)) return 'Dessert';
  if (/เครื่องดื่ม|กาแฟ|ชา|coffee|cafe|drink/i.test(h) && !/อาหาร/.test(h)) return 'Drink';
  if (/อาหาร|food|restaurant/i.test(h)) return 'Food';
  if (/เดินทาง|transport/i.test(h)) return 'Transport';
  return '';
}

/** Lets Node tests load this file. Ignored by Apps Script. */
if (typeof module !== 'undefined') {
  module.exports = { parseSlipQr: parseSlipQr, parseSlipText: parseSlipText, guessCategory: guessCategory, detectBank: detectBank, findDate_: findDate_, findTime_: findTime_ };
}
