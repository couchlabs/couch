#!/usr/bin/env bun
/**
 * Development Environment Cleanup Script
 *
 * Cleans up local Alchemy development state:
 * - Removes all Durable Object instances (order schedulers)
 * - Truncates database tables (subscriptions, orders, transactions)
 *
 * Usage: bun scripts/alchemy.dev.cleanup.ts
 */

import { Database } from "bun:sqlite"
import fs from "node:fs"
import path from "node:path"

const ALCHEMY_DIR = path.join(import.meta.dirname, "..", ".alchemy")
const MINIFLARE_DIR = path.join(ALCHEMY_DIR, "miniflare", "v3")

// =============================================================================
// Durable Objects Cleanup
// =============================================================================

function cleanupDurableObjects() {
  const doDir = path.join(MINIFLARE_DIR, "do")

  if (!fs.existsSync(doDir)) {
    console.log("⏭️  No Durable Objects directory found")
    return
  }

  const dirs = fs.readdirSync(doDir)
  let cleaned = 0

  for (const dir of dirs) {
    const fullPath = path.join(doDir, dir)
    if (fs.statSync(fullPath).isDirectory()) {
      console.log(`🗑️  Removing Durable Object: ${dir}`)
      fs.rmSync(fullPath, { recursive: true, force: true })
      cleaned++
    }
  }

  console.log(`✅ Cleaned ${cleaned} Durable Object namespace(s)\n`)
}

// =============================================================================
// Database Cleanup
// =============================================================================

function cleanupDatabase() {
  const d1Dir = path.join(MINIFLARE_DIR, "d1", "miniflare-D1DatabaseObject")

  if (!fs.existsSync(d1Dir)) {
    console.log("⏭️  No D1 database directory found")
    return
  }

  const files = fs.readdirSync(d1Dir)
  const dbFiles = files.filter((f) => f.endsWith(".sqlite") && !f.includes("-"))

  if (dbFiles.length === 0) {
    console.log("⏭️  No database files found")
    return
  }

  for (const dbFile of dbFiles) {
    const dbPath = path.join(d1Dir, dbFile)
    console.log(`🗄️  Cleaning database: ${dbFile}`)

    try {
      const db = new Database(dbPath)

      // Tables to truncate (in order to respect foreign key constraints)
      // Only clean subscription-related data, keep account setup (webhooks, api_keys, accounts)
      const tables = ["transactions", "orders", "subscriptions"]

      for (const table of tables) {
        try {
          const result = db.prepare(`DELETE FROM ${table}`).run()
          if (result.changes > 0) {
            console.log(`   ✓ Truncated ${table} (${result.changes} rows)`)
          }
        } catch (error) {
          // Table might not exist, skip silently
          if (
            error instanceof Error &&
            !error.message.includes("no such table")
          ) {
            console.log(`   ⚠️  Error truncating ${table}: ${error.message}`)
          }
        }
      }

      // Reset autoincrement counters
      db.prepare("DELETE FROM sqlite_sequence").run()

      db.close()
      console.log(`✅ Database cleaned\n`)
    } catch (error) {
      console.error(`❌ Error cleaning database: ${error}`)
    }
  }
}

// =============================================================================
// Main
// =============================================================================

console.log("🧹 Starting Alchemy development cleanup...\n")

cleanupDurableObjects()
cleanupDatabase()

console.log("✨ Cleanup complete!")
