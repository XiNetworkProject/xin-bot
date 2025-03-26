
// XiBot v7 - IA de marché complète
import dotenv from "dotenv";
import { ethers } from "ethers";
import https from "https";
import http from "http";
dotenv.config();

const RPC_URL = process.env.POLYGON_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WALLET_ADDRESS = new ethers.Wallet(PRIVATE_KEY).address;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const routerAbi = [
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) external payable returns (uint256)"
];
const erc20Abi = [
  "function approve(address,uint256) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)"
];
const poolAbi = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
];

const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const pol = new ethers.Contract(POL, erc20Abi, wallet);
const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const pool = new ethers.Contract(POOL_ADDRESS, poolAbi, provider);

let stats = {
  xinBought: 0n,
  xinSold: 0n,
  polUsed: 0n,
  polGained: 0n,
  swapCount: 0
};

function log(msg) {
  console.log(msg);
  sendTelegram(msg);
}
function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
  https.get(url, () => {});
}
function parseEther(x) {
  return ethers.parseEther(x.toString());
}
function formatEther(x) {
  return ethers.formatEther(x);
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function approveIfNeeded(token, name) {
  const allowance = await token.allowance(WALLET_ADDRESS, ROUTER);
  if (allowance < parseEther(10000)) {
    log(`🔐 Approbation ${name}...`);
    const tx = await token.approve(ROUTER, ethers.MaxUint256);
    await tx.wait();
    log(`✅ ${name} approuvé.`);
  }
}

async function swap(tokenIn, tokenOut, amount, label) {
  log(`🔁 Tentative swap ${label} (${formatEther(amount)} tokens)`);
  try {
    const tx = await router.exactInputSingle([
      tokenIn,
      tokenOut,
      3000,
      WALLET_ADDRESS,
      Math.floor(Date.now() / 1000) + 600,
      amount,
      0,
      0
    ], { gasLimit: 500000 });
    await tx.wait();
    stats.swapCount++;
    if (label.includes("POL → XIN")) {
      stats.polUsed += amount;
      stats.xinBought += amount;
    } else {
      stats.xinSold += amount;
      stats.polGained += amount;
    }
    log(`✅ Swap réussi : ${label}`);
  } catch (err) {
    log(`❌ Échec swap ${label} : ${err.message}`);
  }
}

async function randomSwap() {
  const polBal = await pol.balanceOf(WALLET_ADDRESS);
  const xinBal = await xin.balanceOf(WALLET_ADDRESS);
  const amount = parseEther(randomBetween(0.5, 6).toFixed(3));
  if (Math.random() < 0.5 && polBal > amount + parseEther(10)) {
    await swap(POL, XIN, amount, "POL → XIN (random)");
  } else if (xinBal > amount) {
    await swap(XIN, POL, amount, "XIN → POL (random)");
  } else {
    log("⚠️ Swap aléatoire annulé (fonds insuffisants)");
  }
}

async function sendStats() {
  const msg = `📊 Stats XiBot v7
XIN acheté: ${formatEther(stats.xinBought)}
XIN vendu: ${formatEther(stats.xinSold)}
POL utilisé: ${formatEther(stats.polUsed)}
POL gagné: ${formatEther(stats.polGained)}
Swaps effectués: ${stats.swapCount}`;
  sendTelegram(msg);
}

function planNext(hourOffset) {
  const now = Date.now();
  return now + hourOffset * 60 * 60 * 1000;
}

let nextPump = planNext(2);
let nextDump = planNext(4);
let lastStats = Date.now();

async function loop() {
  await approveIfNeeded(pol, "POL");
  await approveIfNeeded(xin, "XIN");

  log("🤖 XiBot v7 en ligne. Démarrage IA...");

  pool.on("Swap", (sender, recipient, a0, a1) => {
    if (sender !== WALLET_ADDRESS) {
      const direction = a0 > 0 ? "Vente XIN" : "Achat XIN";
      log(`📡 ${direction} externe détecté : ${formatEther(a0 > 0 ? a0 : a1)} POL`);
    }
  });

  while (true) {
    const now = Date.now();
    if (now >= nextPump) {
      await swap(POL, XIN, parseEther(randomBetween(3, 6).toFixed(2)), "POL → XIN (PUMP)");
      nextPump = planNext(2);
    }
    if (now >= nextDump) {
      await swap(XIN, POL, parseEther(randomBetween(2, 4).toFixed(2)), "XIN → POL (DUMP)");
      nextDump = planNext(4);
    }
    if (now - lastStats >= 60 * 60 * 1000) {
      await sendStats();
      lastStats = now;
    }
    await randomSwap();
    await delay(randomBetween(60000, 180000));
  }
}
loop();

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("🤖 XiBot v7 actif. Tout fonctionne !");
}).listen(process.env.PORT || 3000);