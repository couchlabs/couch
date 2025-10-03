import { Settings } from "lucide-react"
import { useCallback, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function BackendSettings() {
  const [isPollerActive, setIsPollerActive] = useState(false)
  const [intervalValue, setIntervalValue] = useState("5")
  const [intervalUnit, setIntervalUnit] = useState<"seconds" | "minutes">(
    "minutes",
  )
  const [pollerMode, setPollerMode] = useState<"forever" | "times">("times")
  const [timesValue, setTimesValue] = useState("10")
  const [executionCount, setExecutionCount] = useState(0)
  const pollerToggleId = useId()

  const triggerScheduler = useCallback(async () => {
    try {
      await fetch("/proxy/__scheduled", {
        method: "GET",
      })
      console.log("Scheduler triggered successfully")
    } catch (error) {
      console.error("Failed to trigger scheduler:", error)
    }
  }, [])

  useEffect(() => {
    if (!isPollerActive) {
      setExecutionCount(0)
      return
    }

    const intervalMs =
      intervalUnit === "seconds"
        ? Number(intervalValue) * 1000
        : Number(intervalValue) * 60000

    const interval = setInterval(() => {
      setExecutionCount((prev) => {
        const nextCount = prev + 1

        // Check if we should stop after this execution (for "times" mode)
        if (pollerMode === "times" && nextCount >= Number(timesValue)) {
          setIsPollerActive(false)
        }

        triggerScheduler()
        return nextCount
      })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [
    isPollerActive,
    intervalValue,
    intervalUnit,
    triggerScheduler,
    pollerMode,
    timesValue,
  ])

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors cursor-pointer ${
            isPollerActive
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          <Settings
            className={`h-5 w-5 ${isPollerActive ? "animate-spin-slow" : ""}`}
          />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backend Settings</DialogTitle>
          <DialogDescription>Manage order-scheduler</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 pt-4">
          {/* Manual Trigger */}
          <div>
            <Label>Trigger the order-scheduler manually</Label>
            <Button onClick={triggerScheduler} className="w-full mt-2">
              Trigger Now
            </Button>
          </div>

          {/* Auto Poller */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor={pollerToggleId}>
                  Run the order-scheduler automatically
                </Label>
              </div>
              <Switch
                id={pollerToggleId}
                checked={isPollerActive}
                onCheckedChange={setIsPollerActive}
              />
            </div>

            {/* Interval Settings */}
            {isPollerActive && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Every</Label>
                    <div className="flex items-center gap-2 text-sm font-mono">
                      <Input
                        type="text"
                        value={intervalValue}
                        onChange={(e) => setIntervalValue(e.target.value)}
                        className="h-8 text-center text-sm font-mono px-2 transition-all duration-75 w-20"
                        placeholder="5"
                      />
                      <Select
                        value={intervalUnit}
                        onValueChange={(value) =>
                          setIntervalUnit(value as typeof intervalUnit)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="px-2 text-sm font-mono w-auto"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="seconds">seconds</SelectItem>
                          <SelectItem value="minutes">minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Stop</Label>
                    <div className="flex items-center gap-2 text-sm font-mono">
                      <Select
                        value={pollerMode}
                        onValueChange={(value) => {
                          setPollerMode(value as typeof pollerMode)
                          setExecutionCount(0)
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="px-2 text-sm font-mono w-auto"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="times">after</SelectItem>
                          <SelectItem value="forever">never</SelectItem>
                        </SelectContent>
                      </Select>
                      {pollerMode === "times" && (
                        <>
                          <Input
                            type="text"
                            value={timesValue}
                            onChange={(e) => {
                              setTimesValue(e.target.value)
                              setExecutionCount(0)
                            }}
                            className="h-8 text-center text-sm font-mono px-2 transition-all duration-75 w-16"
                            placeholder="10"
                          />
                          <span>times</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {pollerMode === "times" && (
                  <p className="text-xs text-muted-foreground">
                    Executed {executionCount} of {timesValue} times
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
