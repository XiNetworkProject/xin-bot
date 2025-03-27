// firebase.js
import admin from "firebase-admin";
import fs from "fs";

// Lis la clé de service
const serviceAccount = JSON.parse(
  fs.readFileSync("./xi-bot-a46b5-firebase-adminsdk-fbsvc-ff61e19670.json", "utf8")
);

// Initialise Firebase Admin avec Realtime Database
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://xi-bot-a46b5-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database(); // 👈 Utilise la Realtime DB

export { db };
