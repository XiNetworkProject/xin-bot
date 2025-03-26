# 🤖 Xi Network Pool Bot

Bot automatique pour créer du mouvement sur la pool POL/XIN de Uniswap V3 (Polygon).
Simule de l'activité d'achat/vente pour booster la visibilité et générer de la liquidité apparente.

## Fonctionnalités

- Swaps aléatoires entre 1 à 5 WMATIC
- Alternance entre achat (POL → XIN) et vente (XIN → POL)
- Réutilisation des tokens pour simuler un vrai marché
- Approve automatique des tokens
- Hébergeable gratuitement sur Render.com (Web Service)

## Fichiers

- `bot.js` : script principal
- `.env` : config privée (à ne jamais push sur GitHub)
- `package.json` : configuration NPM
- `.gitignore` : ignore `.env` et `node_modules`

## Lancement local

1. Créer un fichier `.env` :

```
PRIVATE_KEY=0x...
POLYGON_URL=https://polygon-mainnet.infura.io/v3/TON_INFURA_KEY
XIN_TOKEN=0x83F7bAf09ab44A6c4Ffe8eB610547435E3f123d9
POL_TOKEN=0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270
```

2. Installer et lancer :

```
npm install
npm start
```

## Déploiement Render (Web Service)

- Build Command : `npm install`
- Start Command : `npm start`
- Instance Type : Free
- Ajouter variables d'environnement depuis `.env`
