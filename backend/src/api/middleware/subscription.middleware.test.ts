import { describe, expect, it } from "bun:test"
import { Hono } from "hono"
import type { Address, Hash } from "viem"
import { ErrorCode } from "@/errors/http.errors"
import { Provider } from "@/providers/provider.interface"
import { subscriptionBody } from "./subscription.middleware"

describe("subscriptionBody middleware", () => {
  const app = new Hono()

  // Test endpoint that uses the middleware
  app.post("/test", subscriptionBody(), (c) => {
    const subscription = c.get("subscription")
    return c.json(subscription)
  })

  it("validates and parses required fields (id, provider) with testnet defaulting to false", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234" as Hash,
        provider: Provider.BASE,
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subscriptionId: "0x1234",
      provider: Provider.BASE,
      testnet: false,
    })
  })

  it("accepts optional beneficiary parameter", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234" as Hash,
        provider: Provider.BASE,
        beneficiary: "0xabcd1234567890123456789012345678abcd1234" as Address,
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subscriptionId: "0x1234",
      provider: Provider.BASE,
      testnet: false,
      beneficiary: "0xabcd1234567890123456789012345678abcd1234",
    })
  })

  it("accepts testnet: true for testnet subscriptions", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234" as Hash,
        provider: Provider.BASE,
        testnet: true,
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subscriptionId: "0x1234",
      provider: Provider.BASE,
      testnet: true,
    })
  })

  it("accepts testnet: false for mainnet subscriptions", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234" as Hash,
        provider: Provider.BASE,
        testnet: false,
      }),
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      subscriptionId: "0x1234",
      provider: Provider.BASE,
      testnet: false,
    })
  })

  it("omits beneficiary when not provided", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234" as Hash,
        provider: Provider.BASE,
      }),
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as { beneficiary?: string }
    expect(data.beneficiary).toBeUndefined()
  })

  it("throws error for missing id", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: Provider.BASE,
      }),
    })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string; error: string }
    expect(data.code).toBe(ErrorCode.MISSING_FIELD)
    expect(data.error).toContain("id")
  })

  it("throws error for missing provider", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234",
      }),
    })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string; error: string }
    expect(data.code).toBe(ErrorCode.MISSING_FIELD)
    expect(data.error).toContain("provider")
  })

  it("throws error for invalid provider", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234",
        provider: "INVALID_PROVIDER",
      }),
    })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string; error: string }
    expect(data.code).toBe(ErrorCode.INVALID_FORMAT)
    expect(data.error).toContain("Invalid provider")
  })

  it("throws error for invalid beneficiary address format", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234",
        provider: Provider.BASE,
        beneficiary: "not-a-valid-address",
      }),
    })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string; error: string }
    expect(data.code).toBe(ErrorCode.INVALID_FORMAT)
    expect(data.error).toContain("Invalid beneficiary address")
  })

  it("throws error for invalid testnet type", async () => {
    const response = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "0x1234",
        provider: Provider.BASE,
        testnet: "not-a-boolean",
      }),
    })

    expect(response.status).toBe(400)
    const data = (await response.json()) as { code: string; error: string }
    expect(data.code).toBe(ErrorCode.INVALID_FORMAT)
    expect(data.error).toContain("testnet must be a boolean")
  })
})
