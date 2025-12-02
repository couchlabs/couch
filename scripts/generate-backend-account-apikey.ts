#!/usr/bin/env bun

/**
 * Generate Backend Account API Key Script
 *
 * Generates a new Couch backend account API key in the format: ck_<32-char-hex>
 * This script also displays the hash that will be stored in the database
 *
 * Usage:
 *   bun scripts/generate-backend-account-apikey.ts
 *
 * Output:
 *   - API Key: Use this for COUCH_TEST_ACCOUNT_APIKEY secret in GitHub
 *   - Key Hash: For reference (not needed in secrets, just for debugging)
 */

import { createHash, randomBytes } from "node:crypto"

console.log("🔑 Generating new Couch backend account API key...\n")

// Generate random 32-character hex string (same as account.service.ts)
const secretPart = randomBytes(16).toString("hex")

// Construct API key with ck_ prefix
const apiKey = `ck_${secretPart}`

// Generate SHA-256 hash of the secret part (what gets stored in DB)
const keyHash = createHash("sha256").update(secretPart).digest("hex")

console.log("✅ Generated API Key:\n")
console.log(`API_KEY:  ${apiKey}`)
console.log(`KEY_HASH: ${keyHash}\n`)
console.log("📋 Instructions:")
console.log("1. Copy the API_KEY above")
console.log(
  "2. Update the GitHub secret COUCH_TEST_ACCOUNT_APIKEY with this value",
)
console.log(
  "3. The seed script will automatically hash it when seeding the database\n",
)
