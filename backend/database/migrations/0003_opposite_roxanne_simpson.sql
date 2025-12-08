PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_webhooks`("id", "account_id", "url", "secret", "enabled", "deleted_at", "created_at", "last_used_at") SELECT "id", "account_id", "url", "secret", "enabled", "deleted_at", "created_at", "last_used_at" FROM `webhooks`;--> statement-breakpoint
DROP TABLE `webhooks`;--> statement-breakpoint
ALTER TABLE `__new_webhooks` RENAME TO `webhooks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_webhooks_account` ON `webhooks` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhooks_account_unique` ON `webhooks` (`account_id`);