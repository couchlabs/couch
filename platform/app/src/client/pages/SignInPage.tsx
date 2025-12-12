import { SignIn } from "@coinbase/cdp-react"

export function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <SignIn />
      </div>
    </div>
  )
}
