import admin from "firebase-admin";
import serviceAccount from "./xi-bot-a46b5-firebase-adminsdk-fbsvc-ff61e19670.json" assert { type: "json" };

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

export { db };
