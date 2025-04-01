// ✅ XiBot v12 Firebase-compatible - stratégie intelligente de rendement XIN/POL avec sécurité swap
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

// Configuration du provider avec les options nécessaires
const provider = new ethers.JsonRpcProvider(process.env.POLYGON_URL, {
  name: 'polygon',
  chainId: 137
});

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const BOT_ID = process.env.BOT_ID || "bot1";

// Ajout des constantes pour le wallet de liquidité
const LIQUIDITY_WALLET = process.env.LIQUIDITY_WALLET;
const LIQUIDITY_PRIVATE_KEY = process.env.LIQUIDITY_PRIVATE_KEY;
const liquidityWallet = new ethers.Wallet(LIQUIDITY_PRIVATE_KEY, provider);

const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const ROUTER = process.env.ROUTER;
const QUOTER = process.env.QUOTER;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const routerAbi = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)",
  "function exactInput(bytes calldata path, uint256 amountIn, uint256 amountOutMinimum, uint256 deadline) external payable returns (uint256)"
];
const quoterAbi = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)",
  "function quoteExactInput(bytes calldata path, uint256 amountIn) external view returns (uint256 amountOut)"
];
const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

// Création des contrats avec le bon signer
const router = new ethers.Contract(ROUTER, routerAbi, wallet);
const quoter = new ethers.Contract(QUOTER, quoterAbi, provider);
const xin = new ethers.Contract(XIN, erc20Abi, wallet);
const pol = new ethers.Contract(POL, erc20Abi, wallet);

// Ajout des constantes pour la gestion de la liquidité
const POOL_ADDRESS = process.env.POOL_ADDRESS;
const POOL_ABI = [
  "function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external returns (uint256 amount0, uint256 amount1)",
  "function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1)",
  "function positions(bytes32) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) external returns (uint128 amount0, uint128 amount1)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)"
];

const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);

// Nouvelles constantes pour la gestion des risques
const STOP_LOSS_PERCENTAGE = 0.2;
const TAKE_PROFIT_PERCENTAGE = 0.5;
const MAX_POSITION_SIZE = parse("2");
const MIN_POSITION_SIZE = parse("0.15");
const SWAP_INTERVAL = 10 * 1000;
const MIN_BALANCE_FOR_SWAP = parse("0.15");
const RSI_OVERSOLD = 40;
const RSI_OVERBOUGHT = 60;
const PRICE_CHANGE_THRESHOLD = 0.15;

// Nouvelles constantes pour la gestion des mouvements
const PUMP_THRESHOLD = 0.3;
const DUMP_THRESHOLD = 0.2;
const MAX_CONSECUTIVE_TRADES = 4;

// Constantes pour la gestion de la liquidité
const LIQUIDITY_CHECK_INTERVAL = 30 * 1000;
const MIN_LIQUIDITY_THRESHOLD = parse("20"); // Minimum 20 POL
const MAX_LIQUIDITY_THRESHOLD = parse("250"); // Maximum 250 POL
const POSITION_TICK_LOWER = -5;
const POSITION_TICK_UPPER = 5;

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

// Fonction pour calculer le RSI
async function calculateRSI(prices) {
  if (prices.length < 14) {
    log(`⚠️ Données insuffisantes pour le RSI (${prices.length}/14)`);
    return null;
  }
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < 14; i++) {
    const difference = prices[i] - prices[i-1];
    if (difference >= 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }
  
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  
  if (avgLoss === 0) {
    log(`⚠️ RSI non calculable : pertes moyennes nulles`);
    return null;
  }
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  log(`📊 RSI calculé : ${rsi.toFixed(2)} (gains: ${avgGain.toFixed(4)}, pertes: ${avgLoss.toFixed(4)})`);
  return rsi;
}

// Fonction pour vérifier les conditions de stop-loss
async function checkStopLoss(entryPrice, currentPrice) {
  const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
  return priceChange <= -STOP_LOSS_PERCENTAGE;
}

// Fonction pour vérifier les conditions de take-profit
async function checkTakeProfit(entryPrice, currentPrice) {
  const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
  return priceChange >= TAKE_PROFIT_PERCENTAGE;
}

