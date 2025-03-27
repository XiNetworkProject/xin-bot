// ✅ XiBot v10 Firebase-compatible - vrais swaps Uniswap, sécurité POL ≥ 5
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
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const routerAbi = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)"
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

const router = new ethers.Contract(ROUTER, routerAbi, wallet);
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

async function swap(tokenIn, tokenOut, amountIn, label) {
  try {
    await approveIfNeeded(tokenIn === POL ? pol : xin, label, ROUTER);
    const tx = await router.exactInputSingle([
      tokenIn, tokenOut, 3000, wallet.address,
      Math.floor(Date.now() / 1000) + 600, amountIn, 0, 0
    ], { gasLimit: 500000 });
    await tx.wait();
    log(`✅ Swap : ${format(amountIn)} ${label}`);
  } catch (err) {
    log(`❌ Erreur swap (${label}): ${err.message}`);
  }
}

async function loop() {
  log("🤖 XiBot v10 Firebase lancé");
  while (true) {
    const now = Date.now();
    const strategy = (await db.ref("/xibot/strategy").get()).val() || {};
    const { nextPump, nextDump } = strategy;
    const polBalance = await pol.balanceOf(wallet.address);
    const xinBalance = await xin.balanceOf(wallet.address);

    if (BOT_ID === "bot1" && now >= nextPump && polBalance >= parse("5")) {
      await swap(POL, XIN, getRandomAmount(3), "POL → XIN (pump)");
      await db.ref("/xibot/strategy/nextPump").set(now + 2 * 60 * 60 * 1000);
    }

    if (BOT_ID === "bot2" && now >= nextDump && xinBalance > parse("1")) {
      await swap(XIN, POL, getRandomAmount(3), "XIN → POL (dump)");
      await db.ref("/xibot/strategy/nextDump").set(now + 2 * 60 * 60 * 1000);
    }

    if (Math.random() < 0.5 && polBalance >= parse("5"))
      await swap(POL, XIN, getRandomAmount(2), "POL → XIN (random)");
    else if (xinBalance > parse("1"))
      await swap(XIN, POL, getRandomAmount(2), "XIN → POL (random)");

    await delay(60000);
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(`✅ XiBot Firebase actif [${BOT_ID}]`);
}).listen(process.env.PORT || 3000);