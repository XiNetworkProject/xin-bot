import admin from "firebase-admin";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// 🔥 Import du fichier JSON Firebase
const serviceAccount = require("./xi-bot-a46b5-firebase-adminsdk-fbsvc-ff61e19670.json");

// 🔐 Initialisation Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://xi-bot-a46b5-default-rtdb.europe-west1.firebasedatabase.app"
});

export default admin;
