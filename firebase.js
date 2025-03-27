import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { cert } from "firebase-admin/app";
import serviceAccount from "./xi-bot-a46b5-firebase-adminsdk-fbsvc-ff61e19670.json" assert { type: "json" };

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://xi-bot-a46b5-default-rtdb.firebaseio.com"
});

export const db = getDatabase();