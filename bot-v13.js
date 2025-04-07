// ✅ XiBot v13 - Version améliorée pour la génération de profit
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Configuration du chemin du fichier .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BOT_ID = process.argv[2] || "bot1"; // Récupère le BOT_ID depuis les arguments
const envFile = path.join(__dirname, `.env.${BOT_ID}`);

// Chargement du fichier .env approprié
dotenv.config({ path: envFile });

import { ethers } from "ethers";
import { db } from "./firebase.js";
import https from "https";
import http from "http";

// Log de version
console.log("🚀 XiBot v13 démarré");
console.log("📦 Version:", process.env.BOT_VERSION || "v13");
console.log("🤖 Bot ID:", BOT_ID);
console.log("🔧 Mode:", process.env.SIMULATION === "true" ? "SIMULATION" : "RÉEL");
console.log("📁 Fichier de configuration:", envFile);

// Configuration du provider
const provider = new ethers.JsonRpcProvider(process.env.POLYGON_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Adresses des contrats
const XIN = process.env.XIN_TOKEN;
const POL = process.env.POL_TOKEN;
const ROUTER = process.env.ROUTER;
const QUOTER = process.env.QUOTER;

// Configuration Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ABIs des contrats
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

// Paramètres de trading optimisés pour le profit maximum
const SWAP_INTERVAL = 5000; // Augmenté à 5 secondes pour plus de stabilité
const MIN_SWAP_AMOUNT = 0.01; // Montant minimum augmenté
const MAX_SWAP_AMOUNT = 0.05; // Montant maximum réduit
const SLIPPAGE_TOLERANCE = 0.05; // Slippage augmenté à 5%
const MIN_BALANCE_FOR_SWAP = parse("0.01");
const PRICE_CHANGE_THRESHOLD = 0.01; // Seuil de changement de prix augmenté
const MAX_PRICE_CHANGE = 0.1; // Changement de prix maximum limité à 10%
const MIN_PROFIT_THRESHOLD = 0.005; // Seuil de profit minimum à 0.5%
const RSI_OVERSOLD = 20; // RSI moins agressif
const RSI_OVERBOUGHT = 80; // RSI moins agressif
const MIN_RSI_POINTS = 2; // Plus de points pour le RSI

// Configuration des logs
const fs = require('fs');
const logFile = `bot${BOT_ID}.log`;

// Statistiques de trading améliorées
let stats = {
    totalSwaps: 0,
    successfulSwaps: 0,
    failedSwaps: 0,
    totalProfit: 0,
    lastPrice: 0,
    highestPrice: 0,
    lowestPrice: Infinity,
    startBalance: 0,
    currentBalance: 0,
    gasCosts: 0,
    lastSwapTime: 0,
    profitHistory: [],
    hourlyProfit: 0,
    dailyProfit: 0
};

// Fonction de journalisation améliorée
function log(msg, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${msg}\n`;
    console.log(`[${BOT_ID}] ${msg}`);
    fs.appendFileSync(logFile, logMessage);
    
    // Envoi des alertes importantes sur Telegram
    if (type === 'error' || type === 'profit') {
        sendTelegram(`[${BOT_ID}] ${msg}`);
    }
}

// Fonctions utilitaires
function parse(x) {
  return ethers.parseEther(x.toString());
}

function format(x) {
  return Number(ethers.formatEther(x)).toFixed(4);
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sendTelegram(msg) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encodeURIComponent(msg)}`;
  https.get(url, () => {});
}

function getRandomSwapAmount() {
  return MIN_SWAP_AMOUNT + Math.random() * (MAX_SWAP_AMOUNT - MIN_SWAP_AMOUNT);
}

// Fonction de calcul du prix améliorée
async function getCurrentPrice() {
    try {
        const amounts = [0.01, 0.02, 0.05]; // Montants plus petits
        let totalPrice = 0;
        let validQuotes = 0;

        for (const amount of amounts) {
            try {
                const quote = await quoter.quoteExactInputSingle(
                    POL,
                    XIN,
                    3000,
                    parse(amount.toString()),
                    0
                );
                const price = parseFloat(format(quote)) / amount;
                if (price > 0 && price < 10) { // Filtre plus strict
                    totalPrice += price;
                    validQuotes++;
                }
            } catch (err) {
                log(`⚠️ Erreur de calcul du prix avec ${amount}: ${err.message}`);
            }
        }

        if (validQuotes === 0) {
            throw new Error("Aucun calcul de prix valide");
        }

        const averagePrice = totalPrice / validQuotes;
        
        // Vérification du dernier prix connu
        const lastPriceRef = await db.ref(`/xibot/bots/${BOT_ID}/lastPrice`).get();
        const lastPrice = lastPriceRef.val();
        
        if (lastPrice) {
            const priceChange = Math.abs(averagePrice - lastPrice) / lastPrice;
            if (priceChange > MAX_PRICE_CHANGE) {
                log(`⚠️ Changement de prix trop important détecté : ${lastPrice} → ${averagePrice} (${(priceChange * 100).toFixed(2)}%)`);
                return lastPrice; // Utiliser le dernier prix valide
            }
        }
        
        await db.ref(`/xibot/bots/${BOT_ID}/lastPrice`).set(averagePrice);
        return averagePrice;
    } catch (err) {
        log(`⚠️ Erreur lors du calcul du prix: ${err.message}`);
        return 0;
    }
}

// Fonction de calcul du profit améliorée
async function calculateProfit() {
    const currentBalance = await getBalance(POL);
    const profit = currentBalance - stats.startBalance;
    const profitPercentage = (profit / stats.startBalance) * 100;
    
    // Calcul du profit horaire et journalier
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    
    stats.profitHistory.push({
        timestamp: now,
        profit: profit,
        percentage: profitPercentage
    });
    
    // Filtrage des profits récents
    stats.hourlyProfit = stats.profitHistory
        .filter(p => p.timestamp > hourAgo)
        .reduce((sum, p) => sum + p.profit, 0);
    
    stats.dailyProfit = stats.profitHistory
        .filter(p => p.timestamp > dayAgo)
        .reduce((sum, p) => sum + p.profit, 0);
    
    return { 
        profit, 
        percentage: profitPercentage,
        hourly: stats.hourlyProfit,
        daily: stats.dailyProfit
    };
}

// Fonction de swap optimisée
async function swap(tokenIn, tokenOut, amountIn, label) {
    try {
        const startTime = Date.now();
        const startBalance = await getBalance(tokenIn);
        
        // Vérification de la balance avec marge de sécurité
        if (startBalance < amountIn * 1.05) { // 5% de marge
            log(`⛔ Swap annulé : balance insuffisante (${format(startBalance)} < ${format(amountIn)}) pour ${label}`, 'error');
            return false;
        }

        // Optimisation des paramètres de gas
        const feeData = await provider.getFeeData();
        const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');

        if (process.env.SIMULATION === "true") {
            log(`[SIMULATION] ${label} avec ${format(amountIn)}`);
            return;
        }

        log(`🔄 Début du swap ${label} avec ${format(amountIn)}`);

        // Vérification de l'approbation
        const allowance = await (tokenIn === POL ? pol : xin).allowance(wallet.address, ROUTER);
        if (allowance < amountIn) {
            log(`🔄 Approbation nécessaire pour ${label}`);
            const approveTx = await (tokenIn === POL ? pol : xin).approve(ROUTER, ethers.MaxUint256, {
                gasLimit: 100000,
                maxFeePerGas: ethers.parseUnits('30', 'gwei'),
                maxPriorityFeePerGas: ethers.parseUnits('1.5', 'gwei')
            });
            await approveTx.wait();
            log(`✅ Approbation confirmée pour ${label}`);
        }

        // Calcul du prix avec slippage
        const quote = await quoter.quoteExactInputSingle(
            tokenIn,
            tokenOut,
            3000,
            amountIn,
            0
        );

        if (quote <= 0n) {
            log(`⚠️ Swap annulé : estimation invalide (${format(quote)}) pour ${label}`);
            return false;
        }

        const minReceived = quote * BigInt(Math.floor((1 - SLIPPAGE_TOLERANCE) * 100)) / 100n;

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

        log(`📝 Exécution du swap ${label} avec gas: ${ethers.formatUnits(maxFeePerGas, 'gwei')}/${ethers.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei`);
        
        // Paramètres de gas optimisés
        const tx = await router.exactInputSingle(params, {
            gasLimit: 300000, // Réduit mais suffisant
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas
        });

        log(`⏳ Attente de la confirmation de la transaction...`);
        const receipt = await tx.wait();
        
        if (!receipt || !receipt.status) {
            throw new Error(`Transaction échouée ou non confirmée (status: ${receipt?.status})`);
        }

        const gasUsed = receipt.gasUsed;
        const gasCost = gasUsed * receipt.gasPrice;
        const gasCostInMatic = ethers.formatEther(gasCost);

        log(`✅ Transaction confirmée : ${receipt.hash}`);
        log(`💰 Coût en gas : ${gasCostInMatic} MATIC (${gasUsed} gas utilisé)`);
        
        // Mise à jour des statistiques
        const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
        const stats = (await statsRef.get()).val() || {};
        await statsRef.child("successfulTrades").set((stats.successfulTrades || 0) + 1);
        await statsRef.child("totalGasCost").set((stats.totalGasCost || 0) + parseFloat(gasCostInMatic));
        
        const endTime = Date.now();
        const endBalance = await getBalance(tokenIn);
        const profit = endBalance - startBalance;
        
        stats.totalSwaps++;
        stats.successfulSwaps++;
        stats.totalProfit += profit;
        stats.lastSwapTime = endTime;
        
        const { profit: totalProfit, percentage: profitPercentage, hourly, daily } = await calculateProfit();
        
        log(`💰 Swap réussi: ${label}`, 'profit');
        log(`⏱️ Durée: ${(endTime - startTime) / 1000}s`);
        log(`📊 Profit immédiat: ${profit.toFixed(4)} ${tokenIn === XIN ? 'XIN' : 'POL'}`);
        log(`📈 Profit total: ${totalProfit.toFixed(4)} POL (${profitPercentage.toFixed(2)}%)`);
        log(`📊 Profit horaire: ${hourly.toFixed(4)} POL`);
        log(`📊 Profit journalier: ${daily.toFixed(4)} POL`);
        log(`📊 Prix actuel: ${currentPrice}`);
        log(`📊 Statistiques: ${JSON.stringify(stats, null, 2)}`);
        
        if (label.includes("POL → XIN")) {
            await updateStats("polUsed", amountIn);
            await updateStats("xinBought", amountIn);
        } else {
            await updateStats("xinSold", amountIn);
            await updateStats("polGained", amountIn);
        }

        return true;
    } catch (err) {
        const statsRef = db.ref(`/xibot/bots/${BOT_ID}/stats`);
        const stats = (await statsRef.get()).val() || {};
        await statsRef.child("failedTrades").set((stats.failedTrades || 0) + 1);
        
        log(`❌ Erreur de swap (${label}): ${err.message}`, 'error');
        console.error(err);
        return false;
    }
}

// Fonction de mise à jour des statistiques
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

// Configuration du serveur HTTP
const PORT = process.env.PORT || (BOT_ID === "bot1" ? 3000 : 3001);
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'running',
        botId: BOT_ID,
        lastUpdate: new Date().toISOString(),
        stats: stats
    }));
});

