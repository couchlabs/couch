import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type Network, useNetwork } from "@/store/NetworkContext"

export function NetworkSelector() {
  const { network, setNetwork } = useNetwork()

  return (
    <Select
      value={network}
      onValueChange={(value: Network) => setNetwork(value)}
    >
      <SelectTrigger className="w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="testnet">Testnet</SelectItem>
        <SelectItem value="mainnet">Mainnet</SelectItem>
      </SelectContent>
    </Select>
  )
}
