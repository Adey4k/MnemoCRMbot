const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

// Отримуємо екземпляр Firestore
const db = admin.firestore();


if (process.env.FIRESTORE_DATABASE) {
  db.settings({databaseId: process.env.FIRESTORE_DATABASE});
}


module.exports = {db, admin};
