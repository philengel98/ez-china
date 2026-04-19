import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.philengel.translationapp',
  appName: 'Ez China',
  webDir: 'dist',
  ios: {
    useSwiftPackageManager: true
  }
};

export default config;
