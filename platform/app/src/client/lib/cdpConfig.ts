import type { Config } from "@coinbase/cdp-react"

const appName = import.meta.env.VITE_COUCH_PUBLIC_APP_NAME
const projectId = import.meta.env.VITE_CDP_PROJECT_ID
if (!appName) throw new Error("VITE_COUCH_PUBLIC_APP_NAME not set")
if (!projectId) throw new Error("VITE_CDP_PROJECT_ID not set")

export const cdpConfig: Config = {
  projectId,
  appName,
  appLogoUrl: "https://cou.ch/couchLogo.svg",
  ethereum: { createOnLogin: "smart" },
  authMethods: ["email", "oauth:google", "oauth:apple", "oauth:x", "sms"],
  showCoinbaseFooter: false,
}
