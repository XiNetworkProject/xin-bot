import dotenv from "dotenv";
import { ethers } from "ethers";
import http from "http";
import https from "https";

dotenv.config();

// === CONFIGURATION ===
const RPC_URL = process.env.POLYGON_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const UNISWAP_POOL = process.env.POOL_ADDRESS;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// === UTILS ===
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomAmount(min = 1, max = 5) {
  const random = Math.random() * (max - min) + min;
  return ethers.parseEther(random.toFixed(2));
}

function randomDelay(min = 60000, max = 180000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
  https.get(url, (res) => {
    res.on("data", () => {});
  }).on("error", (err) => {
    console.error("❌ Erreur envoi Telegram:", err.message);
  });
}

// === ABIs ===
const routerAbi = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)"
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
const polToken = new ethers.Contract(POL, erc20Abi, wallet);
const xinToken = new ethers.Contract(XIN, erc20Abi, wallet);
const pool = new ethers.Contract(POL, erc20Abi, provider);

const MIN_POOL_RESERVE = ethers.parseEther("30");

async function checkApproval(token, name) {
  const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
  if (allowance < ethers.parseEther("1")) {
    console.log(`🔐 Approval nécessaire pour ${name}. Approbation en cours...`);
    const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ ${name} approuvé avec succès !`);
  }
}

async function getWmaticInPool() {
  return await pool.balanceOf(UNISWAP_POOL);
}

async function swap(tokenIn, tokenOut, amountIn, label) {
  console.log(`🔁 Swapping ${ethers.formatEther(amountIn)} ${label}`);
  try {
    const tx = await router.exactInputSingle([
      tokenIn,
      tokenOut,
      3000,
      wallet.address,
      Math.floor(Date.now() / 1000) + 600,
      amountIn,
      0,
      0
    ], { gasLimit: 500000 });
    await tx.wait();
    const msg = `✅ Swap effectué : ${ethers.formatEther(amountIn)} ${label}`;
    console.log(msg);
    sendTelegram(msg);
  } catch (err) {
    const msg = `❌ Erreur lors du swap ${label}: ${err.message}`;
    console.error(msg);
    sendTelegram(msg);
  }
}

async function randomSwap() {
  const polBalance = await polToken.balanceOf(wallet.address);
  const xinBalance = await xinToken.balanceOf(wallet.address);
  const safeLimit = ethers.parseEther("10");
  const poolBalance = await getWmaticInPool();

  const direction = Math.random() < 0.5 ? "buy" : "sell";
  const amount = randomAmount();

  if (direction === "buy") {
    if (polBalance > safeLimit + amount) {
      await swap(POL, XIN, amount, "POL → XIN (aléatoire)");
    } else {
      console.log("⚠️ Trop peu de POL pour achat aléatoire.");
    }
  } else {
    if (xinBalance >= amount && poolBalance > MIN_POOL_RESERVE) {
      await swap(XIN, POL, amount, "XIN → POL (aléatoire)");
    } else {
      console.log("⚠️ Trop peu de XIN ou pool faible pour vente aléatoire.");
    }
  }
}

async function loop() {
  await checkApproval(polToken, "POL (WMATIC)");
  await checkApproval(xinToken, "XIN");

  while (true) {
    try {
      const polBalance = await polToken.balanceOf(wallet.address);
      const xinBalance = await xinToken.balanceOf(wallet.address);
      const safeLimit = ethers.parseEther("10");
      const poolBalance = await getWmaticInPool();

      if (polBalance > (safeLimit + ethers.parseEther("1"))) {
        const cycle = Math.floor(Math.random() * 3) + 1;
        console.log(`[PUMP] Achat x${cycle}`);
        for (let i = 0; i < cycle; i++) {
          const amount = randomAmount();
          const remaining = await polToken.balanceOf(wallet.address);
          if ((remaining - amount) >= safeLimit) {
            await swap(POL, XIN, amount, "POL → XIN");
            await delay(2000);
          } else {
            console.log("⚠️ Seuil de sécurité atteint, stop achat");
            break;
          }
        }
      } else {
        if (xinBalance > ethers.parseEther("1")) {
          console.log("[DUMP] Revente de XIN suite à manque de POL");
          const amount = randomAmount();
          if (poolBalance > MIN_POOL_RESERVE) {
            await swap(XIN, POL, amount, "XIN → POL (auto)");
          } else {
            sendTelegram("⛔ Vente XIN bloquée : pool trop faible.");
          }
        } else {
          console.log("⚠️ Pas assez de XIN pour dump");
        }
      }

      await randomSwap(); // faire un swap bonus en plus
      await delay(randomDelay());
    } catch (err) {
      const msg = `❌ Erreur dans la boucle : ${err.message}`;
      console.error(msg);
      sendTelegram(msg);
      await delay(randomDelay());
    }
  }
}

loop();

// Mode test pour Telegram
if (process.argv.includes("test")) {
  sendTelegram("✅ Test réussi : votre bot XIN est bien connecté à Telegram !");
  process.exit(0);
}

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot XIN v6 actif (pump/dump + aléatoire + Telegram)");
}).listen(process.env.PORT || 3000);
