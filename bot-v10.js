// ✅ XiBot v10 - avec ajout/retrait réel de liquidité Uniswap V3 + graphique Telegram
import dotenv from "dotenv";
import { ethers } from "ethers";
import { createRequire } from 'module'; 
const require = createRequire(import.meta.url);

// Charger l'ABI de NonfungiblePositionManager
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
const POL = process.env.POL_TOKEN;
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

const poolAbi = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function liquidity() view returns (uint128)"
];

const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const pol = new ethers.Contract(POL, erc20Abi, wallet);
const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const pool = new ethers.Contract(POOL_ADDRESS, poolAbi, provider);
const nftManager = new ethers.Contract(NFT_POSITION_MANAGER, NonfungiblePositionManagerABI.abi, wallet);

let stats = {
  polUsed: 0n,
  polGained: 0n,
  xinBought: 0n,
  xinSold: 0n,
  swaps: 0,
  lastActivity: Date.now(),
  lastStats: Date.now(),
  nftId: process.env.NFT_ID, // Charger directement l'ID NFT depuis le .env
  initialPol: 0n
};

let performanceData = [];

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

async function sendTelegramChart(path, caption = "") {
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", caption);
  form.append("photo", fs.createReadStream(path));

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, form, {
    headers: form.getHeaders()
  });
}

async function generateChart() {
  const width = 600, height = 300;
  const canvas = new ChartJSNodeCanvas({ width, height });
  const config = {
    type: 'line',
    data: {
      labels: performanceData.map(p => p.time),
      datasets: [{
        label: 'Profit net (POL)',
        data: performanceData.map(p => p.pnl),
        borderWidth: 2
      }]
    },
    options: {
      responsive: false,
      scales: { y: { beginAtZero: true } }
    }
  };
  const buffer = await canvas.renderToBuffer(config);
  fs.writeFileSync("pnl.png", buffer);
  await sendTelegramChart("pnl.png", "📈 Performance horaire de XiBot");
}

function autoRestartCheck() {
  const now = Date.now();
  if (now - stats.lastActivity > 20 * 60 * 1000) {
    log("⏱️ Inactivité détectée >20min. Redémarrage recommandé.");
    process.exit(1);
  }
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
  log(`🔁 Swap ${label} : ${format(amount)} tokens`);
  try {
    await approveIfNeeded(tokenIn === POL ? pol : xin, label, ROUTER);
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
    log(`❌ Échec swap ${label} : ${err.message}`);
  }
}

async function addLiquidity(amount0, amount1) {
  if (stats.nftId) {
    // Si le NFT existe, réutiliser ce NFT pour ajouter de la liquidité
    log(`🔄 Réutilisation du NFT ID: ${stats.nftId} pour ajouter de la liquidité`);
    const tx = await nftManager.increaseLiquidity({
      tokenId: stats.nftId,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      deadline: Math.floor(Date.now() / 1000) + 600
    });
    await tx.wait();
    log(`💧 Liquidité ajoutée au NFT existant!`);
  } else {
    // Si le NFT n'existe pas, en créer un nouveau
    log(`🆕 Création d'un nouveau NFT pour ajouter de la liquidité`);
    await approveIfNeeded(pol, "POL", NFT_POSITION_MANAGER);
    await approveIfNeeded(xin, "XIN", NFT_POSITION_MANAGER);

    const tx = await nftManager.mint({
      token0: POL,
      token1: XIN,
      fee: 3000,
      tickLower: -600,
      tickUpper: 600,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: 0,
      amount1Min: 0,
      recipient: wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 600
    });
    const receipt = await tx.wait();
    const event = receipt.logs.find(x => x.fragment.name === "IncreaseLiquidity");
    if (event) {
      stats.nftId = Number(event.args.tokenId);
      log(`💧 Liquidité ajoutée ! NFT ID: ${stats.nftId}`);
    }
  }
}

async function removeLiquidity(nftId) {
  if (!nftId) return;
  const tx = await nftManager.decreaseLiquidity({
    tokenId: nftId,
    liquidity: 100000,
    amount0Min: 0,
    amount1Min: 0,
    deadline: Math.floor(Date.now() / 1000) + 600
  });
  await tx.wait();
  log("💸 Liquidité retirée");
}

async function loop() {
  await approveIfNeeded(pol, "POL", ROUTER);
  await approveIfNeeded(xin, "XIN", ROUTER);
  stats.initialPol = await pol.balanceOf(wallet.address);
  log("🤖 XiBot v10 actif avec Uniswap V3 Liquidity Manager");

  while (true) {
    autoRestartCheck();
    const polBalance = await pol.balanceOf(wallet.address);
    const xinBalance = await xin.balanceOf(wallet.address);

    if (polBalance > parse("10")) {
      await swap(POL, XIN, parse("3"), "POL → XIN");
      await addLiquidity(parse("2"), parse("500"));
    } else if (xinBalance > parse("10")) {
      await removeLiquidity(stats.nftId);
      await swap(XIN, POL, parse("3"), "XIN → POL");
    }

    if (Date.now() - stats.lastStats > 60 * 60 * 1000) {
      const currentPOL = await pol.balanceOf(wallet.address);
      const pnl = currentPOL - stats.initialPol;
      performanceData.push({
        time: new Date().toISOString().slice(11, 19),
        pnl: Number(format(pnl))
      });
      await generateChart();
      stats.lastStats = Date.now();
    }

    await delay(60000);
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("✅ XiBot v10 actif avec stratégie dynamique + liquidité Uniswap + chart Telegram");
}).listen(process.env.PORT || 3000);