// Fonction améliorée pour déterminer le montant dynamique
function getDynamicAmount(pnl, rsi) {
  let baseAmount;
  
  if (pnl > 15) {
    baseAmount = 1.5; // Réduit pour plus de sécurité
  } else if (pnl < 0) {
    baseAmount = 0.8; // Augmenté pour plus de trades
  } else {
    baseAmount = 1.0; // Plus équilibré
  }
  
  // Ajustement basé sur le RSI
  if (rsi) {
    if (rsi < RSI_OVERSOLD) {
      baseAmount *= 1.2; // Augmentation de 20% si survendu
    } else if (rsi > RSI_OVERBOUGHT) {
      baseAmount *= 0.8; // Réduction de 20% si suracheté
    }
  }
  
  const amount = Math.min(Math.max(baseAmount, 0.15), 2);
  return parse(amount.toFixed(3));
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

async function postStats(currentPrice, period) {
  const ref = db.ref(`/xibot/bots/${BOT_ID}/stats`);
  const stats = (await ref.get()).val() || {};
  const lastStatsRef = await db.ref(`/xibot/bots/${BOT_ID}/last${period}Stats`).get();
  const lastStats = lastStatsRef.val() || {};
  
  // Calcul des variations
  const xinBoughtChange = (stats.xinBought || 0) - (lastStats.xinBought || 0);
  const xinSoldChange = (stats.xinSold || 0) - (lastStats.xinSold || 0);
  const polUsedChange = (stats.polUsed || 0) - (lastStats.polUsed || 0);
  const polGainedChange = (stats.polGained || 0) - (lastStats.polGained || 0);
  const netProfitChange = (stats.netProfit || 0) - (lastStats.netProfit || 0);

  // Calcul des moyennes et statistiques avancées
  const tradesPerHour = period === "Hour" ? 
    (stats.successfulTrades || 0) - (lastStats.successfulTrades || 0) :
    ((stats.successfulTrades || 0) - (lastStats.successfulTrades || 0)) / (period === "Day" ? 24 : 2);

  const successRate = ((stats.successfulTrades / ((stats.successfulTrades || 0) + (stats.failedTrades || 1))) * 100).toFixed(2);
  const avgTradeSize = (stats.polUsed / ((stats.successfulTrades || 0) + (stats.failedTrades || 1))).toFixed(4);
  const profitPerTrade = (stats.netProfit / ((stats.successfulTrades || 0) + (stats.failedTrades || 1))).toFixed(4);

  // Calcul de la liquidité actuelle
  const currentLiquidity = await checkLiquidity();
  const liquidityPercentage = ((Number(currentLiquidity) - Number(MIN_LIQUIDITY_THRESHOLD)) / (Number(MAX_LIQUIDITY_THRESHOLD) - Number(MIN_LIQUIDITY_THRESHOLD)) * 100).toFixed(2);

  const msg = `📊 XiBot v12 [${BOT_ID}] - Rapport ${period === "30Min" ? "30 Minutes" : period === "Hour" ? "Horaire" : "Journalier"}
━━━━━━━━━━━━━━━━━━━━
💫 Performance :
• Profit net : ${stats.netProfit || 0} POL (${netProfitChange >= 0 ? '+' : ''}${netProfitChange.toFixed(4)})
• ROI : ${((stats.netProfit / (stats.polUsed || 1)) * 100).toFixed(2)}%
• Trades/h : ${tradesPerHour.toFixed(1)}
• Profit/trade : ${profitPerTrade} POL

📈 Trading :
• XIN acheté : ${stats.xinBought || 0} (${xinBoughtChange >= 0 ? '+' : ''}${xinBoughtChange.toFixed(4)})
• XIN vendu : ${stats.xinSold || 0} (${xinSoldChange >= 0 ? '+' : ''}${xinSoldChange.toFixed(4)})
• POL utilisé : ${stats.polUsed || 0} (${polUsedChange >= 0 ? '+' : ''}${polUsedChange.toFixed(4)})
• POL gagné : ${stats.polGained || 0} (${polGainedChange >= 0 ? '+' : ''}${polGainedChange.toFixed(4)})
• Taille moyenne : ${avgTradeSize} POL

💰 État actuel :
• Prix XIN : ${currentPrice}
• Balance POL : ${format(await pol.balanceOf(wallet.address))}
• Balance XIN : ${format(await xin.balanceOf(wallet.address))}
• Liquidité : ${format(currentLiquidity)} (${liquidityPercentage}%)

📊 Historique :
• Trades réussis : ${stats.successfulTrades || 0}
• Trades échoués : ${stats.failedTrades || 0}
• Taux de réussite : ${successRate}%
• Stop-loss : ${stats.stopLossCount || 0}
• Take-profit : ${stats.takeProfitCount || 0}`;

  sendTelegram(msg);
  
  // Sauvegarder les stats actuelles pour la prochaine comparaison
  await db.ref(`/xibot/bots/${BOT_ID}/last${period}Stats`).set(stats);
  await db.ref(`/xibot/stats/lastPrice`).set(currentPrice);
}

async function getLastPrice() {
  const ref = db.ref(`/xibot/stats/lastPrice`);
  return (await ref.get()).val() || null;
}

// Fonction de retry pour les opérations blockchain
async function retryOperation(operation, maxRetries = 3, delayMs = 5000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      log(`⚠️ Tentative ${i + 1}/${maxRetries} échouée: ${err.message}`);
      await delay(delayMs);
    }
  }
}

