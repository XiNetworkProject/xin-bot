// XiBot v8 - Pool XIN/POL
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
const POOL_ADDRESS = "0x8459968b0e2DC35B4baf74DB61cE64fFD7368632";
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
  swapCount: 0
};

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

let nextPump = Date.now() + 2 * 60 * 60 * 1000;
let nextDump = Date.now() + 4 * 60 * 60 * 1000;
let lastStats = Date.now();

function announceStartup() {
  const message = `🤖 XiBot v8 lancé\n📈 Pump : ${getFormattedTime(nextPump)}\n📉 Dump : ${getFormattedTime(nextDump)}\n🌀 Aléatoire toutes les 1–3 min\n📡 Tracker swap externe (polling)`;
  log(message);
}

async function approveIfNeeded(token, name) {
  const allowance = await token.allowance(WALLET_ADDRESS, ROUTER);
  if (allowance < parseEther(10000)) {
    log(`🔐 Approbation forcée de ${name}...`);
    const tx = await token.approve(ROUTER, ethers.MaxUint256);
    await tx.wait();
    log(`✅ ${name} approuvé (sans vérification).`);
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
    log("⚠️ Swap aléatoire annulé (fonds insuffisants)");
    return false;
  }
  return true;
}

async function swap(tokenIn, tokenOut, amount, label) {
  if (!(await checkSecurity())) return;
  log(`🔎 Tentative swap ${label} de ${formatEther(amount)} tokens`);
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
  const amount = parseEther(randomBetween(0.5, 6).toFixed(3));
  if (Math.random() < 0.5 && cachedPolBalance > amount + parseEther(10)) {
    await swap(POL, XIN, amount, "POL → XIN (random)");
  } else {
    const xinBal = await xin.balanceOf(WALLET_ADDRESS);
    if (xinBal > amount) {
      await swap(XIN, POL, amount, "XIN → POL (random)");
    }
  }
}

async function sendStats() {
  const msg = `📊 Stats XiBot\nXIN acheté: ${formatEther(stats.xinBought)}\nXIN vendu: ${formatEther(stats.xinSold)}\nPOL utilisé: ${formatEther(stats.polUsed)}\nPOL gagné: ${formatEther(stats.polGained)}\nSwaps: ${stats.swapCount}`;
  sendTelegram(msg);
}

function planNext(hourOffset) {
  return Date.now() + hourOffset * 60 * 60 * 1000;
}

async function loop() {
  await approveIfNeeded(pol, "POL");
  await approveIfNeeded(xin, "XIN");
  announceStartup();

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
  res.end("🤖 XiBot v8 actif avec nouvelle pool XIN/POL !");
}).listen(process.env.PORT || 3000);