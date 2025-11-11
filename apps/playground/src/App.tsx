import { Route, BrowserRouter as Router, Routes } from "react-router-dom"

import { WebSocketProvider } from "@/hooks/useWebSocket"
import { Checkout } from "@/pages/Checkout"
import { CheckoutInstructions } from "@/pages/CheckoutInstructions"
import { Playground } from "@/pages/Playground"

export function App() {
  return (
    <WebSocketProvider>
      <Router>
        <Routes>
          <Route path="/*" element={<Playground />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route
            path="/checkout-instructions"
            element={<CheckoutInstructions />}
          />
        </Routes>
      </Router>
    </WebSocketProvider>
  )
}
