import dotenv from "dotenv";
import { ethers } from "ethers";
import http from "http";

dotenv.config();

// === CONFIGURATION ===
const RPC_URL = process.env.POLYGON_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap V3 Router

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

function randomMode() {
  return Math.random() < 0.5 ? "buy" : "sell";
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

// === CONTRACTS ===
const router = new ethers.Contract(ROUTER_ADDRESS, routerAbi, wallet);
const polToken = new ethers.Contract(POL, erc20Abi, wallet);
const xinToken = new ethers.Contract(XIN, erc20Abi, wallet);

// === PARAMÈTRES ===
const interval = 3 * 60 * 1000; // 3 minutes

// === APPROVAL AUTO ===
async function checkApproval(token, name) {
  const allowance = await token.allowance(wallet.address, ROUTER_ADDRESS);
  if (allowance < ethers.parseEther("1")) {
    console.log(`🔐 Approval nécessaire pour ${name}. Approbation en cours...`);
    const tx = await token.approve(ROUTER_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    console.log(`✅ ${name} approuvé avec succès !`);
  }
}

// === SWAP LOGIQUE ===
async function swap(tokenIn, tokenOut, amountIn, direction) {
  console.log(`🔁 Swapping ${ethers.formatEther(amountIn)} ${direction === "buy" ? "POL → XIN" : "XIN → POL"}`);
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
  console.log(`✅ Swap ${direction === "buy" ? "POL → XIN" : "XIN → POL"} terminé\n`);
}

// === BOUCLE PRINCIPALE ===
async function loop() {
  await checkApproval(polToken, "POL (WMATIC)");
  await checkApproval(xinToken, "XIN");

  while (true) {
    try {
      const direction = randomMode(); // "buy" ou "sell"
      const amount = randomAmount(); // aléatoire entre 1 et 5 WMATIC

      if (direction === "buy") {
        const polBalance = await polToken.balanceOf(wallet.address);
        if (polBalance >= amount && polBalance >= ethers.parseEther("1")) {
          await swap(POL, XIN, amount, "buy");
        } else {
          console.log("⚠️ Pas assez de WMATIC pour acheter. Skip...");
        }
      } else {
        const xinBalance = await xinToken.balanceOf(wallet.address);
        if (xinBalance >= amount && xinBalance >= ethers.parseEther("1")) {
          await swap(XIN, POL, amount, "sell");
        } else {
          console.log("⚠️ Pas assez de XIN pour vendre. Skip...");
        }
      }

      await delay(interval);

    } catch (err) {
      console.error("❌ Erreur dans la boucle :", err.message);
      await delay(interval);
    }
  }
}

loop();

// === FAKE HTTP SERVER POUR RENDER ===
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(process.env.PORT || 3000);
