const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'data', 'db.json');
let memoryDB = null;

// Ensure db file exists with initial structure
function initDB() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: {},
      payments: {},
      usedSlips: {}
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    memoryDB = initialData;
  }
}

function readDB() {
  initDB();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (raw && raw.trim().length > 0) {
      const data = JSON.parse(raw);
      if (!data.usedSlips) data.usedSlips = {};
      if (!data.users) data.users = {};
      if (!data.payments) data.payments = {};
      memoryDB = data;
      return data;
    }
  } catch (err) {
    // If read or parse failed, return in-memory copy if available
    if (memoryDB) return memoryDB;
    console.error('Error reading DB:', err.message);
  }
  return memoryDB || { users: {}, payments: {}, usedSlips: {} };
}

function writeDB(data) {
  memoryDB = data;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing DB:', err.message);
    return false;
  }
}

function getUser(userId) {
  const db = readDB();
  return db.users[String(userId)] || null;
}

function saveUser(userData) {
  const db = readDB();
  db.users[String(userData.userId)] = {
    ...db.users[String(userData.userId)],
    ...userData,
    updatedAt: new Date().toISOString()
  };
  writeDB(db);
  return db.users[String(userData.userId)];
}

function getAllUsers() {
  const db = readDB();
  return Object.values(db.users);
}

function savePendingPayment(paymentData) {
  const db = readDB();
  db.payments[String(paymentData.id)] = {
    ...paymentData,
    status: 'pending',
    requestedAt: new Date().toISOString()
  };
  // Record slip unique ID
  if (paymentData.fileUniqueId) {
    db.usedSlips[String(paymentData.fileUniqueId)] = {
      userId: paymentData.userId,
      paymentId: paymentData.id,
      usedAt: new Date().toISOString(),
      status: 'pending'
    };
  }
  writeDB(db);
  return db.payments[String(paymentData.id)];
}

function getPayment(id) {
  const db = readDB();
  return db.payments[String(id)] || null;
}

function updatePayment(id, updates) {
  const db = readDB();
  if (db.payments[String(id)]) {
    db.payments[String(id)] = {
      ...db.payments[String(id)],
      ...updates,
      reviewedAt: new Date().toISOString()
    };
    // Also update usedSlips status
    const payment = db.payments[String(id)];
    if (payment.fileUniqueId && db.usedSlips[payment.fileUniqueId]) {
      db.usedSlips[payment.fileUniqueId].status = updates.status || db.usedSlips[payment.fileUniqueId].status;
    }
    writeDB(db);
    return db.payments[String(id)];
  }
  return null;
}

function isSlipUsed(fileUniqueId) {
  if (!fileUniqueId) return false;
  const db = readDB();
  return !!db.usedSlips[String(fileUniqueId)];
}

function hasPendingPayment(userId) {
  const db = readDB();
  const payments = Object.values(db.payments);
  return payments.some(p => String(p.userId) === String(userId) && p.status === 'pending');
}

module.exports = {
  initDB,
  getUser,
  saveUser,
  getAllUsers,
  savePendingPayment,
  getPayment,
  updatePayment,
  isSlipUsed,
  hasPendingPayment
};
