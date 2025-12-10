import {
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useUpdateWebhookUrl,
  useWebhook,
} from "@app/hooks/useWebhook"
import { useState } from "react"

export function WebhookManager() {
  const [isCreating, setIsCreating] = useState(false)
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  const { data: webhook, isLoading, error } = useWebhook()
  const createMutation = useCreateWebhook()
  const updateUrlMutation = useUpdateWebhookUrl()
  const rotateSecretMutation = useRotateWebhookSecret()
  const deleteMutation = useDeleteWebhook()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!webhookUrl.trim()) return

    try {
      const result = await createMutation.mutateAsync({ url: webhookUrl })
      setRevealedSecret(result.secret)
      setWebhookUrl("")
      setIsCreating(false)
    } catch (err) {
      console.error("Failed to create webhook:", err)
    }
  }

  const handleUpdateUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!webhookUrl.trim()) return

    try {
      await updateUrlMutation.mutateAsync({ url: webhookUrl })
      setWebhookUrl("")
      setIsEditingUrl(false)
    } catch (err) {
      console.error("Failed to update webhook URL:", err)
    }
  }

  const handleRotateSecret = async () => {
    if (
      !confirm(
        "Rotate webhook secret? Your current secret will stop working immediately.",
      )
    )
      return

    try {
      const result = await rotateSecretMutation.mutateAsync()
      setRevealedSecret(result.secret)
    } catch (err) {
      console.error("Failed to rotate webhook secret:", err)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Delete webhook configuration? This cannot be undone.")) return

    try {
      await deleteMutation.mutateAsync()
      setRevealedSecret(null)
    } catch (err) {
      console.error("Failed to delete webhook:", err)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (isLoading) {
    return (
      <div className="p-4 bg-white rounded shadow">
        <p className="text-gray-600">Loading webhook configuration...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded shadow">
        <p className="text-red-600">Error loading webhook: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Webhook Configuration</h2>
        {!webhook && !isCreating && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Configure Webhook
          </button>
        )}
      </div>

      {/* One-time secret reveal */}
      {revealedSecret && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-semibold text-green-800">
                Webhook Secret Generated!
              </p>
              <p className="text-sm text-green-700">
                Save this secret now - it won't be shown again
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevealedSecret(null)}
              className="text-green-600 hover:text-green-800"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 p-2 bg-white border border-green-300 rounded font-mono text-sm break-all">
              {revealedSecret}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(revealedSecret)}
              className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-green-700 mt-2">
            Use this secret to verify webhook signatures with HMAC-SHA256
          </p>
        </div>
      )}

      {/* Create form */}
      {isCreating && (
        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label
                htmlFor="webhook-url"
                className="block text-sm font-medium mb-1"
              >
                Webhook URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be a valid HTTPS URL
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending || !webhookUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false)
                  setWebhookUrl("")
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-red-600">
                {createMutation.error.message}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Webhook display */}
      {webhook && !isCreating && (
        <div className="p-4 bg-white border border-gray-200 rounded">
          <div className="space-y-4">
            <div>
              <div className="block text-sm font-medium text-gray-700 mb-1">
                Webhook URL
              </div>
              {isEditingUrl ? (
                <form onSubmit={handleUpdateUrl} className="space-y-2">
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder={webhook.url}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={
                        updateUrlMutation.isPending || !webhookUrl.trim()
                      }
                      className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                    >
                      {updateUrlMutation.isPending ? "Updating..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingUrl(false)
                        setWebhookUrl("")
                      }}
                      className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                  {updateUrlMutation.isError && (
                    <p className="text-sm text-red-600">
                      {updateUrlMutation.error.message}
                    </p>
                  )}
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded font-mono text-sm break-all">
                    {webhook.url}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      setWebhookUrl(webhook.url)
                      setIsEditingUrl(true)
                    }}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm whitespace-nowrap"
                  >
                    Update URL
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="block text-sm font-medium text-gray-700 mb-1">
                Webhook Secret
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded font-mono text-sm">
                  {webhook.secretPreview}
                </code>
                <button
                  type="button"
                  onClick={handleRotateSecret}
                  disabled={rotateSecretMutation.isPending}
                  className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 text-sm whitespace-nowrap disabled:opacity-50"
                >
                  {rotateSecretMutation.isPending
                    ? "Rotating..."
                    : "Rotate Secret"}
                </button>
              </div>
              {rotateSecretMutation.isError && (
                <p className="text-sm text-red-600 mt-1">
                  {rotateSecretMutation.error.message}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Rotating the secret will invalidate the current one immediately
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-sm text-gray-600">
                <p>
                  Created {new Date(webhook.createdAt).toLocaleDateString()}
                </p>
                {webhook.lastUsedAt && (
                  <p>
                    Last used{" "}
                    {new Date(webhook.lastUsedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Webhook"}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-sm text-red-600">
                {deleteMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!webhook && !isCreating && (
        <div className="p-8 text-center bg-gray-50 rounded border border-gray-200">
          <p className="text-gray-600">No webhook configured</p>
          <p className="text-sm text-gray-500 mt-1">
            Configure a webhook to receive real-time subscription events
          </p>
        </div>
      )}
    </div>
  )
}
