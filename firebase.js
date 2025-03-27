import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(fs.readFileSync("./xi-bot-a46b5-firebase-adminsdk-fbsvc-ff61e19670.json", "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://xi-bot-a46b5-default-rtdb.europe-west1.firebasedatabase.app"
});

export const db = admin.database();