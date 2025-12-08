DROP INDEX `idx_webhooks_account_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhooks_account_active_unique` ON `webhooks` (`account_id`) WHERE "webhooks"."deleted_at" IS NULL;