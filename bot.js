// XiBot v8 - Smart Rebalancer, Auto-Liquidity, External Swap Tracker, Stats+ Dashboard Ready
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
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];
const poolAbi = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function liquidity() view returns (uint128)"
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
  swapCount: 0,
  externalSwaps: 0
};

let nextPump = Date.now() + 2 * 60 * 60 * 1000;
let nextDump = Date.now() + 4 * 60 * 60 * 1000;
let lastStats = Date.now();
let lastCheckTime = 0;
let cachedPolBalance = 0n;
let cachedLiquidity = 0;

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
function getFormattedTime(ms) {
  const d = new Date(ms);
  return d.toISOString().split("T")[1].split(".")[0];
}
function planNext(hourOffset) {
  return Date.now() + hourOffset * 60 * 60 * 1000;
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

async function checkSecurity() {
  const now = Date.now();
  if (now - lastCheckTime > 60000) {
    cachedPolBalance = await pol.balanceOf(WALLET_ADDRESS);
    const poolLiquidity = await pool.liquidity();
    cachedLiquidity = Number(poolLiquidity) / 1e18;
    lastCheckTime = now;
  }
  if (cachedPolBalance < parseEther(10)) {
    log("⚠️ Solde insuffisant (POL < 10). Aucun swap autorisé.");
    return false;
  }
  if (cachedLiquidity < 30) {
    log("🚨 Attention : liquidité pool < 30 WMATIC !");
  }
  return true;
}

async function swap(tokenIn, tokenOut, amount, label) {
  if (!(await checkSecurity())) return;
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

async function autoSwap() {
  const amount = parseEther(randomBetween(0.5, 6).toFixed(3));
  if (Math.random() < 0.5 && cachedPolBalance > amount + parseEther(10)) {
    await swap(POL, XIN, amount, "POL → XIN (random)");
  } else {
    const xinBal = await xin.balanceOf(WALLET_ADDRESS);
    if (xinBal > amount) {
      await swap(XIN, POL, amount, "XIN → POL (random)");
    } else {
      log("⚠️ Swap aléatoire annulé (fonds insuffisants)");
    }
  }
}

async function rebalancer() {
  if (cachedPolBalance > parseEther(50)) {
    log("♻️ Rebalancing : POL disponible élevé, à réinjecter dans la pool si besoin");
    // Ajout de liquidité futur
  }
}

async function sendStats() {
  const msg = `📊 Stats XiBot v8\nXIN acheté: ${formatEther(stats.xinBought)}\nXIN vendu: ${formatEther(stats.xinSold)}\nPOL utilisé: ${formatEther(stats.polUsed)}\nPOL gagné: ${formatEther(stats.polGained)}\nSwaps: ${stats.swapCount}\nSwaps externes détectés: ${stats.externalSwaps}`;
  sendTelegram(msg);
}

function announceStartup() {
  const msg = `🤖 XiBot v8 lancé\n📈 Pump : ${getFormattedTime(nextPump)}\n📉 Dump : ${getFormattedTime(nextDump)}\n🌀 Aléatoire toutes les 1–3 min\n📡 Tracker swap externe actif`;
  log(msg);
}

async function loop() {
  await approveIfNeeded(pol, "POL");
  await approveIfNeeded(xin, "XIN");
  announceStartup();

  pool.on("Swap", (sender, recipient, a0, a1) => {
    if (sender.toLowerCase() !== WALLET_ADDRESS.toLowerCase()) {
      stats.externalSwaps++;
      const direction = a0 > 0 ? "Vente XIN" : "Achat XIN";
      const montant = formatEther(a0 > 0 ? a0 : a1);
      log(`📡 ${direction} externe\n👤 ${sender.slice(0, 8)}...\n💰 ${montant} POL`);
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
    await autoSwap();
    await rebalancer();
    await delay(randomBetween(60000, 180000));
  }
}
loop();

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("🤖 XiBot v8 actif ! Liquidity AI, swap tracker, rebalancing et plus encore.");
}).listen(process.env.PORT || 3000);
