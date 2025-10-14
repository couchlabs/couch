CREATE TABLE `accounts` (
	`address` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`account_address` text NOT NULL,
	FOREIGN KEY (`account_address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_account` ON `api_keys` (`account_address`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subscription_id` text NOT NULL,
	`type` text NOT NULL,
	`due_at` text NOT NULL,
	`amount` text NOT NULL,
	`status` text NOT NULL,
	`order_number` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`parent_order_id` integer,
	`next_retry_at` text,
	`failure_reason` text,
	`raw_error` text,
	`period_length_in_seconds` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`subscription_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "type" CHECK(type IN ('initial', 'recurring', 'retry')),
	CONSTRAINT "status" CHECK(status IN ('pending', 'processing', 'paid', 'failed', 'pending_retry'))
);
--> statement-breakpoint
CREATE INDEX `idx_orders_created` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_due_status` ON `orders` (`due_at`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_subscription` ON `orders` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_parent` ON `orders` (`parent_order_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_retry_due` ON `orders` (`next_retry_at`,`status`) WHERE "orders"."next_retry_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_orders_subscription_number` ON `orders` (`subscription_id`,`order_number`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`subscription_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`owner_address` text NOT NULL,
	`account_address` text NOT NULL,
	`provider_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`modified_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`account_address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "status" CHECK(status IN ('processing', 'active', 'past_due', 'incomplete', 'canceled', 'unpaid')),
	CONSTRAINT "provider_id" CHECK(provider_id IN ('base'))
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_created` ON `subscriptions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_status` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_owner` ON `subscriptions` (`owner_address`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_account` ON `subscriptions` (`account_address`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`transaction_hash` text NOT NULL,
	`order_id` integer PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`amount` text NOT NULL,
	`status` text NOT NULL,
	`gas_used` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`subscription_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "status" CHECK(status IN ('pending', 'confirmed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_created` ON `transactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transactions_subscription` ON `transactions` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_order` ON `transactions` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_hash` ON `transactions` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `idx_transactions_status` ON `transactions` (`status`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`account_address` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	FOREIGN KEY (`account_address`) REFERENCES `accounts`(`address`) ON UPDATE no action ON DELETE cascade
);
