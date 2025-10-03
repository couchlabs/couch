import { useState } from "react"
import { Button } from "@/components/ui/button"

export function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <h1 className="text-2xl">Couch Demo App</h1>
      <p style={{ opacity: 0.8 }}>
        Sketchpad Theme - Testing shadcn/ui components
      </p>

      <div>
        <p>Count: {count}</p>
        <div>
          <Button
            onClick={() => setCount((count) => count + 1)}
            variant="default"
          >
            Increment
          </Button>
          <Button
            onClick={() => setCount((count) => count - 1)}
            variant="secondary"
          >
            Decrement
          </Button>
          <Button onClick={() => setCount(0)} variant="outline">
            Reset
          </Button>
        </div>
      </div>
    </>
  )
}
