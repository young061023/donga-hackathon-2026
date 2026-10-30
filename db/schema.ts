import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const DEFAULT_TEAM_RULES = [
  "팀 채팅과 공지는 24시간 안에 꼭 확인해요.",
  "바로 답하기 어렵다면 확인 표시를 남기고, 답할 수 있는 시간을 알려요.",
  "할 일에는 담당자와 마감일을 정하고, 일정이 어려워지면 미리 공유해요.",
  "모임에 참석하기 어렵다면 미리 알리고, 회의 정리를 확인해요.",
  "결정한 내용과 최신 파일은 팀 채널에 함께 남겨요.",
].join("\n");

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: createdAt(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull(),
  rules: text("rules").notNull().default(DEFAULT_TEAM_RULES),
  ownerId: text("owner_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("teams_invite_code_uq").on(table.inviteCode)]);

export const teamMembers = sqliteTable("team_members", {
  teamId: text("team_id").notNull().references(() => teams.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull().default("member"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.userId] }),
  index("team_members_user_idx").on(table.userId),
]);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("channels_team_name_uq").on(table.teamId, table.name)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  channelId: text("channel_id").notNull().references(() => channels.id),
  authorId: text("author_id").references(() => users.id),
  authorType: text("author_type").notNull().default("user"),
  sourceMessageId: text("source_message_id"),
  fileId: text("file_id"),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("messages_team_created_idx").on(table.teamId, table.createdAt),
  index("messages_channel_created_idx").on(table.channelId, table.createdAt),
]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  objectKey: text("object_key").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("files_team_created_idx").on(table.teamId, table.createdAt),
  uniqueIndex("files_object_key_uq").on(table.objectKey),
]);

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  title: text("title").notNull(),
  assigneeId: text("assignee_id").references(() => users.id),
  createdBy: text("created_by").notNull().references(() => users.id),
  status: text("status").notNull().default("todo"),
  dueText: text("due_text"),
  sourceMessageId: text("source_message_id"),
  createdAt: createdAt(),
}, (table) => [
  index("tasks_team_status_idx").on(table.teamId, table.status),
  uniqueIndex("tasks_source_message_uq").on(table.sourceMessageId),
]);

export const polls = sqliteTable("polls", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  title: text("title").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  status: text("status").notNull().default("open"),
  closesAt: text("closes_at"),
  createdAt: createdAt(),
}, (table) => [index("polls_team_status_idx").on(table.teamId, table.status)]);

export const pollOptions = sqliteTable("poll_options", {
  id: text("id").primaryKey(),
  pollId: text("poll_id").notNull().references(() => polls.id),
  label: text("label").notNull(),
  position: integer("position").notNull().default(0),
}, (table) => [index("poll_options_poll_idx").on(table.pollId)]);

export const pollVotes = sqliteTable("poll_votes", {
  pollId: text("poll_id").notNull().references(() => polls.id),
  optionId: text("option_id").notNull().references(() => pollOptions.id),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.pollId, table.userId] }),
  index("poll_votes_option_idx").on(table.optionId),
]);

export const workStatuses = sqliteTable("work_statuses", {
  teamId: text("team_id").notNull().references(() => teams.id),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("available"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.teamId, table.userId] })]);

export const accounts = sqliteTable("accounts", {
  userId: text("user_id").primaryKey().references(() => users.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  onlineEnabled: integer("online_enabled", { mode: "boolean" }).notNull().default(true),
});

export const userPresence = sqliteTable("user_presence", {
  userId: text("user_id").primaryKey().references(() => users.id),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("sessions_expiry_idx").on(table.expiresAt)]);
export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
