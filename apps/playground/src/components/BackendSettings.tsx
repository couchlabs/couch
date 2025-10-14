import { Info, Settings } from "lucide-react"
import { useCallback, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

type SchedulerType = "order" | "dunning"

interface SchedulerSettings {
  isActive: boolean
  intervalValue: string
  intervalUnit: "seconds" | "minutes"
  pollerMode: "forever" | "times"
  timesValue: string
  executionCount: number
}

const SCHEDULERS: Record<
  SchedulerType,
  {
    name: string
    description: string
    endpoint: string
    info: string
    details: string
  }
> = {
  order: {
    name: "Order Scheduler",
    description: "Process due payments",
    endpoint: "/proxy/scheduled/order",
    info: "Queries the database for orders due to be charged and pushes them to the order queue for processing.",
    details:
      "In production, this runs automatically every 15 minutes via cron. During local development, cron jobs don't execute, so use this interface to trigger manually or set up auto-polling.",
  },
  dunning: {
    name: "Dunning Scheduler",
    description: "Retry failed payments",
    endpoint: "/proxy/scheduled/dunning",
    info: "Queries the database for failed orders ready for retry and pushes them to the order queue for another payment attempt.",
    details:
      "In production, this runs automatically every hour via cron. During local development, cron jobs don't execute, so use this interface to trigger manually or set up auto-polling.",
  },
}

export function BackendSettings() {
  const [selectedScheduler, setSelectedScheduler] =
    useState<SchedulerType>("order")
  const [settings, setSettings] = useState<
    Record<SchedulerType, SchedulerSettings>
  >({
    order: {
      isActive: false,
      intervalValue: "5",
      intervalUnit: "minutes",
      pollerMode: "times",
      timesValue: "10",
      executionCount: 0,
    },
    dunning: {
      isActive: false,
      intervalValue: "1",
      intervalUnit: "minutes",
      pollerMode: "times",
      timesValue: "5",
      executionCount: 0,
    },
  })

  const currentSettings = settings[selectedScheduler]
  const pollerToggleId = useId()

  const updateSettings = useCallback(
    (updates: Partial<SchedulerSettings>) => {
      setSettings((prev) => ({
        ...prev,
        [selectedScheduler]: { ...prev[selectedScheduler], ...updates },
      }))
    },
    [selectedScheduler],
  )

  const triggerScheduler = useCallback(async (type: SchedulerType) => {
    try {
      await fetch(SCHEDULERS[type].endpoint, {
        method: "GET",
      })
      console.log(`${SCHEDULERS[type].name} triggered successfully`)
    } catch (error) {
      console.error(`Failed to trigger ${SCHEDULERS[type].name}:`, error)
    }
  }, [])

  // Auto-poller effect for Order Scheduler
  useEffect(() => {
    const orderSettings = settings.order
    if (!orderSettings.isActive) return

    const intervalMs =
      orderSettings.intervalUnit === "seconds"
        ? Number(orderSettings.intervalValue) * 1000
        : Number(orderSettings.intervalValue) * 60000

    const interval = setInterval(() => {
      setSettings((prev) => {
        const current = prev.order
        const nextCount = current.executionCount + 1

        // Check if we should stop after this execution (for "times" mode)
        if (
          current.pollerMode === "times" &&
          nextCount >= Number(current.timesValue)
        ) {
          return {
            ...prev,
            order: { ...current, isActive: false, executionCount: nextCount },
          }
        }

        triggerScheduler("order")
        return {
          ...prev,
          order: { ...current, executionCount: nextCount },
        }
      })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [
    settings.order.isActive,
    settings.order.intervalValue,
    settings.order.intervalUnit,
    settings.order.pollerMode,
    settings.order.timesValue,
    triggerScheduler,
    settings.order,
  ])

  // Auto-poller effect for Dunning Scheduler
  useEffect(() => {
    const dunningSettings = settings.dunning
    if (!dunningSettings.isActive) return

    const intervalMs =
      dunningSettings.intervalUnit === "seconds"
        ? Number(dunningSettings.intervalValue) * 1000
        : Number(dunningSettings.intervalValue) * 60000

    const interval = setInterval(() => {
      setSettings((prev) => {
        const current = prev.dunning
        const nextCount = current.executionCount + 1

        // Check if we should stop after this execution (for "times" mode)
        if (
          current.pollerMode === "times" &&
          nextCount >= Number(current.timesValue)
        ) {
          return {
            ...prev,
            dunning: { ...current, isActive: false, executionCount: nextCount },
          }
        }

        triggerScheduler("dunning")
        return {
          ...prev,
          dunning: { ...current, executionCount: nextCount },
        }
      })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [
    settings.dunning.isActive,
    settings.dunning.intervalValue,
    settings.dunning.intervalUnit,
    settings.dunning.pollerMode,
    settings.dunning.timesValue,
    triggerScheduler,
    settings.dunning,
  ])

  const anySchedulerActive = Object.values(settings).some((s) => s.isActive)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`fixed bottom-6 right-6 p-3 rounded-full shadow-lg transition-colors cursor-pointer ${
            anySchedulerActive
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          <Settings
            className={`h-5 w-5 ${anySchedulerActive ? "animate-spin-slow" : ""}`}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Backend Settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-48 space-y-1">
            {(
              Object.entries(SCHEDULERS) as [
                SchedulerType,
                (typeof SCHEDULERS)[SchedulerType],
              ][]
            ).map(([type, scheduler]) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedScheduler(type)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedScheduler === type
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="font-medium">{scheduler.name}</div>
                <div className="text-xs text-muted-foreground">
                  {scheduler.description}
                </div>
              </button>
            ))}
          </div>

          <Separator orientation="vertical" />

          {/* Settings Panel */}
          <div className="flex-1 space-y-6">
            {/* Info Box */}
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {SCHEDULERS[selectedScheduler].info}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {SCHEDULERS[selectedScheduler].details}
                  </p>
                </div>
              </div>
            </div>

            {/* Manual Trigger */}
            <div>
              <Label>Trigger manually</Label>
              <Button
                onClick={() => triggerScheduler(selectedScheduler)}
                className="mt-2"
              >
                Trigger Now
              </Button>
            </div>

            {/* Auto Poller */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor={pollerToggleId}>
                    Run scheduler automatically
                  </Label>
                </div>
                <Switch
                  id={pollerToggleId}
                  checked={currentSettings.isActive}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      isActive: checked,
                      executionCount: 0,
                    })
                  }
                />
              </div>

              {/* Interval Settings */}
              {currentSettings.isActive && (
                <div className="space-y-2">
                  <div className="flex items-end gap-6">
                    <div className="space-y-2">
                      <Label>Every</Label>
                      <div className="flex items-center gap-2 text-sm font-mono">
                        <Input
                          type="text"
                          value={currentSettings.intervalValue}
                          onChange={(e) =>
                            updateSettings({ intervalValue: e.target.value })
                          }
                          className="h-8 text-center text-sm font-mono px-2 transition-all duration-75 w-20"
                          placeholder="5"
                        />
                        <Select
                          value={currentSettings.intervalUnit}
                          onValueChange={(value) =>
                            updateSettings({
                              intervalUnit: value as "seconds" | "minutes",
                            })
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
                          value={currentSettings.pollerMode}
                          onValueChange={(value) =>
                            updateSettings({
                              pollerMode: value as "forever" | "times",
                              executionCount: 0,
                            })
                          }
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
                        {currentSettings.pollerMode === "times" && (
                          <>
                            <Input
                              type="text"
                              value={currentSettings.timesValue}
                              onChange={(e) =>
                                updateSettings({
                                  timesValue: e.target.value,
                                  executionCount: 0,
                                })
                              }
                              className="h-8 text-center text-sm font-mono px-2 transition-all duration-75 w-16"
                              placeholder="10"
                            />
                            <span>times</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {currentSettings.pollerMode === "times" && (
                    <p className="text-xs text-muted-foreground">
                      Executed {currentSettings.executionCount} of{" "}
                      {currentSettings.timesValue} times
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
