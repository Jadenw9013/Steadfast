## 2025-02-25 - Replace Math.random with Web Crypto API for Access Codes
**Vulnerability:** The `generateCoachCode` function in `lib/auth/roles.ts` used `Math.random()` to generate the coach connection code. `Math.random()` is not a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) and should never be used for security purposes like access codes, authorization tokens, or passwords, as its output can be predicted.
**Learning:** `Math.random()` was easily accessible but introduced a weakness in the coach-client connection process.
**Prevention:** Always use `crypto.getRandomValues()` or a similarly robust CSPRNG for generating any form of secure code or token. In Next.js environments, the Web Crypto API is natively available.
## 2025-02-25 - Replace Math.random with Web Crypto API for Request IDs
**Vulnerability:** The `submitCoachingRequest` function in `app/actions/coaching-requests.ts` used `Math.random()` to generate the coaching request ID. `Math.random()` is not a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) and should never be used for security-sensitive purposes like unique ID generation, as its output can be predicted.
**Learning:** `Math.random()` was easily accessible but introduced a weakness in the request ID generation process.
**Prevention:** Always use `crypto.randomUUID()` or a similarly robust CSPRNG for generating any form of secure ID. When ensuring compatibility with Zod's `.cuid()` validation, format the CSPRNG output to match the expected format (e.g., starting with 'c' and maintaining a length of 25 characters).