async function swap(tokenIn, tokenOut, amountIn, label) {
  try {
    if (process.env.SIMULATION === "true") {
      log(`[SIMULATION] ${label} avec ${format(amountIn)}`);
      return;
    }

    log(`🔄 Début du swap ${label} avec ${format(amountIn)}`);

    // Vérification plus stricte des balances avec retry
    const [balance, allowance] = await Promise.all([
      retryOperation(() => (tokenIn === POL ? pol : xin).balanceOf(wallet.address)),
      retryOperation(() => (tokenIn === POL ? pol : xin).allowance(wallet.address, ROUTER))
    ]);

    if (balance < amountIn) {
      log(`⛔ Swap annulé : balance insuffisante (${format(balance)} < ${format(amountIn)}) pour ${label}`);
      return;
    }

    if (amountIn < parse("0.1")) {
      log(`⚠️ Swap annulé : montant trop faible (${format(amountIn)}) pour ${label}`);
      return;
    }

    // Vérification et mise à jour des approbations si nécessaire
    if (allowance < amountIn) {
      log(`🔄 Approbation nécessaire pour ${label}`);
      const approveTx = await retryOperation(() => 
        (tokenIn === POL ? pol : xin).approve(ROUTER, ethers.MaxUint256)
      );
      await approveTx.wait();
      log(`✅ Approbation confirmée pour ${label}`);
    }

    log(`💹 Calcul du prix pour ${label}`);
    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [tokenIn, 3000, tokenOut]
    );
    
    // Calcul du prix avec retry et validation
    let quote;
    try {
      quote = await retryOperation(async () => {
        try {
          const exactInputQuote = await quoter.quoteExactInput(path, amountIn);
          if (exactInputQuote > 0n) return exactInputQuote;
          
          log(`⚠️ Quote exactInput retourne 0, tentative avec quoteExactInputSingle`);
          return await quoter.quoteExactInputSingle(
            tokenIn,
            tokenOut,
            3000,
            amountIn,
            0
          );
        } catch (err) {
          log(`⚠️ Erreur quoteExactInput, tentative avec quoteExactInputSingle: ${err.message}`);
          return await quoter.quoteExactInputSingle(
            tokenIn,
            tokenOut,
            3000,
            amountIn,
            0
          );
        }
      });
    } catch (err) {
      log(`❌ Échec du calcul du prix après plusieurs tentatives: ${err.message}`);
      return;
    }

    if (quote <= 0n) {
      log(`⚠️ Swap annulé : estimation invalide (${format(quote)}) pour ${label}`);
      return;
    }

    const minReceived = quote * 98n / 100n; // 2% de slippage

    log(`📝 Exécution du swap ${label} avec slippage de 2%`);
    let tx;
    try {
      tx = await retryOperation(async () => {
        try {
          // Tentative avec exactInput
          const exactInputTx = await router.exactInput(
            path,
            amountIn,
            minReceived,
            Math.floor(Date.now() / 1000) + 600,
            {
              gasLimit: 500000,
              maxFeePerGas: ethers.parseUnits('100', 'gwei'),
              maxPriorityFeePerGas: ethers.parseUnits('25', 'gwei')
            }
          );
          return exactInputTx;
        } catch (err) {
          log(`⚠️ Erreur exactInput, tentative avec exactInputSingle: ${err.message}`);
          // Fallback avec exactInputSingle
          return await router.exactInputSingle([
            tokenIn, tokenOut, 3000, wallet.address,
            Math.floor(Date.now() / 1000) + 600, amountIn, minReceived, 0
          ], {
            gasLimit: 500000,
            maxFeePerGas: ethers.parseUnits('100', 'gwei'),
            maxPriorityFeePerGas: ethers.parseUnits('25', 'gwei')
          });
        }
      });
    } catch (err) {
      log(`❌ Échec du swap après plusieurs tentatives: ${err.message}`);
      throw err;
    }

    log(`⏳ Attente de la confirmation de la transaction...`);
    const receipt = await retryOperation(async () => {
      return await tx.wait();
    });
    
    if (!receipt || !receipt.status) {
      throw new Error(`Transaction échouée ou non confirmée (status: ${receipt?.status})`);
    }

    log(`✅ Transaction confirmée : ${receipt.hash}`);
    
    // Mise à jour des statistiques de trading
    const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
    const stats = (await statsRef.get()).val() || {};
    await statsRef.child("successfulTrades").set((stats.successfulTrades || 0) + 1);
    
    // Mise à jour des compteurs de stop-loss et take-profit
    if (label.includes("stop-loss")) {
      await statsRef.child("stopLossCount").set((stats.stopLossCount || 0) + 1);
    } else if (label.includes("take-profit")) {
      await statsRef.child("takeProfitCount").set((stats.takeProfitCount || 0) + 1);
    }
    
    log(`✅ Swap réussi : ${format(amountIn)} ${label} (gas: ${receipt.gasUsed})`);

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
      amountOutMin: format(minReceived),
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: receipt.gasPrice.toString(),
      txHash: receipt.hash
    });
  } catch (err) {
    // Mise à jour des statistiques d'échec
    const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
    const stats = (await statsRef.get()).val() || {};
    await statsRef.child("failedTrades").set((stats.failedTrades || 0) + 1);
    
    log(`❌ Erreur swap (${label}): ${err.message || err.reason || 'Erreur inconnue'}`);
    if (err.transaction) {
      log(`📝 Détails de la transaction: ${JSON.stringify(err.transaction, null, 2)}`);
    }
    console.error(err);
  }
}

