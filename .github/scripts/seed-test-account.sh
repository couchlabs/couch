#!/bin/bash
set -e

# Seed Test Account Script
# Seeds a test merchant account in D1 database for preview/staging environments
# Usage: seed-test-account.sh

if [ -z "$DATABASE_ID" ] || [ -z "$TEST_COUCH_ACCOUNT_ADDRESS" ] || [ -z "$TEST_COUCH_ACCOUNT_APIKEY" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "Error: Required environment variables not set"
    echo "Required: DATABASE_ID, TEST_COUCH_ACCOUNT_ADDRESS, TEST_COUCH_ACCOUNT_APIKEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID"
    exit 1
fi

echo "🌱 Seeding test account in database $DATABASE_ID"
echo "   Account: $TEST_COUCH_ACCOUNT_ADDRESS"

# Extract secret part from API key and hash it
# API key format: ck_testnet_<secret> or ck_mainnet_<secret>
SECRET_PART=$(echo "$TEST_COUCH_ACCOUNT_APIKEY" | sed -E 's/^ck_[^_]+_//')

# Generate SHA-256 hash of the secret part
KEY_HASH=$(echo -n "$SECRET_PART" | shasum -a 256 | awk '{print $1}')

# Upsert account and API key using D1 API
# Using INSERT OR REPLACE for idempotency
SQL="INSERT OR REPLACE INTO accounts (address) VALUES ('$TEST_COUCH_ACCOUNT_ADDRESS'); INSERT OR REPLACE INTO api_keys (key_hash, account_address) VALUES ('$KEY_HASH', '$TEST_COUCH_ACCOUNT_ADDRESS');"

# Execute SQL using wrangler d1 execute with --command flag
bunx wrangler d1 execute "$DATABASE_ID" --remote --command="$SQL"

echo "✅ Test account seeded successfully"
