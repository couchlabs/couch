interface NavigationItem {
  id: string
  label: string
  onClick: () => void
}

interface NavigationProps {
  items: NavigationItem[]
}

export function Navigation({ items }: NavigationProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <nav className="divide-y divide-gray-200">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
