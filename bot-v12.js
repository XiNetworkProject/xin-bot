// ✅ XiBot v12 Firebase-compatible - version simplifiée
import dotenv from "dotenv";
dotenv.config({ path: process.argv.find(f => f.includes(".env")) || ".env" });

import { ethers } from "ethers";
import { db } from "./firebase.js";
import https from "https";
import http from "http";

// Log de version
console.log("🚀 XiBot v12 démarré");
console.log("📦 Version:", process.env.BOT_VERSION || "v12");
console.log("🤖 Bot ID:", process.env.BOT_ID || "bot1");

// Configuration du provider
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
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

// Création des contrats
const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const quoter = new ethers.Contract(QUOTER, quoterAbi, provider);
const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const pol = new ethers.Contract(POL, erc20Abi, wallet);

// Constantes simplifiées
const SWAP_INTERVAL = 30 * 1000; // Augmenté à 30 secondes
const MIN_BALANCE_FOR_SWAP = parse("0.15");
const RSI_OVERSOLD = 40;
const RSI_OVERBOUGHT = 60;
const PRICE_CHANGE_THRESHOLD = 0.15;
const MAX_PRICE_CHANGE = 0.5; // 50% de variation maximale autorisée

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

async function swap(tokenIn, tokenOut, amountIn, label) {
  try {
    if (process.env.SIMULATION === "true") {
      log(`[SIMULATION] ${label} avec ${format(amountIn)}`);
      return;
    }

    log(`🔄 Début du swap ${label} avec ${format(amountIn)}`);

    // Vérification des balances
    const balance = await (tokenIn === POL ? pol : xin).balanceOf(wallet.address);
    if (balance < amountIn) {
      log(`⛔ Swap annulé : balance insuffisante (${format(balance)} < ${format(amountIn)}) pour ${label}`);
      return;
    }

    // Vérification de l'approbation
    const allowance = await (tokenIn === POL ? pol : xin).allowance(wallet.address, ROUTER);
    if (allowance < amountIn) {
      log(`🔄 Approbation nécessaire pour ${label}`);
      const approveTx = await (tokenIn === POL ? pol : xin).approve(ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      log(`✅ Approbation confirmée pour ${label}`);
    }

    // Calcul du prix
    const quote = await quoter.quoteExactInputSingle(
      tokenIn,
      tokenOut,
      3000,
      amountIn,
      0
    );

    if (quote <= 0n) {
      log(`⚠️ Swap annulé : estimation invalide (${format(quote)}) pour ${label}`);
      return;
    }

    const minReceived = quote * 98n / 100n; // 2% de slippage

    // Exécution du swap
    const params = {
      tokenIn,
      tokenOut,
      fee: 3000,
      recipient: wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 600,
      amountIn,
      amountOutMinimum: minReceived,
      sqrtPriceLimitX96: 0
    };

    log(`📝 Exécution du swap ${label} avec slippage de 2%`);
    const tx = await router.exactInputSingle(params, {
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits('100', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('25', 'gwei')
    });

    log(`⏳ Attente de la confirmation de la transaction...`);
    const receipt = await tx.wait();
    
    if (!receipt || !receipt.status) {
      throw new Error(`Transaction échouée ou non confirmée (status: ${receipt?.status})`);
    }

    log(`✅ Transaction confirmée : ${receipt.hash}`);
    
    // Mise à jour des statistiques
    const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
    const stats = (await statsRef.get()).val() || {};
    await statsRef.child("successfulTrades").set((stats.successfulTrades || 0) + 1);
    
    log(`✅ Swap réussi : ${format(amountIn)} ${label} (gas: ${receipt.gasUsed})`);

    if (label.includes("POL → XIN")) {
      await updateStats("polUsed", amountIn);
      await updateStats("xinBought", amountIn);
    } else {
      await updateStats("xinSold", amountIn);
      await updateStats("polGained", amountIn);
    }

  } catch (err) {
    const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
    const stats = (await statsRef.get()).val() || {};
    await statsRef.child("failedTrades").set((stats.failedTrades || 0) + 1);
    
    log(`❌ Erreur swap (${label}): ${err.message || err.reason || 'Erreur inconnue'}`);
    console.error(err);
  }
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

async function getCurrentPrice() {
  try {
    const quote = await quoter.quoteExactInputSingle(
      POL,
      XIN,
      3000,
      parse("1"),
      0
    );
    const price = parseFloat(format(quote));
    
    // Vérification du dernier prix connu
    const lastPriceRef = await db.ref(`/xibot/bots/${BOT_ID}/lastPrice`).get();
    const lastPrice = lastPriceRef.val();
    
    if (lastPrice && Math.abs(price - lastPrice) > lastPrice * MAX_PRICE_CHANGE) {
      log(`⚠️ Changement de prix suspect détecté : ${lastPrice} → ${price}`);
      return lastPrice; // Utiliser le dernier prix connu si le changement est trop important
    }
    
    // Sauvegarder le nouveau prix
    await db.ref(`/xibot/bots/${BOT_ID}/lastPrice`).set(price);
    return price;
  } catch (err) {
    log(`⚠️ Erreur lors du calcul du prix: ${err.message}`);
    return 0;
  }
}

async function loop() {
  log("🤖 XiBot v12 démarré");
  let lastSwapTime = Date.now();
  let priceHistory = [];
  let lastPrice = null;
  
  while (true) {
    try {
      const now = Date.now();
      const timeSinceLastSwap = now - lastSwapTime;
      
      // Vérification du tour du bot
      const lastBotRef = await db.ref("/xibot/strategy/lastBot").get();
      const lastBot = lastBotRef.val();
      const isThisBotTurn = !lastBot || lastBot !== BOT_ID;
      
      // Vérification des balances
      const [polBalance, xinBalance] = await Promise.all([
        pol.balanceOf(wallet.address),
        xin.balanceOf(wallet.address)
      ]);

      const currentPrice = await getCurrentPrice();
      if (currentPrice === 0) {
        log("⚠️ Prix non disponible, attente de la prochaine itération");
        await delay(5000);
        continue;
      }

      // Mise à jour de l'historique des prix
      if (currentPrice !== lastPrice) {
        priceHistory.push(currentPrice);
        if (priceHistory.length > 14) priceHistory.shift();
        lastPrice = currentPrice;
      }

      // Calcul du RSI
      let rsi = null;
      if (priceHistory.length >= 14) {
        let gains = 0;
        let losses = 0;
        for (let i = 1; i < 14; i++) {
          const diff = priceHistory[i] - priceHistory[i-1];
          if (diff >= 0) gains += diff;
          else losses -= diff;
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        if (avgLoss > 0) {
          const rs = avgGain / avgLoss;
          rsi = 100 - (100 / (1 + rs));
        }
      }

      // Logs des conditions
      log(`📊 État :
• Temps depuis dernier swap : ${Math.floor(timeSinceLastSwap/1000)}s
• Tour du bot : ${isThisBotTurn ? "✅" : "⏳"}
• RSI : ${rsi ? rsi.toFixed(2) : "N/A"} (${priceHistory.length}/14)
• Balance POL : ${format(polBalance)}
• Balance XIN : ${format(xinBalance)}
• Prix actuel : ${currentPrice}`);

      // Conditions de trading simplifiées
      const shouldBuy = timeSinceLastSwap >= SWAP_INTERVAL && 
        isThisBotTurn &&
        polBalance >= MIN_BALANCE_FOR_SWAP &&
        (!rsi || rsi < RSI_OVERSOLD);

      const shouldSell = timeSinceLastSwap >= SWAP_INTERVAL && 
        isThisBotTurn &&
        xinBalance >= MIN_BALANCE_FOR_SWAP &&
        (!rsi || rsi > RSI_OVERBOUGHT);

      if (shouldBuy) {
        await swap(POL, XIN, parse("0.5"), "POL → XIN");
        lastSwapTime = now;
        await db.ref("/xibot/strategy/lastBot").set(BOT_ID);
      } else if (shouldSell) {
        await swap(XIN, POL, xinBalance, "XIN → POL");
        lastSwapTime = now;
        await db.ref("/xibot/strategy/lastBot").set(BOT_ID);
      }

      await delay(5000);
    } catch (err) {
      log(`❌ Erreur dans la boucle principale: ${err.message}`);
      console.error(err);
      await delay(5000);
    }
  }
}

loop();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end(`✅ XiBot actif [${BOT_ID}]`);
}).listen(process.env.PORT || 3000);