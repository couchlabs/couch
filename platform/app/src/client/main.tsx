import { App } from "@app-client/App"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@app-client/main.css"

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
