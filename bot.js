import dotenv from "dotenv";
import { ethers } from "ethers";
import http from "http";
import https from "https";

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
  https.get(url, (res) => {
    res.on("data", () => {});
  }).on("error", (err) => {
    console.error("❌ Erreur envoi Telegram:", err.message);
  });
}

const startupMessage = `🤖 XiBot v7 actif.
📈 Prochain pump prévu à : 04:06 UTC
📉 Prochain dump prévu à : 06:06 UTC
🌀 Swaps aléatoires en cours toutes les 1 à 3 min entre 0.5 et 6 POL
📡 Toutes les actions sont signalées sur Telegram`;

console.log(startupMessage);
sendTelegram(startupMessage);

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("XiBot v7 actif.");
}).listen(process.env.PORT || 3000);
