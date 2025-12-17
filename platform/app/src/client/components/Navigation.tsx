import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

interface NavigationItem {
  id: string
  label: string
  onClick: () => void
  icon?: LucideIcon
}

interface NavigationProps {
  items: NavigationItem[]
  customContent?: ReactNode
  variant?: "default" | "light" | "dark"
  roundedBottom?: boolean
  roundedTop?: boolean
}

export function Navigation({
  items,
  customContent,
  variant = "default",
  roundedBottom = true,
  roundedTop = true,
}: NavigationProps) {
  const roundingClass =
    roundedTop && roundedBottom
      ? "rounded-xl"
      : roundedTop
        ? "rounded-t-xl"
        : roundedBottom
          ? "rounded-b-xl"
          : ""

  const bgClass =
    variant === "light"
      ? "bg-gray-50"
      : variant === "dark"
        ? "bg-gray-800"
        : "bg-white"

  const textClass = variant === "dark" ? "text-white" : "text-gray-700"
  const hoverClass =
    variant === "dark"
      ? "hover:bg-gray-700"
      : variant === "light"
        ? "hover:bg-gray-100"
        : "hover:bg-gray-50"
  const dividerClass =
    variant === "dark" ? "divide-gray-700" : "divide-gray-100"

  return (
    <div className={`${bgClass} ${roundingClass} border border-gray-200`}>
      <nav className={`divide-y ${dividerClass}`}>
        {items.map((item, index) => {
          const Icon = item.icon
          const isFirst = index === 0
          const isLast = index === items.length - 1
          const itemRounding =
            isFirst && roundedTop
              ? "rounded-t-xl"
              : isLast && roundedBottom
                ? "rounded-b-xl"
                : ""

          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className={`w-full px-4 py-3 text-left text-sm ${textClass} ${hoverClass} transition-colors flex items-center gap-3 ${itemRounding} cursor-pointer`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {item.label}
            </button>
          )
        })}
        {customContent && <div className="px-4 py-3">{customContent}</div>}
      </nav>
    </div>
  )
}
