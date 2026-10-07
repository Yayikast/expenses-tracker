// Run: node tests/parsers.test.js
const fs = require('fs'), path = require('path');
const P = require('../src/parsers.gs');
const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const QR_KSA = '0046000600000101030250225KSA00000000951560434407ac5102TH9104F69B';
const QR_BBL = '004600060000010103002022520260906154344240043029085102TH91043C42';
const KSA = { bank:'Krungsri', date:'2026-09-30', time:'20:19', amount:195, payee:'LINE MAN' };
const BBL = { bank:'Bangkok Bank', date:'2026-09-06', time:'15:43', amount:276, payee:'ShopeePay' };
const PAO = { bank:'Paotang', date:'2026-09-29', time:'17:51', amount:96.2, payee:'2sis Acai & Klongluang', ref:'dc6230a7-9828-4e70-b148-a095d7d6c9e3' };
const PAO2 = { bank:'Paotang', date:'2026-10-07', time:'10:22', amount:14, payee:'ซิมเพิล มีลส์', ref:'7b3e91c0d2a54f6e8a1b9c0d3e4f5a6b' };
const cases = [
  ['krungsri tesseract + QR', fx('krungsri.tesseract.txt'), QR_KSA, {...KSA, ref:'KSA00000000951560434407ac'}],
  ['krungsri tesseract, no QR', fx('krungsri.tesseract.txt'), null, {...KSA, ref:'KSA00000000951560434'}],
  ['krungsri thai', fx('krungsri.thai.txt'), null, {...KSA, ref:'KSA00000000951560434'}],
  ['bangkok tesseract + QR', fx('bangkok.tesseract.txt'), QR_BBL, {...BBL, ref:'2026090615434424004302908'}],
  ['bangkok tesseract, no QR', fx('bangkok.tesseract.txt'), null, {...BBL, ref:'2026090615434424004302908'}],
  ['bangkok drive', fx('bangkok.drive.txt'), null, {...BBL, ref:'2026090615434424004302908'}],
  ['bangkok thai', fx('bangkok.thai.txt'), null, {...BBL, ref:'2026090615434424004302908'}],
  ['paotang drive', fx('paotang.drive.txt'), null, PAO],
  ['paotang inline + thai digits + O/0', fx('paotang.inline.txt'), null, PAO],
  // Paotang: must take the amount PAID (bottom), never the price at the top
  ['paotang labels first, numbers after', fx('paotang.columns.txt'), null, PAO],
  ['paotang ำ split in two + spaces + lost minus', fx('paotang.decomposed.txt'), null, PAO],
  ['paotang unreadable Thai labels (real OCR, no date line)', fx('paotang.garbled.txt'), null, { ...PAO, date: '', time: '' }],
  ['paotang without a discount', fx('paotang.nodiscount.txt'), null, { bank: 'Paotang', date: '2026-10-03', time: '12:05', amount: 50, payee: 'ร้านป้าแดง' }],
  ['paotang 60/40 where only the full price is readable -> blank, not 189', fx('paotang.unclear.txt'), null, { bank: 'Paotang', amount: '', payee: '2sis Acai & Klongluang' }],
  // Newer Paotang slips (Oct 2026): whole-baht amounts, reference without dashes
  ['paotang v2: 35 - 21 = paid 14', fx('paotang.v2.drive.txt'), null, { ...PAO2 }],
  ['paotang v2: numbers and บาท on separate lines', fx('paotang.v2.split.txt'), null, { ...PAO2 }],
  ['paotang v2: real garbled OCR (logo unread, บาท -> uin/wun) -> still 14, not 35', fx('paotang.v2.garbled.txt'), null, { bank: 'Paotang', amount: 14, time: '10:22', ref: PAO2.ref }],
  ['paotang v2: thousands price is not mistaken for a year', fx('paotang.v2.big.txt'), null, { bank: 'Paotang', amount: 2350, date: '2026-10-05', payee: 'ร้าน 2 พี่น้อง', ref: '0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f' }],
];
let fail = 0;
for (const [name, text, qr, exp] of cases) {
  const r = P.parseSlipText(text, P.parseSlipQr(qr));
  const bad = Object.keys(exp).filter(k => r[k] !== exp[k]);
  if (bad.length) { fail++; console.log('FAIL', name, bad.map(k => `${k}: got ${JSON.stringify(r[k])} want ${JSON.stringify(exp[k])}`).join(' | ')); }
  else console.log('ok  ', name, r.note ? '| note: ' + r.note : '', r.categoryHint ? '| hint: ' + r.categoryHint : '');
}
// Paotang note keeps the price and discount
for (const f of ['paotang.drive.txt', 'paotang.columns.txt', 'paotang.decomposed.txt']) {
  const r = P.parseSlipText(fx(f), null);
  if (!/Full price 189\.00/.test(r.note) || !/-92\.80/.test(r.note)) { fail++; console.log('FAIL note', f, r.note); }
}
if (P.parseSlipText(fx('paotang.nodiscount.txt'), null).note) { fail++; console.log('FAIL nodiscount note'); }
for (const f of ['paotang.v2.drive.txt', 'paotang.v2.split.txt', 'paotang.v2.garbled.txt']) {
  const r = P.parseSlipText(fx(f), null);
  if (!/Full price 35\.00/.test(r.note) || !/-21\.00/.test(r.note)) { fail++; console.log('FAIL v2 note', f, r.note); }
}
// Other banks are never mistaken for Paotang
for (const f of ['krungsri.tesseract.txt', 'krungsri.thai.txt', 'bangkok.drive.txt', 'bangkok.tesseract.txt', 'bangkok.thai.txt']) {
  if (P.detectBank(fx(f), null) === 'Paotang') { fail++; console.log('FAIL detected as Paotang', f); }
}
// QR
const q = P.parseSlipQr(QR_KSA);
if (q.bankCode !== '025' || q.bank !== 'Krungsri') { fail++; console.log('FAIL qr', q); } else console.log('ok   qr parse');
if (P.parseSlipQr('https://example.com') !== null) { fail++; console.log('FAIL qr junk'); }
// Category guess
const rules = [{pattern:'LINE MAN',category:'Food',match:'contains'},{pattern:'line man',category:'Transport',match:'exact'}];
const g = [[P.guessCategory('LINE MAN', '', rules),'Transport'],[P.guessCategory('LINE MAN Wongnai','',rules),'Food'],[P.guessCategory('2sis','อาหาร ของหวาน เครื่องดื่ม',[]),'Dessert'],[P.guessCategory('x','',[]),'']];
g.forEach(([got,want],i)=>{ if(got!==want){fail++;console.log('FAIL guess',i,got,want);} });
// Dates
[['1 ม.ค. 70','2027-01-01'],['15 มีนาคม 2569','2026-03-15'],['31/12/2568','2025-12-31'],['3 Oct 2026','2026-10-03'],['30 ก.พ. 2569','']].forEach(([s,w])=>{const d=P.findDate_(s); if(d!==w){fail++;console.log('FAIL date',s,d,w);}});
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
