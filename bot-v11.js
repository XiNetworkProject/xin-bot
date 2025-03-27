// ✅ XiBot v11 - version Firebase-compatible synchronisée pour multi-bots avec swaps réels pump/dump

import dotenv from "dotenv";
dotenv.config({ path: process.argv.find(f => f.includes('.env')) || '.env' });

import { ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import { db } from "./firebase.js";
import https from "https";
import http from "http";
import axios from "axios";

const BOT_ID = process.env.BOT_ID || "bot1";
const provider = new ethers.JsonRpcProvider(process.env.POLYGON_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const XIN = process.env.XIN_TOKEN;
const WPOL = process.env.POL_TOKEN;
const ROUTER = process.env.ROUTER;
const NFT_ID = parseInt(process.env.NFT_ID || "2482320");
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const iface = new Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256)"
]);

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const wpol = new ethers.Contract(WPOL, erc20Abi, wallet);

function parse(x) {
  return ethers.parseEther(x.toString());
}
function format(x) {
  return ethers.formatEther(x);
}
function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
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
  if (allowance < parse("10000")) {
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
    log(`🔐 Approbation ${label}`);
  }
}

function getRandomAmount(max) {
  const amount = Math.random() * (max - 0.5) + 0.5;
  return parse(amount.toFixed(3));
}

async function uniswapSwap(tokenIn, tokenOut, amount, label) {
  await approveIfNeeded(tokenIn === WPOL ? wpol : xin, label, ROUTER);
  const params = {
    tokenIn,
    tokenOut,
    fee: 3000,
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 600,
    amountIn: amount,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  };
  const data = iface.encodeFunctionData("exactInputSingle", [params]);
  const tx = await wallet.sendTransaction({ to: ROUTER, data, value: 0 });
  await tx.wait();
  log(`✅ Swap réel exécuté (${label})`);
}

async function doSwap(direction, real = false) {
  const amount = getRandomAmount(3);
  const label = direction === "buy" ? "POL → XIN" : "XIN → POL";

  if (real) {
    await uniswapSwap(
      direction === "buy" ? WPOL : XIN,
      direction === "buy" ? XIN : WPOL,
      amount,
      `PUMP/DUMP ${label}`
    );
  } else {
    await approveIfNeeded(direction === "buy" ? wpol : xin, direction.toUpperCase(), ROUTER);
    log(`🔁 Swap simulé ${label} : ${format(amount)} tokens`);
    await delay(1000);
    log(`✅ Swap simulé terminé (${direction})`);
  }
}

async function loop() {
  log("🤖 XiBot v11 Firebase lancé");
  while (true) {
    const now = Date.now();
    const strategy = (await db.ref("/xibot/strategy").get()).val();
    const { nextPump, nextDump } = strategy || {};

    if (BOT_ID === "bot1" && now >= nextPump) {
      await doSwap("buy", true);
      await db.ref("/xibot/strategy/nextPump").set(now + 2 * 60 * 60 * 1000);
    }

    if (BOT_ID === "bot2" && now >= nextDump) {
      await doSwap("sell", true);
      await db.ref("/xibot/strategy/nextDump").set(now + 2 * 60 * 60 * 1000);
    }

    if (Math.random() < 0.5) await doSwap("buy");
    else await doSwap("sell");

    await delay(60000);
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(`✅ XiBot Firebase actif [${BOT_ID}]`);
}).listen(process.env.PORT || 3000);