// Fonction pour ajouter de la liquidité
async function addLiquidity(amount0, amount1) {
  try {
    // Utiliser le wallet de liquidité pour les opérations de liquidité
    const liquidityPool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, liquidityWallet);
    const liquidityXin = new ethers.Contract(XIN, erc20Abi, liquidityWallet);
    const liquidityPol = new ethers.Contract(POL, erc20Abi, liquidityWallet);

    // Vérifier les balances du wallet de liquidité
    const polBalance = await liquidityPol.balanceOf(LIQUIDITY_WALLET);
    const xinBalance = await liquidityXin.balanceOf(LIQUIDITY_WALLET);

    if (polBalance < amount0 || xinBalance < amount1) {
      log(`⚠️ Balance insuffisante dans le wallet de liquidité`);
      return false;
    }

    // Approbations avec le wallet de liquidité
    await approveIfNeeded(liquidityXin, "XIN pour liquidité", POOL_ADDRESS);
    await approveIfNeeded(liquidityPol, "POL pour liquidité", POOL_ADDRESS);

    const tx = await liquidityPool.mint(
      LIQUIDITY_WALLET,
      POSITION_TICK_LOWER,
      POSITION_TICK_UPPER,
      amount0,
      "0x"
    );
    await tx.wait();
    log(`✅ Liquidité ajoutée : ${format(amount0)} XIN + ${format(amount1)} POL`);
    return true;
  } catch (err) {
    log(`❌ Erreur ajout liquidité: ${err.message}`);
    return false;
  }
}

