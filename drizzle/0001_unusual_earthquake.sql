CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_team_created_idx` ON `files` (`team_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_uq` ON `files` (`object_key`);--> statement-breakpoint
ALTER TABLE `messages` ADD `file_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_message_uq` ON `tasks` (`source_message_id`);