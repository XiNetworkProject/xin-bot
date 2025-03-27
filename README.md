# 📈 XiBot v10 - Uniswap V3 Trading Bot avec Liquidité et Telegram

XiBot est un bot intelligent de gestion de swaps, d'ajout/retrait de liquidité sur Uniswap V3, optimisé pour augmenter la valeur du token $XIN et générer des profits, avec reporting automatique sur Telegram.

---

## ✅ Fonctionnalités Principales

- 🤖 **Swaps dynamiques** : POL → XIN et XIN → POL selon le comportement de la pool
- 💧 **Ajout / Retrait réel de liquidité Uniswap V3** via le contrat officiel `NonfungiblePositionManager`
- 📊 **Statistiques de performance** (PNL net) envoyées sur Telegram toutes les heures
- 🧠 **Stratégie pilotée par le comportement LP / prix**
- 🧪 **Analyse de volatilité** (tick delta & volume)
- 📡 **Watchdog** : redémarre automatiquement si le bot est inactif pendant 20min
- 📈 **Graphique horaire** : PNL net (POL) généré en image via `chartjs-node-canvas`
- 📣 **Alertes Telegram** : swap extérieur suspect détecté

---

## 🔧 Configuration `.env`

```env
POLYGON_URL=...         # URL de ton noeud RPC
PRIVATE_KEY=...         # Clé privée du wallet
XIN_TOKEN=0x...
POL_TOKEN=0x...
POOL_ADDRESS=0x...
TELEGRAM_TOKEN=...      # Token Bot Telegram
TELEGRAM_CHAT_ID=...    # Chat ID Telegram
PORT=3000               # Port HTTP facultatif
```

---

## 🚀 Lancer le bot
```bash
npm install --legacy-peer-deps
npm start
```

Le bot tourne 24h/24 et exécute automatiquement les cycles de swap, injection de liquidité, analyse de profit, et résumé Telegram.

---

## 🧠 Objectif
XiBot vise à maintenir un volume stable et croissant sur la pool POL/XIN, augmenter la valeur du $XIN par des micro-pump, et générer des bénéfices en ajoutant et retirant stratégiquement la liquidité en fonction de la tendance du marché.

> Conçu pour être **entièrement autonome**, **résilient** et **réactif** à l'activité extérieure de la pool.