// Fonction de redémarrage automatique
async function restartBot() {
    try {
        log('🔄 Redémarrage du bot...');
        await loop();
    } catch (error) {
        log(`❌ Erreur critique: ${error.message}`, 'error');
        // Attendre 30 secondes avant de redémarrer
        await delay(30000);
        restartBot();
    }
}

// Fonction de boucle principale optimisée
async function loop() {
    try {
        // Initialisation des statistiques
        stats.startBalance = await getBalance(POL);
        log(`🚀 Démarrage du bot avec balance initiale: ${format(stats.startBalance)} POL`);
        
        while (true) {
            try {
                const currentPrice = await getCurrentPrice();
                
                // Mise à jour des statistiques de prix
                if (currentPrice > stats.highestPrice) stats.highestPrice = currentPrice;
                if (currentPrice < stats.lowestPrice) stats.lowestPrice = currentPrice;
                
                const { profit: totalProfit, percentage: profitPercentage, hourly, daily } = await calculateProfit();
                
                // Affichage des statistiques
                log(`📊 État actuel:`);
                log(`• Prix: ${currentPrice}`);
                log(`• Prix le plus haut: ${stats.highestPrice}`);
                log(`• Prix le plus bas: ${stats.lowestPrice}`);
                log(`• Profit total: ${totalProfit.toFixed(4)} POL (${profitPercentage.toFixed(2)}%)`);
                log(`• Profit horaire: ${hourly.toFixed(4)} POL`);
                log(`• Profit journalier: ${daily.toFixed(4)} POL`);
                log(`• Swaps réussis: ${stats.successfulSwaps}/${stats.totalSwaps}`);
                log(`• Dernier swap: ${stats.lastSwapTime ? new Date(stats.lastSwapTime).toISOString() : 'Jamais'}`);
                
                // Stratégie de trading
                if (currentPrice > 0) {
                    const lastPriceRef = await db.ref(`/xibot/bots/${BOT_ID}/lastPrice`).get();
                    const lastPrice = lastPriceRef.val();
                    
                    if (lastPrice) {
                        const priceChange = (currentPrice - lastPrice) / lastPrice;
                        
                        // Conditions d'achat
                        if (priceChange < -PRICE_CHANGE_THRESHOLD) {
                            const swapAmount = Math.min(
                                await getBalance(POL),
                                parse(MAX_SWAP_AMOUNT.toString())
                            );
                            if (swapAmount >= MIN_BALANCE_FOR_SWAP) {
                                await swap(POL, XIN, swapAmount, "POL → XIN (Opportunité d'achat)");
                            }
                        }
                        // Conditions de vente
                        else if (priceChange > PRICE_CHANGE_THRESHOLD) {
                            const swapAmount = Math.min(
                                await getBalance(XIN),
                                parse(MAX_SWAP_AMOUNT.toString())
                            );
                            if (swapAmount >= MIN_BALANCE_FOR_SWAP) {
                                await swap(XIN, POL, swapAmount, "XIN → POL (Opportunité de vente)");
                            }
                        }
                    }
                }
                
                await delay(SWAP_INTERVAL);
            } catch (error) {
                log(`❌ Erreur dans la boucle: ${error.message}`, 'error');
                await delay(1000);
            }
        }
    } catch (error) {
        log(`❌ Erreur critique dans la boucle principale: ${error.message}`, 'error');
        throw error;
    }
}

// Démarrage du serveur et du bot
server.listen(PORT, () => {
    log(`🌐 Serveur démarré sur le port ${PORT}`);
    restartBot();
});

// Gestion des erreurs non capturées
process.on('uncaughtException', async (error) => {
    log(`❌ Erreur non capturée: ${error.message}`, 'error');
    await delay(30000);
    restartBot();
});

process.on('unhandledRejection', async (error) => {
    log(`❌ Rejet non géré: ${error.message}`, 'error');
    await delay(30000);
    restartBot();
}); 