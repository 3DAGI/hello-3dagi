# Solana Seeker Build — APK + On-Chain Records

The game ships as an Android APK (Capacitor wrapper, `android/`) with Solana
integration via the **Mobile Wallet Adapter (MWA)** — the native wallet flow used
on the Solana Seeker and Saga phones.

## What's on-chain

- Connect the phone's Solana wallet from the **WALLET** menu (MWA `authorize`).
- Post your best quarter-mile times as **Memo-program transactions**
  (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`), signed by the player's wallet:
  - from the WALLET screen ("POST BEST TIME ON-CHAIN"), or
  - directly from the results screen after a new best ("SAVE RECORD ON-CHAIN").
- Record format (JSON in the memo):
  `{"g":"PIXEL-DRAG-RACER","v":1,"kind":"race","car":"jdm","et":11.842,"trap":214,"vs":"GHOST","career":12}`
- Network defaults to **devnet** (`CLUSTER` in `src/solana.js`). Switch to
  `mainnet-beta` + a production RPC for the store release.

On iOS and desktop the wallet features hide automatically (MWA is Android-only).

## Building the APK

Prerequisites: JDK 17+, Android SDK (platform 35 + build-tools). Then:

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
```

Install on a device with `adb install app-debug.apk`.

### Release build (required for the dApp Store)

1. Create a keystore (once, keep it safe — losing it means losing update rights):
   ```bash
   keytool -genkey -v -keystore pdr-release.keystore -alias pdr \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Build and sign:
   ```bash
   cd android && ./gradlew assembleRelease
   /opt/android-sdk/build-tools/35.0.0/zipalign -p 4 \
     app/build/outputs/apk/release/app-release-unsigned.apk app-release-aligned.apk
   /opt/android-sdk/build-tools/35.0.0/apksigner sign --ks pdr-release.keystore \
     --ks-key-alias pdr --out pixel-drag-racer.apk app-release-aligned.apk
   ```

## Publishing to the Solana dApp Store (Seeker)

The Seeker dApp Store is Solana Mobile's own store — publishing mints NFTs that
represent the app, its releases, and the publisher.

1. Install the CLI:
   ```bash
   npm i -g @solana-mobile/dapp-store-cli
   ```
2. In a publishing directory: `dapp-store init` and fill `config.yaml`
   (app name, description, icon 512x512, screenshots, APK path, publisher details).
3. Create the publisher + app + release NFTs (needs a funded mainnet keypair,
   a few $ worth of SOL):
   ```bash
   dapp-store create publisher -k publisher-keypair.json
   dapp-store create app -k publisher-keypair.json
   dapp-store create release -k publisher-keypair.json
   ```
4. Submit for review:
   ```bash
   dapp-store publish submit -k publisher-keypair.json --requestor-is-authorized \
     --complies-with-solana-dapp-store-policies
   ```
5. Solana Mobile reviews the submission; once approved the game appears in the
   dApp Store on Seeker devices.

Full docs: https://docs.solanamobile.com/dapp-publishing/intro

## Testing MWA

MWA needs a real Android device (or the Seeker) with an MWA-compatible wallet
installed (Phantom, Solflare, or the Seeker's built-in wallet). On devnet, fund
the wallet with `solana airdrop 1 <address> -u devnet` so it can pay the memo
transaction fee. The wallet sheet should open when tapping CONNECT WALLET; the
signed transaction lands on devnet and is visible in any explorer.

## Roadmap ideas for "more on-chain"

- Anchor program with a PDA leaderboard (top times per car, verifiable ranking)
- cNFT trophies for career bosses
- SPL token rewards instead of in-game cash
