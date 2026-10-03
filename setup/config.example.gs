/**
 * config.gs  (EXAMPLE)
 * Copy this file to src/config.gs and fill in your IDs.
 * src/config.gs is git-ignored so your IDs stay off GitHub.
 */

var CONFIG = {
  SHEET_ID: 'PASTE_SHEET_ID_HERE',
  SLIP_FOLDER_ID: 'PASTE_FOLDER_ID_HERE',
  PENDING_FOLDER_NAME: '_pending',   // slips that were read but not saved yet
  TIMEZONE: 'Asia/Bangkok',

  // From Google Cloud > Clients (ends with .apps.googleusercontent.com)
  GOOGLE_CLIENT_ID: 'PASTE_CLIENT_ID_HERE',

  // Leave empty to allow only the owner of this script (you).
  ALLOWED_EMAILS: []
};

var TABLES = {
  transactions: {
    name: 'Transactions',
    headers: ['id', 'date', 'time', 'type', 'amount', 'category', 'payee', 'person', 'note',
      'method', 'account', 'source', 'slip_ref', 'slip_url', 'created_at', 'updated_at']
  },
  categories: {
    name: 'Categories',
    headers: ['name', 'type', 'emoji', 'color', 'budget', 'order', 'archived']
  },
  accounts: {
    name: 'Accounts',
    headers: ['name', 'kind', 'default_method', 'order', 'archived']
  },
  rules: {
    name: 'PayeeRules',
    headers: ['pattern', 'category', 'match', 'updated_at']
  }
};

/**
 * expense / income      normal spending and money in
 * transfer              between your own accounts (not counted)
 * lend / lend_return    you lend a friend money / they pay you back
 * borrow / borrow_return  you borrow from a friend / you pay them back
 */
var TX_TYPES = ['expense', 'income', 'transfer', 'lend', 'lend_return', 'borrow', 'borrow_return'];
var FRIEND_TYPES = ['lend', 'lend_return', 'borrow', 'borrow_return'];
var METHODS = ['PromptPay', 'Transfer', 'Cash', 'Card', 'Wallet'];

var DEFAULT_CATEGORIES = [
  // name, type, emoji, color, budget
  ['Food', 'expense', '🍜', '#E8590C', ''],
  ['Drink', 'expense', '🧋', '#B5651D', ''],
  ['Dessert', 'expense', '🍰', '#D6336C', ''],
  ['Transport', 'expense', '🚇', '#1C7ED6', ''],
  ['Shopping', 'expense', '🛍️', '#7048E8', ''],
  ['Bills', 'expense', '🧾', '#0C8599', ''],
  ['Education', 'expense', '📚', '#2F9E44', ''],
  ['Entertainment', 'expense', '🎬', '#F08C00', ''],
  ['Other', 'expense', '📦', '#868E96', ''],
  ['Allowance', 'income', '💰', '#2B8A3E', ''],
  ['Other', 'income', '💵', '#5C940D', '']
];

var DEFAULT_ACCOUNTS = [
  // name, kind, default_method
  ['Krungsri', 'bank', 'PromptPay'],
  ['Bangkok Bank', 'bank', 'PromptPay'],
  ['Paotang', 'wallet', 'Wallet'],
  ['Cash', 'cash', 'Cash']
];

/** Starter rules. The app adds exact rules by itself each time you save a payee. */
var DEFAULT_RULES = [
  ['LINE MAN', 'Food', 'contains'],
  ['GRABFOOD', 'Food', 'contains'],
  ['FOODPANDA', 'Food', 'contains'],
  ['7-ELEVEN', 'Food', 'contains'],
  ['CAFE', 'Drink', 'contains'],
  ['COFFEE', 'Drink', 'contains'],
  ['GRAB', 'Transport', 'contains'],
  ['BOLT', 'Transport', 'contains'],
  ['MRT', 'Transport', 'contains'],
  ['BTS', 'Transport', 'contains'],
  ['SHOPEE', 'Shopping', 'contains'],
  ['LAZADA', 'Shopping', 'contains'],
  ['TRUE', 'Bills', 'contains'],
  ['AIS', 'Bills', 'contains'],
  ['MAJOR', 'Entertainment', 'contains'],
  ['SF CINEMA', 'Entertainment', 'contains']
];
