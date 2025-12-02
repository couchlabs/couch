#!/bin/bash
set -e

# Seed Test Account Script
# Seeds a test merchant account in D1 database for preview/staging environments
# This script is idempotent - safe to run multiple times
# Usage: seed-test-account.sh

if [ -z "$DATABASE_NAME" ] || [ -z "$COUCH_TEST_ACCOUNT_ADDRESS" ] || [ -z "$COUCH_TEST_ACCOUNT_APIKEY" ] || [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo "Error: Required environment variables not set"
    echo "Required: DATABASE_NAME, COUCH_TEST_ACCOUNT_ADDRESS, COUCH_TEST_ACCOUNT_APIKEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID"
    exit 1
fi

echo "🌱 Seeding test account in database $DATABASE_NAME"
echo "   Account: $COUCH_TEST_ACCOUNT_ADDRESS"

# Extract secret part from API key and hash it
# API key format: ck_<secret>
SECRET_PART=$(echo "$COUCH_TEST_ACCOUNT_APIKEY" | sed -E 's/^ck_//')

# Generate SHA-256 hash of the secret part
KEY_HASH=$(echo -n "$SECRET_PART" | shasum -a 256 | awk '{print $1}')

# Seed account and API key using D1 API
# Note: Uses account_id (integer FK) instead of account_address (removed in schema migration)
# INSERT OR IGNORE for account (don't overwrite existing)
# INSERT OR REPLACE for API key (allow key rotation)
SQL="
INSERT OR IGNORE INTO accounts (address)
VALUES ('$COUCH_TEST_ACCOUNT_ADDRESS');

INSERT OR REPLACE INTO api_keys (key_hash, account_id)
SELECT '$KEY_HASH', id FROM accounts WHERE address = '$COUCH_TEST_ACCOUNT_ADDRESS';
"

# Execute SQL using wrangler d1 execute with --command flag
bunx wrangler d1 execute "$DATABASE_NAME" --remote --command="$SQL"

echo "✅ Test account seeded successfully"
echo "   Note: CDP wallet 'merchant-1' must exist for this account"
echo "   Subscription owner address should be configured in secrets"
