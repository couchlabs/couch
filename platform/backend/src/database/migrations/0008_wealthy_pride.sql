ALTER TABLE `accounts` ADD `cdp_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_cdp_user_id_unique` ON `accounts` (`cdp_user_id`);