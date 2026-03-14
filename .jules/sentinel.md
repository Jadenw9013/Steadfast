## 2025-02-25 - Replace Math.random with Web Crypto API for Access Codes
**Vulnerability:** The `generateCoachCode` function in `lib/auth/roles.ts` used `Math.random()` to generate the coach connection code. `Math.random()` is not a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) and should never be used for security purposes like access codes, authorization tokens, or passwords, as its output can be predicted.
**Learning:** `Math.random()` was easily accessible but introduced a weakness in the coach-client connection process.
**Prevention:** Always use `crypto.getRandomValues()` or a similarly robust CSPRNG for generating any form of secure code or token. In Next.js environments, the Web Crypto API is natively available.