// Fonction pour retirer de la liquidité
async function removeLiquidity(amount) {
  try {
    // Utiliser le wallet de liquidité pour les opérations de liquidité
    const liquidityPool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, liquidityWallet);

    const tx = await liquidityPool.burn(
      POSITION_TICK_LOWER,
      POSITION_TICK_UPPER,
      amount
    );
    await tx.wait();
    
    // Collecter les tokens après le burn
    await liquidityPool.collect(
      LIQUIDITY_WALLET,
      POSITION_TICK_LOWER,
      POSITION_TICK_UPPER,
      ethers.MaxUint128,
      ethers.MaxUint128
    );
    
    log(`✅ Liquidité retirée : ${format(amount)}`);
    return true;
  } catch (err) {
    log(`❌ Erreur retrait liquidité: ${err.message}`);
    return false;
  }
}

// Fonction pour vérifier la liquidité actuelle
async function checkLiquidity() {
  try {
    const positionKey = ethers.keccak256(
      ethers.solidityPacked(
        ["address", "int24", "int24"],
        [LIQUIDITY_WALLET, POSITION_TICK_LOWER, POSITION_TICK_UPPER]
      )
    );
    const position = await pool.positions(positionKey);
    return position.liquidity;
  } catch (err) {
    log(`❌ Erreur vérification liquidité: ${err.message}`);
    return 0n;
  }
}

async function postGlobalStats() {
  const botsRef = await db.ref("/xibot/bots").get();
  const bots = botsRef.val() || {};
  const botIds = Object.keys(bots);
  
  // Calcul des totaux globaux
  let totalNetProfit = 0;
  let totalPolUsed = 0;
  let totalPolGained = 0;
  let totalSuccessfulTrades = 0;
  let totalFailedTrades = 0;
  
  for (const botId of botIds) {
    const stats = bots[botId].stats || {};
    totalNetProfit += parseFloat(stats.netProfit || 0);
    totalPolUsed += parseFloat(stats.polUsed || 0);
    totalPolGained += parseFloat(stats.polGained || 0);
    totalSuccessfulTrades += parseInt(stats.successfulTrades || 0);
    totalFailedTrades += parseInt(stats.failedTrades || 0);
  }

  // Calcul de la liquidité actuelle
  const currentLiquidity = await checkLiquidity();
  const liquidityPercentage = ((Number(currentLiquidity) - Number(MIN_LIQUIDITY_THRESHOLD)) / (Number(MAX_LIQUIDITY_THRESHOLD) - Number(MIN_LIQUIDITY_THRESHOLD)) * 100).toFixed(2);

  // Calcul du prix actuel
  const quotePOL = await quoter.quoteExactInputSingle(
    POL,
    XIN,
    3000,
    parse("1"),
    0
  );
  const currentPrice = parseFloat(format(quotePOL));

  let msg = `🌐 État Global XiBot v12
━━━━━━━━━━━━━━━━━━━━
💰 Pool :
• Prix XIN : ${currentPrice}
• Liquidité totale : ${format(currentLiquidity)} (${liquidityPercentage}%)
• Min/Max : ${format(MIN_LIQUIDITY_THRESHOLD)} / ${format(MAX_LIQUIDITY_THRESHOLD)}

📊 Performance Globale :
• Profit net total : ${totalNetProfit.toFixed(4)} POL
• ROI global : ${((totalNetProfit / (totalPolUsed || 1)) * 100).toFixed(2)}%
• Trades réussis : ${totalSuccessfulTrades}
• Trades échoués : ${totalFailedTrades}
• Taux de réussite : ${((totalSuccessfulTrades / (totalSuccessfulTrades + totalFailedTrades || 1)) * 100).toFixed(2)}%

🤖 État des Bots :`;

  // Ajout des informations pour chaque bot
  for (const botId of botIds) {
    const bot = bots[botId];
    const stats = bot.stats || {};
    const lastSwap = bot.lastSwap || 0;
    const timeSinceLastSwap = Math.floor((Date.now() - lastSwap) / 1000);
    
    msg += `\n\n[${botId}] :
• Dernier swap : ${timeSinceLastSwap < 60 ? `${timeSinceLastSwap}s` : `${Math.floor(timeSinceLastSwap/60)}m`} ago
• Profit : ${stats.netProfit || 0} POL
• Trades : ${stats.successfulTrades || 0}/${stats.failedTrades || 0}
• Balance POL : ${format(await pol.balanceOf(bot.wallet || wallet.address))}
• Balance XIN : ${format(await xin.balanceOf(bot.wallet || wallet.address))}`;
  }

  sendTelegram(msg);
}

