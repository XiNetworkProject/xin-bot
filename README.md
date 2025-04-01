# 📈 XiBot v12 - Bot de Trading XIN/POL

Bot de trading automatisé pour la paire XIN/POL sur Polygon, utilisant une stratégie intelligente basée sur le RSI et la gestion de liquidité.

## Fonctionnalités

- 🤖 Trading automatisé XIN/POL
- 📊 Analyse technique avec RSI
- 💧 Gestion automatique de la liquidité
- 🔄 Coordination multi-bots
- 📈 Rapports détaillés via Telegram
- 🛡️ Gestion des risques avec stop-loss et take-profit
- 📱 Surveillance en temps réel

## Configuration

1. Cloner le dépôt
```bash
git clone [url-du-repo]
cd xin-bot
```

2. Installer les dépendances
```bash
npm install
```

3. Configurer les variables d'environnement
- Copier `.env.example` vers `.env.bot1` et `.env.bot2`
- Remplir les variables requises dans chaque fichier

## Variables d'Environnement Requises

### Configuration de Base
- `POLYGON_URL` : URL du RPC Polygon
- `PRIVATE_KEY` : Clé privée du wallet de trading
- `BOT_ID` : Identifiant unique du bot (bot1, bot2, etc.)

### Adresses des Contrats
- `XIN_TOKEN` : Adresse du token XIN
- `POL_TOKEN` : Adresse du token POL
- `ROUTER` : Adresse du router Uniswap V3
- `QUOTER` : Adresse du quoter Uniswap V3
- `POOL_ADDRESS` : Adresse de la pool de liquidité

### Configuration Telegram
- `TELEGRAM_TOKEN` : Token du bot Telegram
- `TELEGRAM_CHAT_ID` : ID du chat pour les notifications

### Wallet de Liquidité
- `LIQUIDITY_WALLET` : Adresse du wallet de liquidité
- `LIQUIDITY_PRIVATE_KEY` : Clé privée du wallet de liquidité

## Lancement

Pour lancer un bot spécifique :
```bash
node bot-v12.js .env.bot1  # Pour le bot 1
node bot-v12.js .env.bot2  # Pour le bot 2
```

## Sécurité

⚠️ Ne jamais commiter les fichiers `.env` contenant vos clés privées
⚠️ Garder vos clés privées et tokens en sécurité
⚠️ Utiliser des wallets dédiés pour le trading

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

