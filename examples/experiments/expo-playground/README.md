# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

# FIXES
3 fixes were required as of current to get things working with RN

1. we use uuid.v4, which requires use of crypto get-random-values which does not work by default in react native.
Add the polyfill `react-native-get-random-values` (install it with npm, import it before you import `@ag-ui/client`)

2. We use bufbuild, and the way we are building right now causes react native to not find it because it ends up in a package exported location. We have to enable package export resolution in metro (along with symlinks, depending on your package manager).

Add the following to metro.config.js
```
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;
```

3. We use streaming responses with fetch. The `expo/fetch` package supports this, the default react native fetch does not. We simply patch the already-built module to replace `fetch(...` with `require("expo/fetch").fetch(...` using a postinstall script.
This _does_ break sourcemaps unfortunately. A better solution for this needs to be whipped up but should not be a big lift.
