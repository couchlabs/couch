import {
  useApiKeys,
  useCreateApiKey,
  useDeleteApiKey,
  useUpdateApiKey,
} from "@app-client/hooks/useApiKeys"
import type { ApiKeyResponse, CreateApiKeyResponse } from "@backend/rpc/main"
import { useState } from "react"

export function ApiKeyManager() {
  const [isCreating, setIsCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResponse | null>(
    null,
  )
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")

  const { data: apiKeys, isLoading, error } = useApiKeys()
  const createMutation = useCreateApiKey()
  const updateMutation = useUpdateApiKey()
  const deleteMutation = useDeleteApiKey()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return

    try {
      const result = await createMutation.mutateAsync({ name: newKeyName })
      setCreatedKey(result)
      setNewKeyName("")
      setIsCreating(false)
    } catch {
      // Error is handled by mutation
    }
  }

  const handleToggleEnabled = async (key: ApiKeyResponse) => {
    try {
      await updateMutation.mutateAsync({
        keyId: key.id,
        enabled: !key.enabled,
      })
    } catch {}
  }

  const handleStartEdit = (key: ApiKeyResponse) => {
    setEditingKeyId(key.id)
    setEditName(key.name)
  }

  const handleSaveEdit = async (keyId: number) => {
    if (!editName.trim()) return

    try {
      await updateMutation.mutateAsync({
        keyId,
        name: editName,
      })
      setEditingKeyId(null)
    } catch {}
  }

  const handleCancelEdit = () => {
    setEditingKeyId(null)
    setEditName("")
  }

  const handleDelete = async (keyId: number, keyName: string) => {
    if (!confirm(`Delete API key "${keyName}"?`)) return

    try {
      await deleteMutation.mutateAsync({ keyId })
    } catch {}
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (isLoading) {
    return (
      <div className="p-4 bg-white rounded shadow">
        <p className="text-gray-600">Loading API keys...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded shadow">
        <p className="text-red-600">Error loading API keys: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">API Keys</h2>
        {!isCreating && (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create New Key
          </button>
        )}
      </div>

      {/* One-time key reveal */}
      {createdKey && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-semibold text-green-800">
                API Key Created Successfully!
              </p>
              <p className="text-sm text-green-700">
                Save this key now - it won't be shown again
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreatedKey(null)}
              className="text-green-600 hover:text-green-800"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 p-2 bg-white border border-green-300 rounded font-mono text-sm break-all">
              {createdKey.apiKey}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(createdKey.apiKey)}
              className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 whitespace-nowrap"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {isCreating && (
        <div className="p-4 bg-gray-50 rounded border border-gray-200">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label
                htmlFor="api-key-name"
                className="block text-sm font-medium mb-1"
              >
                API Key Name
              </label>
              <input
                id="api-key-name"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production Key"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={32}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending || !newKeyName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false)
                  setNewKeyName("")
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

      {/* API Keys list */}
      <div className="space-y-2">
        {!apiKeys || apiKeys.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 rounded border border-gray-200">
            <p className="text-gray-600">No API keys yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Create your first API key to get started
            </p>
          </div>
        ) : (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="p-4 bg-white border border-gray-200 rounded hover:border-gray-300"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {editingKeyId === key.id ? (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        maxLength={32}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(key.id)}
                        disabled={updateMutation.isPending || !editName.trim()}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{key.name}</h3>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(key)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <code className="bg-gray-100 px-2 py-1 rounded font-mono">
                      {key.prefix}
                      {key.start}...
                    </code>
                    <span
                      className={
                        key.enabled ? "text-green-600" : "text-gray-400"
                      }
                    >
                      {key.enabled ? "Enabled" : "Disabled"}
                    </span>
                    <span>
                      Created {new Date(key.createdAt).toLocaleDateString()}
                    </span>
                    {key.lastUsedAt && (
                      <span>
                        Last used{" "}
                        {new Date(key.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(key)}
                    disabled={updateMutation.isPending}
                    className={`px-3 py-1 rounded text-sm ${
                      key.enabled
                        ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                        : "bg-green-100 text-green-700 hover:bg-green-200"
                    } disabled:opacity-50`}
                  >
                    {key.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(key.id, key.name)}
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {updateMutation.isError && (
                <p className="text-sm text-red-600 mt-2">
                  {updateMutation.error.message}
                </p>
              )}
              {deleteMutation.isError && (
                <p className="text-sm text-red-600 mt-2">
                  {deleteMutation.error.message}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
