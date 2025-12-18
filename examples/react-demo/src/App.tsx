import { configure, subscribe } from "@couch/subscribe"
import { useState } from "react"
import "./App.css"

// Configure SDK for local development
if (import.meta.env.DEV) {
  configure({ apiUrl: "http://localhost:3000/v1" })
}

// Configuration
const merchantAddress = import.meta.env.VITE_REACT_DEMO_MERCHANT_ADDRESS
const testnet = true
const amount = "0.0001" // USDC
const period = 1 // Days

function App() {
  const [status, setStatus] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [loading, setLoading] = useState(false)

  // Form inputs
  const [recurringCharge] = useState(amount)
  const [periodInDays] = useState(period)

  const handleSubscribe = async () => {
    try {
      setLoading(true)
      setError("")
      setStatus("Creating subscription...")

      const subscription = await subscribe({
        merchantAddress,
        recurringCharge,
        testnet,
        periodInDays,
      })

      setStatus(
        `✅ Success! Subscription created and activated: ${subscription.id}`,
      )
      console.log({ subscription })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error"
      setError(errorMessage)
      setStatus("❌ Failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="App">
      <h1>Subscribe Demo</h1>

      <div className="card">
        <div
          style={{
            marginBottom: "1rem",
            textAlign: "left",
            fontSize: "0.9rem",
          }}
        >
          <p>
            <strong>Merchant:</strong> {merchantAddress}
          </p>
          <p>
            <strong>Period:</strong> {periodInDays} Day
          </p>
          <p>
            <strong>Amount:</strong> {recurringCharge}
          </p>
          <p>
            <strong>Network:</strong>{" "}
            {testnet ? "Base Sepolia (Testnet)" : "Base (Mainnet)"}
          </p>
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Processing..." : "Subscribe"}
          </button>
        </div>

        {status && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              backgroundColor: error ? "#fee" : "#efe",
              borderRadius: "4px",
              textAlign: "left",
            }}
          >
            <p style={{ margin: 0 }}>{status}</p>
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              backgroundColor: "#fee",
              color: "#c00",
              borderRadius: "4px",
              textAlign: "left",
            }}
          >
            <p style={{ margin: 0 }}>
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
