import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  role: text('role').notNull(),
  pgy: integer('pgy'),
  extension: text('extension').notNull().default(''),
  active: integer('active').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, table => [
  uniqueIndex('users_email_unique').on(sql`${table.email} COLLATE NOCASE`),
  check('users_role_check', sql`${table.role} IN ('staff', 'learner', 'resident')`),
  check('users_active_check', sql`${table.active} IN (0, 1)`),
  check('users_pgy_check', sql`(${table.role} = 'resident' AND ${table.pgy} IS NOT NULL AND ${table.pgy} BETWEEN 1 AND 5) OR (${table.role} IN ('staff', 'learner') AND ${table.pgy} IS NULL)`),
]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('sessions_by_user').on(table.userId), index('sessions_by_expiry').on(table.expiresAt)]);

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey().notNull(),
  procedure: text('procedure').notNull(),
  location: text('location').notNull(),
  contact: text('contact').notNull(),
  note: text('note').notNull().default(''),
  staffId: text('staff_id').references(() => users.id),
  learnerId: text('learner_id').references(() => users.id),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  claimedAt: integer('claimed_at'),
  coordinatedAt: integer('coordinated_at'),
  completedAt: integer('completed_at'),
  cancelledAt: integer('cancelled_at'),
  expiredAt: integer('expired_at'),
  etaMinutes: integer('eta_minutes'),
  contacted: integer('contacted').notNull().default(0),
  supervisorId: text('supervisor_id').references(() => users.id),
  participation: text('participation'),
  manual: integer('manual').notNull().default(0),
  cancellationReason: text('cancellation_reason'),
}, table => [
  uniqueIndex('current_claim_per_learner').on(table.learnerId).where(sql`${table.learnerId} IS NOT NULL AND ${table.status} IN ('claimed', 'in_progress')`),
  index('requests_by_staff').on(table.staffId),
  index('requests_by_learner').on(table.learnerId),
  index('requests_by_status_expiry').on(table.status, table.expiresAt),
  check('requests_status_check', sql`${table.status} IN ('open', 'claimed', 'in_progress', 'completed', 'expired', 'cancelled')`),
  check('requests_eta_check', sql`${table.etaMinutes} IS NULL OR ${table.etaMinutes} IN (3, 5, 10)`),
  check('requests_contacted_check', sql`${table.contacted} IN (0, 1)`),
  check('requests_participation_check', sql`${table.participation} IS NULL OR ${table.participation} IN ('performed', 'assisted', 'observed')`),
  check('requests_manual_check', sql`${table.manual} IN (0, 1)`),
]);

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey().notNull(),
  requestId: text('request_id').notNull().references(() => requests.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  read: integer('read').notNull().default(0),
}, table => [
  uniqueIndex('alerts_request_user_unique').on(table.requestId, table.userId),
  index('alerts_by_user').on(table.userId),
  check('alerts_read_check', sql`${table.read} IN (0, 1)`),
]);

export const goals = sqliteTable('goals', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  procedure: text('procedure').notNull(),
  target: integer('target').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.procedure] }),
  check('goals_target_check', sql`${table.target} BETWEEN 1 AND 999`),
]);

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey().notNull(),
  count: integer('count').notNull(),
  resetAt: integer('reset_at').notNull(),
});
