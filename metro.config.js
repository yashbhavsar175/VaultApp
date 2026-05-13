const { getDefaultConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

// Packages that ship raw TypeScript as their "react-native" entry point.
// Metro prioritises that field over "main", then fails because it won't
// transpile TS inside node_modules. We intercept resolution and redirect
// to the pre-compiled CommonJS output.
const SVG_COMMONJS = path.resolve(
  __dirname,
  'node_modules/react-native-svg/lib/commonjs/index.js'
);

defaultConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-svg') {
    return { filePath: SVG_COMMONJS, type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = defaultConfig;
