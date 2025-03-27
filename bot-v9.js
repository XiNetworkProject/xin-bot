// XiBot v9 - Profit Engine Mode 💸
import dotenv from "dotenv";
import { ethers } from "ethers";
import http from "http";
import https from "https";

dotenv.config();

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
let stats = { xinBought: 0n, xinSold: 0n, polUsed: 0n, polGained: 0n };
let lastStats = Date.now();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function randomAmount(min = 1, max = 5) {
  return ethers.parseEther((Math.random() * (max - min) + min).toFixed(2));
}
function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(message)}`;
  https.get(url, () => {});
}
function format(x) {
  return Number(ethers.formatEther(x)).toFixed(2);
}

async function checkApproval(token, name) {
  const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
  if (allowance < ethers.parseEther("1")) {
    console.log(`🔐 Approbation ${name}...`);
    const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ ${name} approuvé.`);
  }
}

async function getWmaticInPool() {
  return await pool.balanceOf(UNISWAP_POOL);
}

async function swap(tokenIn, tokenOut, amountIn, label) {
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

    if (label.includes("POL → XIN")) {
      stats.polUsed += amountIn;
      stats.xinBought += amountIn;
    } else {
      stats.xinSold += amountIn;
      stats.polGained += amountIn;
    }

    const msg = `✅ Swap : ${format(amountIn)} ${label}`;
    console.log(msg);
    sendTelegram(msg);
  } catch (err) {
    const msg = `❌ Swap raté ${label}: ${err.message}`;
    console.error(msg);
    sendTelegram(msg);
  }
}

async function smartCycle() {
  const polBalance = await polToken.balanceOf(wallet.address);
  const xinBalance = await xinToken.balanceOf(wallet.address);
  const poolBalance = await getWmaticInPool();
  const safeLimit = ethers.parseEther("10");

  const amount = randomAmount();
  const shouldPump = Date.now() % (60 * 60 * 1000) < 60000;
  const shouldDump = Date.now() % (3 * 60 * 60 * 1000) < 60000;

  if (shouldPump && polBalance > safeLimit + amount) {
    console.log("📈 Mini PUMP horaire en cours");
    await swap(POL, XIN, amount, "POL → XIN (PUMP)");
  } else if (shouldDump && xinBalance > amount && poolBalance > MIN_POOL_RESERVE) {
    console.log("📉 Mini DUMP 3h en cours");
    await swap(XIN, POL, amount, "XIN → POL (DUMP)");
  } else if (Math.random() < 0.5 && polBalance > safeLimit + amount) {
    await swap(POL, XIN, amount, "POL → XIN (random)");
  } else if (xinBalance >= amount && poolBalance > MIN_POOL_RESERVE) {
    await swap(XIN, POL, amount, "XIN → POL (random)");
  } else {
    console.log("⏳ Rien à faire pour l’instant.");
  }
}

async function postStatsIfNeeded() {
  const now = Date.now();
  if (now - lastStats > 30 * 60 * 1000) {
    const msg = `📊 Stats XiBot v9
XIN acheté: ${format(stats.xinBought)}
XIN vendu: ${format(stats.xinSold)}
POL utilisé: ${format(stats.polUsed)}
POL gagné: ${format(stats.polGained)}`;
    sendTelegram(msg);
    lastStats = now;
  }
}

async function loop() {
  await checkApproval(polToken, "POL (WMATIC)");
  await checkApproval(xinToken, "XIN");
  sendTelegram("🤖 XiBot v9 activé — optimisation auto des swaps.");

  while (true) {
    try {
      await smartCycle();
      await postStatsIfNeeded();
      await delay(Math.floor(Math.random() * 45000) + 45000); // 45s–90s
    } catch (err) {
      console.error("⚠️ Erreur boucle:", err.message);
      sendTelegram("❌ Erreur boucle: " + err.message);
      await delay(60000);
    }
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("XiBot v9 actif — auto-swap & profit tracker");
}).listen(process.env.PORT || 3000);