// Fonction pour obtenir le prix actuel avec gestion d'erreur
async function getCurrentPrice() {
  try {
    // Utiliser quoteExactInput avec le chemin encodé
    const path = ethers.solidityPacked(
      ["address", "uint24", "address"],
      [POL, 3000, XIN]
    );
    
    const quotePOL = await quoter.quoteExactInput(
      path,
      parse("1")
    );
    
    const price = parseFloat(format(quotePOL));
    if (price > 0) {
      return price;
    }
    
    // Si le prix est 0, essayer avec quoteExactInputSingle
    const quoteSingle = await quoter.quoteExactInputSingle(
      POL,
      XIN,
      3000,
      parse("1"),
      0
    );
    
    return parseFloat(format(quoteSingle));
  } catch (err) {
    log(`⚠️ Erreur lors du calcul du prix: ${err.message}`);
    
    // En cas d'erreur, on utilise le dernier prix connu
    const lastPrice = await getLastPrice();
    if (lastPrice) {
      return lastPrice;
    }
    
    // Si pas de dernier prix connu, on attend un peu plus longtemps
    await delay(10000);
    return 0;
  }
}

async function loop() {
  log("🤖 XiBot v12 Firebase lancé avec stratégie de trading optimisée");
  let last30MinStats = Date.now();
  let lastHourStats = Date.now();
  let lastDayStats = Date.now();
  let lastGlobalStats = Date.now();
  let lastLiquidityCheck = Date.now();
  let priceHistory = [];
  let lastEntryPrice = null;
  let lastSwapTime = Date.now();
  let consecutiveTrades = 0;
  let lastTradeDirection = null;
  let lastPrice = null;
  let lastBalances = { pol: 0n, xin: 0n };
  
  while (true) {
    try {
      const now = Date.now();
      const strategy = (await db.ref("/xibot/strategy").get()).val() || {};
      const { nextPump, nextDump, lastBot, marketPhase } = strategy;
      
      // Vérification des balances avec retry et validation
      const [polBalance, xinBalance] = await Promise.all([
        retryOperation(() => pol.balanceOf(wallet.address)),
        retryOperation(() => xin.balanceOf(wallet.address))
      ]);

      // Validation des balances
      if (lastBalances.pol !== 0n && Math.abs(Number(polBalance - lastBalances.pol)) > 10) {
        log(`⚠️ Changement important de balance POL détecté : ${format(lastBalances.pol)} → ${format(polBalance)}`);
      }
      if (lastBalances.xin !== 0n && Math.abs(Number(xinBalance - lastBalances.xin)) > 1) {
        log(`⚠️ Changement important de balance XIN détecté : ${format(lastBalances.xin)} → ${format(xinBalance)}`);
      }
      lastBalances = { pol: polBalance, xin: xinBalance };
      
      const statsRef = await db.ref(`/xibot/bots/${BOT_ID}/stats`).get();
      const pnl = (statsRef.val()?.netProfit || 0);

      // Vérification de la liquidité
      if (now - lastLiquidityCheck >= LIQUIDITY_CHECK_INTERVAL) {
        const currentLiquidity = await checkLiquidity();
        const poolLiquidity = await pool.liquidity();
        
        if (currentLiquidity < MIN_LIQUIDITY_THRESHOLD) {
          const amountToAdd = MIN_LIQUIDITY_THRESHOLD - currentLiquidity;
          if (polBalance >= amountToAdd && xinBalance >= amountToAdd) {
            await addLiquidity(amountToAdd, amountToAdd);
            log(`💧 Ajout de liquidité : ${format(amountToAdd)} POL pour atteindre le minimum de 20 POL`);
          }
        } else if (currentLiquidity > MAX_LIQUIDITY_THRESHOLD) {
          const amountToRemove = currentLiquidity - MAX_LIQUIDITY_THRESHOLD;
          await removeLiquidity(amountToRemove);
          log(`💧 Retrait de liquidité : ${format(amountToRemove)} POL pour ne pas dépasser 250 POL`);
        }
        
        lastLiquidityCheck = now;
      }

      const currentPrice = await getCurrentPrice();
      if (currentPrice === 0) {
        log("⚠️ Prix non disponible, attente de la prochaine itération");
        await delay(5000);
        continue;
      }
      
      // Mise à jour de l'historique des prix avec validation
      if (currentPrice !== lastPrice) {
        if (lastPrice && Math.abs(currentPrice - lastPrice) > lastPrice * 0.1) {
          log(`⚠️ Changement important de prix détecté : ${lastPrice} → ${currentPrice}`);
        }
        priceHistory.push(currentPrice);
        if (priceHistory.length > 14) priceHistory.shift();
        lastPrice = currentPrice;
      }
      
      const rsi = await calculateRSI(priceHistory);
      const dynamicAmount = getDynamicAmount(pnl, rsi);
      const priceChange = lastPrice ? ((currentPrice - lastPrice) / lastPrice) * 100 : 0;

      // Nouvelle logique de trading coordonnée
      const timeSinceLastSwap = now - lastSwapTime;
      const isTimeToSwap = timeSinceLastSwap >= SWAP_INTERVAL;
      const isThisBotTurn = !lastBot || lastBot !== BOT_ID;

      // Détermination de la phase de marché
      let currentMarketPhase = marketPhase || "neutral";
      if (priceChange >= PUMP_THRESHOLD) currentMarketPhase = "pump";
      if (priceChange <= -DUMP_THRESHOLD) currentMarketPhase = "dump";

      // Logs des conditions avec plus de détails
      log(`📊 État des conditions de swap :
• Temps depuis dernier swap : ${Math.floor(timeSinceLastSwap/1000)}s (min: ${SWAP_INTERVAL/1000}s)
• Tour du bot : ${isThisBotTurn ? "✅" : "⏳"}
• Phase de marché : ${currentMarketPhase}
• RSI : ${rsi ? rsi.toFixed(2) : "N/A"} (${priceHistory.length}/14 données)
• Variation prix : ${priceChange.toFixed(2)}%
• Trades consécutifs : ${consecutiveTrades}/${MAX_CONSECUTIVE_TRADES}
• Balance POL : ${format(polBalance)}
• Balance XIN : ${format(xinBalance)}
• Dernier prix : ${lastPrice ? lastPrice.toFixed(4) : "N/A"}
• Historique prix : ${priceHistory.length} points`);

      // Conditions de trading améliorées
      const shouldBuy = isTimeToSwap && 
        isThisBotTurn &&
        polBalance >= MIN_BALANCE_FOR_SWAP &&
        (
          (currentMarketPhase === "dump" && rsi && rsi < RSI_OVERSOLD) ||
          (currentMarketPhase === "neutral" && priceChange <= -PRICE_CHANGE_THRESHOLD) ||
          (currentMarketPhase === "pump" && consecutiveTrades < MAX_CONSECUTIVE_TRADES) ||
          (!rsi && (
            priceChange <= -0.05 || 
            currentMarketPhase === "dump" ||
            (currentMarketPhase === "neutral" && consecutiveTrades < MAX_CONSECUTIVE_TRADES)
          ))
        );

      const shouldSell = isTimeToSwap && 
        isThisBotTurn &&
        xinBalance >= MIN_BALANCE_FOR_SWAP &&
        (
          (currentMarketPhase === "pump" && rsi && rsi > RSI_OVERBOUGHT) ||
          (currentMarketPhase === "neutral" && priceChange >= PRICE_CHANGE_THRESHOLD) ||
          (currentMarketPhase === "dump" && consecutiveTrades < MAX_CONSECUTIVE_TRADES) ||
          (rsi && rsi > 80) ||
          (!rsi && (
            priceChange >= 0.05 || 
            currentMarketPhase === "pump" ||
            (currentMarketPhase === "neutral" && consecutiveTrades < MAX_CONSECUTIVE_TRADES)
          ))
        );

      if (shouldBuy) {
        sendTelegram(`📉 Opportunité d'achat détectée : prix XIN ↓ (${currentPrice} < ${lastPrice})${rsi ? `, RSI: ${rsi.toFixed(2)}` : ''}`);
        await swap(POL, XIN, dynamicAmount, "POL → XIN (smart buy)");
        lastEntryPrice = currentPrice;
        lastSwapTime = now;
        consecutiveTrades = lastTradeDirection === "buy" ? consecutiveTrades + 1 : 1;
        lastTradeDirection = "buy";
        await db.ref("/xibot/strategy/lastBot").set(BOT_ID);
        await db.ref("/xibot/strategy/marketPhase").set(currentMarketPhase);
      } else if (shouldSell) {
        sendTelegram(`📈 Opportunité de vente détectée : prix XIN ↑ (${currentPrice} > ${lastPrice})${rsi ? `, RSI: ${rsi.toFixed(2)}` : ''}`);
        await swap(XIN, POL, dynamicAmount, "XIN → POL (smart sell)");
        lastEntryPrice = null;
        lastSwapTime = now;
        consecutiveTrades = lastTradeDirection === "sell" ? consecutiveTrades + 1 : 1;
        lastTradeDirection = "sell";
        await db.ref("/xibot/strategy/lastBot").set(BOT_ID);
        await db.ref("/xibot/strategy/marketPhase").set(currentMarketPhase);
      }

      // Vérification des conditions de stop-loss et take-profit
      if (lastEntryPrice) {
        if (await checkStopLoss(lastEntryPrice, currentPrice)) {
          log(`🛑 Stop-loss déclenché à ${currentPrice}`);
          if (xinBalance > MIN_BALANCE_FOR_SWAP) {
            await swap(XIN, POL, xinBalance, "XIN → POL (stop-loss)");
          }
          lastEntryPrice = null;
          consecutiveTrades = 0;
        } else if (await checkTakeProfit(lastEntryPrice, currentPrice)) {
          log(`🎯 Take-profit atteint à ${currentPrice}`);
          if (xinBalance > MIN_BALANCE_FOR_SWAP) {
            await swap(XIN, POL, xinBalance, "XIN → POL (take-profit)");
          }
          lastEntryPrice = null;
          consecutiveTrades = 0;
        }
      }

      // Vérification des rapports périodiques
      if (now - last30MinStats >= 30 * 60 * 1000) {
        await postStats(currentPrice, "30Min");
        last30MinStats = now;
      }
      
      if (now - lastHourStats >= 60 * 60 * 1000) {
        await postStats(currentPrice, "Hour");
        lastHourStats = now;
      }
      
      if (now - lastDayStats >= 24 * 60 * 60 * 1000) {
        await postStats(currentPrice, "Day");
        lastDayStats = now;
      }

      // État global toutes les 5 minutes
      if (now - lastGlobalStats >= 5 * 60 * 1000) {
        await postGlobalStats();
        lastGlobalStats = now;
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
  res.end(`✅ XiBot Firebase actif [${BOT_ID}]`);
}).listen(process.env.PORT || 3000);