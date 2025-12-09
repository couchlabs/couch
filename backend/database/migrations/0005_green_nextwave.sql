DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `orders` ADD `transaction_hash` text;--> statement-breakpoint
CREATE INDEX `idx_orders_transaction_hash` ON `orders` (`transaction_hash`);