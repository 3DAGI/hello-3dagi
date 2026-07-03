# iOS Build & TestFlight Guide — Pixel Drag Racer

The game is a web-based (HTML5 canvas) app wrapped with [Capacitor](https://capacitorjs.com).
The native Xcode project already lives in `ios/` — you only need a Mac with Xcode to build it.

## Prerequisites (on your Mac)

- Xcode 15+ (App Store)
- Node.js 18+
- CocoaPods: `sudo gem install cocoapods`
- An Apple Developer account (needed for TestFlight)

## Build steps

```bash
git clone <this repo> && cd hello-3dagi
npm install
npm run build          # builds the web app into dist/
npx cap sync ios       # copies dist/ into the iOS project + pod install
npx cap open ios       # opens ios/App/App.xcworkspace in Xcode
```

(`npm run ios` does all three in one go.)

## In Xcode

1. Select the **App** target → *Signing & Capabilities* → pick your **Team** and set a unique bundle id if needed (default: `io.threedagi.pixeldrag`).
2. Select *Any iOS Device (arm64)* as the destination.
3. **Product → Archive**.
4. In the Organizer window: **Distribute App → TestFlight & App Store → Upload**.
5. On [App Store Connect](https://appstoreconnect.apple.com): create the app entry (same bundle id), wait for the build to process, then add yourself as an internal TestFlight tester.
6. Install via the TestFlight app on your iPhone.

## Iterating

After changing game code:

```bash
npm run build && npx cap sync ios
```

then just hit **Run** (▶) in Xcode — for quick device testing you don't need a new
archive, only for new TestFlight builds.

## Later: Android / Solana Seeker

The same web build wraps into an APK with:

```bash
npm i @capacitor/android
npx cap add android
npx cap sync android
```

For the Solana Seeker dApp Store version we'll add Solana Mobile Wallet Adapter
integration (on-chain race results / token rewards) on top of the same codebase —
no game-code rewrite needed.
