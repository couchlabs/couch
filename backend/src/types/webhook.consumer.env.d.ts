// This file infers types for the cloudflare:workers environment from your Alchemy Worker.
// @see https://alchemy.run/concepts/bindings/#type-safe-bindings

import type { webhookConsumer } from "@alchemy.run"

export type WorkerEnv = typeof webhookConsumer.Env

declare module "cloudflare:workers" {
  namespace Cloudflare {
    export interface Env extends WorkerEnv {}
  }
}
