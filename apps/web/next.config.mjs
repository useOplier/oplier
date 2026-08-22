/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // No remote images used — hero/wordmark/favicon are local static assets.
    formats: ["image/webp"],
    // wordmark.svg is served through next/image (for width/height + priority
    // loading) — Next disables SVG optimization by default for security, so
    // this needs to be opted into explicitly for that image to render.
    dangerouslyAllowSVG: true,
    contentDispositionType: "inline",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // ---------------------------------------------------------------------
  // @coinbase/cdp-sdk optional x402 submodules — not a project dependency.
  //
  // Dependency chain (per the pnpm store path in the build error):
  //   @rainbow-me/rainbowkit -> wallets/coinbaseWallet.ts -> @coinbase/wallet-sdk
  //   -> (recent wallet-sdk versions bundle Smart Wallet / spend-permission
  //      support via) @coinbase/cdp-sdk
  // even though this app's own wagmi config (`src/lib/wagmi.ts`) never
  // imports `coinbaseWallet` from '@rainbow-me/rainbowkit/wallets' — only
  // okxWallet/metaMaskWallet/rainbowWallet/walletConnectWallet are used.
  // RainbowKit's `wallets` entrypoint is a single barrel file, so webpack's
  // static module graph still walks into coinbaseWallet's connector code
  // (and from there into wallet-sdk -> cdp-sdk) even though nothing in this
  // codebase ever calls it at runtime.
  //
  // The actual failure is inside cdp-sdk's `signX402Payment.js`, which does
  // `import("@x402/core/client")` / `import("@x402/evm/exact/client")` /
  // `import("@x402/evm/upto/client")` to *optionally* support x402 payments
  // — those three packages are meant to be installed only by consumers who
  // actually use cdp-sdk's x402 payment flow (see @coinbase/cdp-sdk's own
  // docs: x402 support is opt-in, not a hard dependency). Next's webpack
  // build tries to statically resolve every `import()` target regardless of
  // whether the branch that calls it is ever reached, so it fails at build
  // time on a code path this app never executes.
  //
  // This app doesn't use CDP, x402, or Coinbase Wallet at all, so the
  // correct fix is to tell webpack these three specifiers resolve to an
  // empty module rather than to install packages this project has no use
  // for — the same pattern Next's own docs recommend for optional
  // native/runtime-only deps pulled in by other SDKs (e.g. `pg-native`,
  // `bufferutil`): https://nextjs.org/docs/messages/module-not-found
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@x402\//,
      })
    );

    // ---------------------------------------------------------------------
    // @react-native-async-storage/async-storage — same class of problem as the
    // @x402 block above, different SDK.
    //
    // Chain: @rainbow-me/rainbowkit -> wagmi/connectors metaMask -> @metamask/sdk,
    // which imports async-storage to persist session state ON REACT NATIVE. In a
    // browser build that code path is never taken (the SDK branches on platform),
    // but webpack still resolves the specifier statically and fails.
    //
    // Left unhandled it logs `Module not found: Can't resolve
    // '@react-native-async-storage/async-storage'` on every compile — observed
    // firing repeatedly during dev and re-triggering Fast Refresh rebuilds, which
    // remount the React tree. That matters beyond noise: a remount mid-SIWE
    // discards the pending `signMessage` promise, which presents as the sign-in
    // sitting on "Signing in…" forever after `POST /auth/nonce` has already
    // returned 200 and no `/auth/verify` ever follows.
    //
    // This is a browser-only app and never runs under React Native, so resolving
    // the specifier to nothing is correct — installing a React Native storage
    // package here would not be.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@react-native-async-storage\/async-storage$/,
      })
    );

    // ---------------------------------------------------------------------
    // pino-pretty — same class of problem as the two blocks above.
    //
    // Chain: @rainbow-me/rainbowkit -> wagmi -> @walletconnect/universal-provider
    // -> @walletconnect/logger -> pino. pino loads `pino-pretty` as an OPTIONAL
    // runtime transport (a dev-only log beautifier) via a bare require inside
    // lib/tools.js; pino does not declare it as a dependency, so under pnpm's
    // strict layout webpack cannot statically resolve the specifier and the
    // production build fails with "Module not found: Can't resolve
    // 'pino-pretty'" (observed on Vercel, build EDhVEPxEA). The browser bundle
    // never pretty-prints logs, so resolving the specifier to nothing is
    // correct — installing pino-pretty here would ship dead weight.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^pino-pretty$/,
      })
    );

    return config;
  },
};

export default nextConfig;
