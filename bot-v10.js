// ✅ XiBot v10 amélioré - stratégie intelligente Pump/Dump, ajout/retrait dynamique de liquidité
import dotenv from "dotenv";
import { ethers } from "ethers";
import { createRequire } from 'module'; 
const require = createRequire(import.meta.url);

const NonfungiblePositionManagerABI = require('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json');

import https from "https";
import http from "http";
import fs from "fs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import FormData from "form-data";
import axios from "axios";

dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.POLYGON_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const XIN = process.env.XIN_TOKEN;
const WPOL = process.env.POL_TOKEN;
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const NFT_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

const routerAbi = [
  "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) external payable returns (uint256)"
];

const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const wpol = new ethers.Contract(WPOL, erc20Abi, wallet);
const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const nftManager = new ethers.Contract(NFT_POSITION_MANAGER, NonfungiblePositionManagerABI.abi, wallet);

let stats = {
  polUsed: 0n,
  polGained: 0n,
  xinBought: 0n,
  xinSold: 0n,
  swaps: 0,
  lastActivity: Date.now(),
  lastStats: Date.now(),
  nftId: parseInt(process.env.NFT_ID || "2482320"),
  initialPol: 0n
};

let performanceData = [];
let nextPump = Date.now() + 2 * 60 * 60 * 1000;
let nextDump = Date.now() + 4 * 60 * 60 * 1000;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function parse(x) {
  return ethers.parseEther(x.toString());
}

function format(x) {
  return ethers.formatEther(x);
}

function log(msg) {
  console.log(msg);
  sendTelegram(msg);
  stats.lastActivity = Date.now();
}

function sendTelegram(msg) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(msg)}`;
  https.get(url, () => {});
}

function getRandomAmount(max) {
  const amount = Math.random() * (max - 0.5) + 0.5;
  return parse(amount.toFixed(3));
}

async function approveIfNeeded(token, name, spender) {
  const allowance = await token.allowance(wallet.address, spender);
  if (allowance < parse("10000")) {
    log(`🔐 Approbation ${name}...`);
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
    log(`✅ ${name} approuvé.`);
  }
}

async function swap(tokenIn, tokenOut, amount, label) {
  const polBalance = await wpol.balanceOf(wallet.address);
  if (tokenIn === WPOL && polBalance < parse("10")) {
    log("❌ Swap annulé : pas assez de WPOL pour acheter du XIN");
    return;
  }

  log(`🔁 Swap ${label} : ${format(amount)} tokens`);
  try {
    await approveIfNeeded(tokenIn === WPOL ? wpol : xin, label, ROUTER);
    const tx = await router.exactInputSingle([
      tokenIn,
      tokenOut,
      3000,
      wallet.address,
      Math.floor(Date.now() / 1000) + 600,
      amount,
      0,
      0
    ]);
    await tx.wait();
    if (label.includes("POL → XIN")) {
      stats.xinBought += amount;
      stats.polUsed += amount;
    } else {
      stats.xinSold += amount;
      stats.polGained += amount;
    }
    stats.swaps++;
    log(`✅ Swap terminé (${label})`);
  } catch (err) {
    log(`❌ Erreur swap ${label} : ${err.message}`);
  }
}

async function addLiquidity(amount0, amount1) {
  await approveIfNeeded(wpol, "WPOL", NFT_POSITION_MANAGER);
  await approveIfNeeded(xin, "XIN", NFT_POSITION_MANAGER);
  try {
    const tx = await nftManager.increaseLiquidity({
      tokenId: stats.nftId,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      deadline: Math.floor(Date.now() / 1000) + 600
    });
    await tx.wait();
    log(`💧 Liquidité ajoutée au NFT ID ${stats.nftId}`);
  } catch (err) {
    log(`⚠️ Ajout liquidité échoué : ${err.message}`);
  }
}

async function removeLiquidity() {
  try {
    const tx = await nftManager.decreaseLiquidity({
      tokenId: stats.nftId,
      liquidity: 100000,
      amount0Min: 0,
      amount1Min: 0,
      deadline: Math.floor(Date.now() / 1000) + 600
    });
    await tx.wait();
    log("💸 Liquidité retirée du NFT existant");
  } catch (err) {
    log(`❌ Retrait liquidité échoué : ${err.message}`);
  }
}

function autoRestartCheck() {
  const now = Date.now();
  if (now - stats.lastActivity > 20 * 60 * 1000) {
    log("⏱️ Inactivité détectée >20min. Redémarrage recommandé.");
    process.exit(1);
  }
}

async function loop() {
  await approveIfNeeded(wpol, "WPOL", ROUTER);
  await approveIfNeeded(xin, "XIN", ROUTER);
  stats.initialPol = await wpol.balanceOf(wallet.address);
  log("🤖 XiBot v10 intelligent en exécution");

  while (true) {
    autoRestartCheck();
    const polBalance = await wpol.balanceOf(wallet.address);
    const xinBalance = await xin.balanceOf(wallet.address);

    const now = Date.now();

    if (now >= nextPump && polBalance > parse("10")) {
      const amount = getRandomAmount(5);
      await swap(WPOL, XIN, amount, "PUMP POL → XIN");
      nextPump = now + 2 * 60 * 60 * 1000;
    } else if (now >= nextDump && xinBalance > parse("10")) {
      const amount = getRandomAmount(5);
      await swap(XIN, WPOL, amount, "DUMP XIN → POL");
      nextDump = now + 4 * 60 * 60 * 1000;
    } else if (Math.random() < 0.5 && polBalance > parse("10")) {
      const amount = getRandomAmount(3);
      await swap(WPOL, XIN, amount, "Swap aléatoire POL → XIN");
    } else if (xinBalance > parse("10")) {
      const amount = getRandomAmount(3);
      await swap(XIN, WPOL, amount, "Swap aléatoire XIN → POL");
    }

    if (stats.swaps % 10 === 0 && polBalance > parse("3") && xinBalance > parse("100")) {
      await addLiquidity(parse("2"), parse("500"));
    } else if (polBalance < parse("1")) {
      await removeLiquidity();
    }

    await delay(60000);
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("✅ XiBot v10 stratégique actif avec PUMP/DUMP & Uniswap V3");
}).listen(process.env.PORT || 3000);
