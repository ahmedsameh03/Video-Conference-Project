// worker-src/e2ee-bundler.js
import { aes256gcmSiv } from "@noble/ciphers/webcrypto";

self.NobleCiphers = {
  aes256gcmSiv,
};
