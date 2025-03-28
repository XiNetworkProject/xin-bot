// ✅ XiBot v12 Firebase-compatible - stratégie intelligente de rendement XIN/POL avec sécurité swap
import dotenv from "dotenv";
dotenv.config({ path: process.argv.find(f => f.includes(".env")) || ".env" });

import { ethers } from "ethers";
import { db } from "./firebase.js";
import https from "https";
import http from "http";

const provider = new ethers.JsonRpcProvider(process.env.POLYGON_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const BOT_ID = process.env.BOT_ID || "bot1";

const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const ROUTER = process.env.ROUTER;
const QUOTER = process.env.QUOTER;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const routerAbi = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)"
];
const quoterAbi = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256)"
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const quoter = new ethers.Contract(QUOTER, quoterAbi, provider);
const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const pol = new ethers.Contract(POL, erc20Abi, wallet);

function parse(x) {
  return ethers.parseEther(x.toString());
}
function format(x) {
  return Number(ethers.formatEther(x)).toFixed(4);
}
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function log(msg) {
  console.log(`[${BOT_ID}] ${msg}`);
  sendTelegram(`[${BOT_ID}] ${msg}`);
  db.ref(`/xibot/bots/${BOT_ID}/lastSwap`).set(Date.now());
}

function sendTelegram(msg) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(msg)}`;
  https.get(url, () => {});
}

async function approveIfNeeded(token, label, spender) {
  const allowance = await token.allowance(wallet.address, spender);
  if (allowance < parse("1000")) {
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
    log(`🔐 Approbation ${label}`);
  }
}

function getRandomAmount(max) {
  const amount = Math.random() * (max - 0.5) + 0.5;
  return parse(amount.toFixed(3));
}

function getDynamicAmount(pnl) {
  if (pnl > 20) return parse("5");
  if (pnl < 0) return parse("1");
  return getRandomAmount(2.5);
}

async function updateStats(field, amount) {
  const ref = db.ref(`/xibot/bots/${BOT_ID}/stats/${field}`);
  const current = (await ref.get()).val() || 0;
  await ref.set(current + parseFloat(format(amount)));

  if (field === "polUsed" || field === "polGained") {
    const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
    const stats = (await statsRef.get()).val() || {};
    const pnl = (stats.polGained || 0) - (stats.polUsed || 0);
    await statsRef.child("netProfit").set(pnl.toFixed(4));
  }
}

async function postHourlyStats(currentPrice) {
  const ref = db.ref(`/xibot/bots/${BOT_ID}/stats`);
  const stats = (await ref.get()).val() || {};
  const msg = `📊 XiBot v12 [${BOT_ID}]
+ XIN acheté : ${stats.xinBought || 0}
- XIN vendu : ${stats.xinSold || 0}
💸 POL utilisé : ${stats.polUsed || 0}
💰 POL gagné : ${stats.polGained || 0}
💹 Profit net : ${stats.netProfit || 0} POL
📈 Prix actuel XIN : ${currentPrice}`;
  sendTelegram(msg);
  await db.ref(`/xibot/stats/lastPrice`).set(currentPrice);
}

async function getLastPrice() {
  const ref = db.ref(`/xibot/stats/lastPrice`);
  return (await ref.get()).val() || null;
}

async function swap(tokenIn, tokenOut, amountIn, label) {
  try {
    if (process.env.SIMULATION === "true") {
      log(`[SIMULATION] ${label} avec ${format(amountIn)}`);
      return;
    }

    const balance = await (tokenIn === POL ? pol : xin).balanceOf(wallet.address);
    if (balance < amountIn) {
      log(`⛔ Swap annulé : balance insuffisante pour ${label}`);
      return;
    }

    if (amountIn < parse("0.1")) {
      log(`⚠️ Swap annulé : montant trop faible (${format(amountIn)}) pour ${label}`);
      return;
    }

    await approveIfNeeded(tokenIn === POL ? pol : xin, label, ROUTER);

    const quote = await quoter.quoteExactInputSingle([
      tokenIn, tokenOut, 3000, amountIn, 0
    ]);

    const minReceived = quote * 98n / 100n;

    if (minReceived <= 0n) {
      log(`⚠️ Swap annulé : estimation trop faible pour ${label}`);
      return;
    }

    const tx = await router.exactInputSingle([
      tokenIn, tokenOut, 3000, wallet.address,
      Math.floor(Date.now() / 1000) + 600, amountIn, minReceived, 0
    ], {
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei')
    });
    await tx.wait();
    log(`✅ Swap : ${format(amountIn)} ${label}`);

    if (label.includes("POL → XIN")) {
      await updateStats("polUsed", amountIn);
      await updateStats("xinBought", amountIn);
    } else {
      await updateStats("xinSold", amountIn);
      await updateStats("polGained", amountIn);
    }

    await db.ref(`/xibot/bots/${BOT_ID}/history`).push({
      time: Date.now(),
      direction: label,
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      amount: format(amountIn),
      priceEst: format(quote),
      amountOutMin: format(minReceived)
    });
  } catch (err) {
    log(`❌ Erreur swap (${label}): ${err.message || err.reason || 'Erreur inconnue'}`);
    console.error(err);
  }
}

async function loop() {
  log("🤖 XiBot v12 Firebase lancé");
  let lastStats = Date.now();
  while (true) {
    const now = Date.now();
    const strategy = (await db.ref("/xibot/strategy").get()).val() || {};
    const { nextPump, nextDump } = strategy;
    const polBalance = await pol.balanceOf(wallet.address);
    const xinBalance = await xin.balanceOf(wallet.address);
    const statsRef = await db.ref(`/xibot/bots/${BOT_ID}/stats`).get();
    const pnl = (statsRef.val()?.netProfit || 0);

    const dynamicAmount = getDynamicAmount(pnl);

    const quotePOL = await quoter.quoteExactInputSingle([
      POL, XIN, 3000, parse("1"), 0
    ]);
    const currentPrice = parseFloat(format(quotePOL));
    const lastPrice = await getLastPrice();

    const shouldBuy = lastPrice && currentPrice < lastPrice;
    const shouldSell = lastPrice && currentPrice > lastPrice;

    if (BOT_ID === "bot1" && now >= nextPump && polBalance >= parse("5")) {
      await swap(POL, XIN, dynamicAmount, "POL → XIN (pump)");
      await db.ref("/xibot/strategy/nextPump").set(now + 2 * 60 * 60 * 1000);
    }

    if (BOT_ID === "bot2" && now >= nextDump && xinBalance > parse("1")) {
      await swap(XIN, POL, dynamicAmount, "XIN → POL (dump)");
      await db.ref("/xibot/strategy/nextDump").set(now + 2 * 60 * 60 * 1000);
    }

    if (shouldBuy && polBalance >= parse("1")) {
      sendTelegram(`📉 Opportunité détectée : prix XIN ↓ (${currentPrice} < ${lastPrice}) → achat stratégique`);
      await swap(POL, XIN, dynamicAmount, "POL → XIN (smart buy)");
    } else if (shouldSell && xinBalance >= parse("1")) {
      sendTelegram(`📈 Opportunité détectée : prix XIN ↑ (${currentPrice} > ${lastPrice}) → vente stratégique`);
      await swap(XIN, POL, dynamicAmount, "XIN → POL (smart sell)");
    }

    if (now - lastStats > 60 * 60 * 1000) {
      await postHourlyStats(currentPrice);
      lastStats = now;
    }

    await delay(60000);
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(`✅ XiBot Firebase actif [${BOT_ID}]`);
}).listen(process.env.PORT || 3000);