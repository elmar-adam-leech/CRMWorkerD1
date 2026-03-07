import {
  type Contact, type InsertContact,
  type Lead, type InsertLead,
  contacts, leads, messages, activities, estimates, jobs, calls,
  contactStatusEnum,
} from "@shared/schema";
import { db } from "../db";
import { deduplicateContacts } from "../services/contact-deduper";
import { getDashboardMetrics, getMetricsAggregates, type MetricsAggregates } from "../services/dashboard-metrics";
import { eq, and, or, desc, ne, gt, lte, gte, ilike, isNotNull, notInArray, inArray, sql, count } from "drizzle-orm";
import { normalizePhoneArrayForStorage } from "../utils/phone-normalizer";
import type { UpdateContact } from "../storage-types";

/** Derive the 10-digit normalized phone stored in contacts.normalizedPhone from a phones array. */
function computeNormalizedPhone(phones: string[] | null | undefined): string | null {
  const first = phones?.[0];
  if (!first) return null;
  const digits = first.replace(/\D/g, '');
  return digits.length > 0 ? digits.slice(-10) : null;
}

type PaginatedContacts = {
  data: any[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

// Safety cap for the non-paginated getContacts call.
// This prevents runaway memory usage for large tenants.
// TODO: Replace all callers of getContacts() with getContactsPaginated() when
// tenant scale warrants cursor-based pagination across the entire app.
const GET_CONTACTS_LIMIT = 2000;

async function getContacts(contractorId: string, type?: 'lead' | 'customer' | 'inactive'): Promise<Contact[]> {
  const conditions = [eq(contacts.contractorId, contractorId)];
  if (type) conditions.push(eq(contacts.type, type));
  return await db.select().from(contacts).where(and(...conditions)).orderBy(desc(contacts.createdAt)).limit(GET_CONTACTS_LIMIT);
}

async function getLeadTrend(contractorId: string, since: Date): Promise<{ date: string; count: number }[]> {
  return await db.select({
    date: sql<string>`DATE(${contacts.createdAt})::text`,
    count: sql<number>`COUNT(*)::int`,
  })
    .from(contacts)
    .where(and(
      eq(contacts.contractorId, contractorId),
      eq(contacts.type, 'lead'),
      gte(contacts.createdAt, since),
    ))
    .groupBy(sql`DATE(${contacts.createdAt})`)
    .orderBy(sql`DATE(${contacts.createdAt})`);
}

/**
 * Fetch contacts for a contractor using cursor-based pagination.
 *
 * Prefer this over getContacts() for any UI that renders large lists. The
 * cursor is the ISO timestamp of the last-seen record's createdAt field.
 * Results are capped at 100 per page regardless of the `limit` option.
 *
 * FILTER MODES
 * ------------
 * The filter logic has four modes, applied in priority order:
 *
 *  1. includeAll: true — bypasses ALL status filtering entirely.
 *     Used by admin views (Settings, employee management) that need every
 *     contact regardless of pipeline state, including archived/disqualified.
 *
 *  2. Explicit status (status !== 'all') — shows only contacts with that
 *     exact status value. Used by status-specific tabs on the Leads page.
 *
 *  3. status === 'all' or status is omitted, WITH type === 'lead' (or no type)
 *     — excludes 'disqualified' contacts. Disqualified leads are excluded by
 *     default to keep the main lead board uncluttered; they can be surfaced
 *     explicitly via status='disqualified'.
 *
 *  4. type === 'customer' or 'inactive' with no status filter — no status
 *     exclusion is applied, since customers and inactive contacts don't have
 *     a meaningful "disqualified" state.
 *
 * CURSOR DESIGN
 * -------------
 * Pagination uses createdAt as the cursor key rather than an offset. Offset
 * pagination (LIMIT n OFFSET m) requires the DB to scan and discard m rows on
 * every page, which is O(m) cost per page and degrades for large datasets.
 * Cursor pagination using an indexed timestamp column is O(1) regardless of
 * page number, because Postgres can seek directly to the next page boundary
 * via the contacts_contractor_date_idx composite index on (contractor_id, created_at).
 *
 * A subtle risk: if two contacts share the exact same createdAt value at a
 * page boundary, one may be skipped or duplicated. In practice, contacts are
 * created one at a time (user input or webhook), so timestamp collisions are
 * rare. If this becomes a problem, switch to a composite cursor of
 * (createdAt, id) and use a WHERE (created_at, id) < ($cursor_ts, $cursor_id)
 * keyset condition for fully stable pagination.
 */
async function getContactsPaginated(contractorId: string, options: {
  cursor?: string;
  limit?: number;
  type?: 'lead' | 'customer' | 'inactive';
  status?: string;
  search?: string;
  includeAll?: boolean;
  archived?: boolean;
} = {}): Promise<PaginatedContacts> {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [eq(contacts.contractorId, contractorId)];

  if (options.cursor) {
    conditions.push(gt(contacts.createdAt, new Date(options.cursor)));
  }
  if (options.type) {
    conditions.push(eq(contacts.type, options.type));
  }
  if (!options.includeAll) {
    if (options.status && options.status !== 'all') {
      conditions.push(eq(contacts.status, options.status as typeof contactStatusEnum.enumValues[number]));
    } else if (!options.status || options.status === 'all') {
      if (!options.type || options.type === 'lead') {
        conditions.push(ne(contacts.status, 'disqualified'));
      }
    }
  }
  if (options.search) {
    conditions.push(or(
      ilike(contacts.name, `%${options.search}%`),
      ilike(contacts.address, `%${options.search}%`),
      ilike(contacts.source, `%${options.search}%`)
    )!);
  }
  // archived filter: when true, show only contacts whose leads are all archived;
  // when false (default for lead type), exclude contacts with only archived leads
  if (options.type === 'lead' && !options.includeAll) {
    if (options.archived === true) {
      conditions.push(sql`EXISTS (SELECT 1 FROM leads WHERE leads.contact_id = ${contacts.id} AND leads.contractor_id = ${contractorId} AND leads.archived = true)`);
      conditions.push(sql`NOT EXISTS (SELECT 1 FROM leads WHERE leads.contact_id = ${contacts.id} AND leads.contractor_id = ${contractorId} AND leads.archived = false)`);
    } else {
      conditions.push(sql`EXISTS (SELECT 1 FROM leads WHERE leads.contact_id = ${contacts.id} AND leads.contractor_id = ${contractorId} AND leads.archived = false)`);
    }
  }

  const [contactsData, total] = await Promise.all([
    db.select({
      id: contacts.id,
      name: contacts.name,
      emails: sql<string[]>`COALESCE(${contacts.emails}, '{}')`,
      phones: sql<string[]>`COALESCE(${contacts.phones}, '{}')`,
      address: contacts.address,
      type: contacts.type,
      status: contacts.status,
      source: contacts.source,
      notes: contacts.notes,
      tags: sql<string[]>`COALESCE(${contacts.tags}, '{}')`,
      followUpDate: contacts.followUpDate,
      pageUrl: contacts.pageUrl,
      utmSource: contacts.utmSource,
      utmMedium: contacts.utmMedium,
      utmCampaign: contacts.utmCampaign,
      utmTerm: contacts.utmTerm,
      utmContent: contacts.utmContent,
      isScheduled: contacts.isScheduled,
      contactedAt: contacts.contactedAt,
      housecallProCustomerId: contacts.housecallProCustomerId,
      housecallProEstimateId: contacts.housecallProEstimateId,
      scheduledAt: contacts.scheduledAt,
      scheduledEmployeeId: contacts.scheduledEmployeeId,
      contractorId: contacts.contractorId,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      hasJobs: sql<boolean>`EXISTS(SELECT 1 FROM ${jobs} WHERE ${jobs.contactId} = ${contacts.id})`,
    })
    .from(contacts)
    .where(and(...conditions))
    .orderBy(desc(contacts.createdAt))
    .limit(limit + 1),
    getContactsCount(contractorId, { type: options.type, status: options.status, search: options.search }),
  ]);

  const hasMore = contactsData.length > limit;
  if (hasMore) contactsData.pop();

  const nextCursor = hasMore && contactsData.length > 0
    ? contactsData[contactsData.length - 1].createdAt.toISOString()
    : null;

  return { data: contactsData, pagination: { total, hasMore, nextCursor } };
}

async function getContactsCount(contractorId: string, options: {
  type?: 'lead' | 'customer' | 'inactive';
  status?: string;
  search?: string;
} = {}): Promise<number> {
  const conditions = [eq(contacts.contractorId, contractorId)];
  if (options.type) conditions.push(eq(contacts.type, options.type));
  if (options.status && options.status !== 'all') {
    conditions.push(eq(contacts.status, options.status as typeof contactStatusEnum.enumValues[number]));
  } else if (!options.status || options.status === 'all') {
    if (!options.type || options.type === 'lead') {
      conditions.push(ne(contacts.status, 'disqualified'));
    }
  }
  if (options.search) {
    conditions.push(or(
      ilike(contacts.name, `%${options.search}%`),
      ilike(contacts.address, `%${options.search}%`),
      ilike(contacts.source, `%${options.search}%`)
    )!);
  }
  const result = await db.select({ count: sql`count(*)` }).from(contacts).where(and(...conditions));
  return Number(result[0]?.count || 0);
}

async function getContactsStatusCounts(contractorId: string, options: {
  search?: string;
  type?: 'lead' | 'customer' | 'inactive';
} = {}): Promise<{ all: number; new: number; contacted: number; scheduled: number; disqualified: number }> {
  const baseConditions = [eq(contacts.contractorId, contractorId)];
  if (options.type) baseConditions.push(eq(contacts.type, options.type));
  if (options.search) {
    baseConditions.push(or(
      ilike(contacts.name, `%${options.search}%`),
      ilike(contacts.address, `%${options.search}%`),
      ilike(contacts.source, `%${options.search}%`)
    )!);
  }

  // For lead-type queries, exclude contacts whose ALL leads are archived
  const isLeadType = !options.type || options.type === 'lead';
  if (isLeadType) {
    baseConditions.push(sql`EXISTS (
      SELECT 1 FROM leads
      WHERE leads.contact_id = ${contacts.id}
        AND leads.contractor_id = ${contractorId}
        AND leads.archived = false
    )`);
  }

  const result = await db.select({
    all: isLeadType
      ? sql<number>`COUNT(CASE WHEN ${contacts.status} NOT IN ('scheduled', 'disqualified') THEN 1 END)`
      : count(),
    new: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'new' THEN 1 END)`,
    contacted: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'contacted' THEN 1 END)`,
    scheduled: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'scheduled' THEN 1 END)`,
    disqualified: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'disqualified' THEN 1 END)`,
  }).from(contacts).where(and(...baseConditions));

  const counts = result[0];
  return {
    all: Number(counts.all),
    new: Number(counts.new),
    contacted: Number(counts.contacted),
    scheduled: Number(counts.scheduled),
    disqualified: Number(counts.disqualified),
  };
}

async function getContact(id: string, contractorId: string): Promise<Contact | undefined> {
  const result = await db.select({
    id: contacts.id,
    name: contacts.name,
    emails: sql<string[]>`COALESCE(${contacts.emails}, '{}')`,
    phones: sql<string[]>`COALESCE(${contacts.phones}, '{}')`,
    address: contacts.address,
    type: contacts.type,
    status: contacts.status,
    source: contacts.source,
    notes: contacts.notes,
    tags: sql<string[]>`COALESCE(${contacts.tags}, '{}')`,
    followUpDate: contacts.followUpDate,
    pageUrl: contacts.pageUrl,
    utmSource: contacts.utmSource,
    utmMedium: contacts.utmMedium,
    utmCampaign: contacts.utmCampaign,
    utmTerm: contacts.utmTerm,
    utmContent: contacts.utmContent,
    isScheduled: contacts.isScheduled,
    contactedAt: contacts.contactedAt,
    housecallProCustomerId: contacts.housecallProCustomerId,
    housecallProEstimateId: contacts.housecallProEstimateId,
    scheduledAt: contacts.scheduledAt,
    scheduledEmployeeId: contacts.scheduledEmployeeId,
    contractorId: contacts.contractorId,
    createdAt: contacts.createdAt,
    updatedAt: contacts.updatedAt,
    hasJobs: sql<boolean>`EXISTS(SELECT 1 FROM ${jobs} WHERE ${jobs.contactId} = ${contacts.id})`,
  }).from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.contractorId, contractorId)))
    .limit(1);
  return result[0] as unknown as Contact;
}

async function getContactByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Contact | undefined> {
  const result = await db.select().from(contacts).where(and(
    eq(contacts.externalId, externalId),
    eq(contacts.externalSource, externalSource),
    eq(contacts.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function getContactByPhone(phone: string, contractorId: string): Promise<Contact | undefined> {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.length > 0 ? digits.slice(-10) : digits;
  // Fast indexed lookup on the pre-computed normalizedPhone column.
  // Avoids the REGEXP_REPLACE full-table-scan that this query previously used.
  // normalizedPhone is populated on every createContact/updateContact call.
  const result = await db.select().from(contacts)
    .where(and(
      eq(contacts.contractorId, contractorId),
      eq(contacts.normalizedPhone, normalized),
    ))
    .limit(1);
  return result[0];
}

async function getContactByHousecallProCustomerId(housecallProCustomerId: string, contractorId: string): Promise<Contact | undefined> {
  const result = await db.select().from(contacts).where(and(
    eq(contacts.housecallProCustomerId, housecallProCustomerId),
    eq(contacts.contractorId, contractorId)
  )).limit(1);
  return result[0];
}

async function createContact(contact: Omit<InsertContact, 'contractorId'>, contractorId: string): Promise<Contact> {
  const normalizedPhones = contact.phones ? normalizePhoneArrayForStorage(contact.phones) : [];
  const normalizedContact = {
    ...contact,
    phones: normalizedPhones,
    normalizedPhone: computeNormalizedPhone(normalizedPhones),
  };
  const result = await db.insert(contacts).values({ ...normalizedContact, contractorId }).returning();
  return result[0];
}

async function updateContact(id: string, contact: UpdateContact, contractorId: string): Promise<Contact | undefined> {
  const normalizedPhones = contact.phones ? normalizePhoneArrayForStorage(contact.phones) : undefined;
  const normalizedContact = {
    ...contact,
    ...(normalizedPhones !== undefined && {
      phones: normalizedPhones,
      normalizedPhone: computeNormalizedPhone(normalizedPhones),
    }),
  };
  const result = await db.update(contacts)
    .set({ ...normalizedContact, updatedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function markContactContacted(contactId: string, contractorId: string, userId: string, contactedAt: Date = new Date()): Promise<Contact | undefined> {
  const result = await db.update(contacts)
    .set({
      contactedAt,
      contactedByUserId: userId,
      status: sql`CASE WHEN ${contacts.status} = 'new' THEN 'contacted' ELSE ${contacts.status} END`,
      updatedAt: new Date()
    })
    .where(and(
      eq(contacts.id, contactId),
      eq(contacts.contractorId, contractorId),
      sql`contacted_at IS NULL`
    ))
    .returning();
  return result[0];
}

async function deleteContact(id: string, contractorId: string): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const existing = await tx.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.id, id), eq(contacts.contractorId, contractorId)
    )).limit(1);
    if (existing.length === 0) return false;

    // Delete all records associated with this contact
    await tx.delete(messages).where(and(
      eq(messages.contactId, id), eq(messages.contractorId, contractorId)
    ));
    await tx.delete(calls).where(and(
      eq(calls.contactId, id), eq(calls.contractorId, contractorId)
    ));
    await tx.delete(estimates).where(and(eq(estimates.contactId, id), eq(estimates.contractorId, contractorId)));
    await tx.delete(jobs).where(and(eq(jobs.contactId, id), eq(jobs.contractorId, contractorId)));
    // activities and leads cascade via FK onDelete: cascade
    const result = await tx.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.contractorId, contractorId)));
    return (result.rowCount ?? 0) > 0;
  });
}

async function unlinkOrphanedEmailActivities(contactId: string, currentEmails: string[], contractorId: string): Promise<void> {
  const emailActivities = await db.select({ id: activities.id, metadata: activities.metadata })
    .from(activities)
    .where(and(
      eq(activities.contactId, contactId),
      eq(activities.contractorId, contractorId),
      eq(activities.externalSource, 'gmail')
    ));

  if (emailActivities.length === 0) return;

  const lowerCurrentEmails = currentEmails.map(e => e.toLowerCase());
  const keepIds: string[] = [];
  for (const activity of emailActivities) {
    if (!activity.metadata) continue;
    try {
      const meta = JSON.parse(activity.metadata);
      const fromEmail = (meta.from || '').toLowerCase();
      const toEmails: string[] = (meta.to || []).map((e: string) => e.toLowerCase());
      const allEmails = [fromEmail, ...toEmails];
      if (allEmails.some(e => lowerCurrentEmails.includes(e))) {
        keepIds.push(activity.id);
      }
    } catch {
      // Skip unparseable metadata
    }
  }

  // Single bulk update instead of one per activity
  await db.update(activities)
    .set({ contactId: null })
    .where(and(
      eq(activities.contactId, contactId),
      eq(activities.contractorId, contractorId),
      eq(activities.externalSource, 'gmail'),
      keepIds.length > 0 ? notInArray(activities.id, keepIds) : sql`true`
    ));
}

async function findMatchingContact(contractorId: string, emails?: string[], phones?: string[]): Promise<string | null> {
  if (emails && emails.length > 0) {
    const lowerEmails = emails.map(e => e.toLowerCase());
    const emailResult = await db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.contractorId, contractorId),
      sql`EXISTS (
        SELECT 1 FROM unnest(${contacts.emails}) AS contact_email
        WHERE LOWER(contact_email) = ANY(ARRAY[${sql.join(lowerEmails.map(e => sql`${e}`), sql`, `)}]::text[])
      )`
    )).limit(1);
    if (emailResult.length > 0) return emailResult[0].id;
  }

  if (phones && phones.length > 0) {
    // Normalize the input phones to 10-digit format and query the indexed normalizedPhone
    // column directly — avoids the prior REGEXP_REPLACE full-table scan.
    const normalizedPhones = phones.map(phone => {
      const digits = phone.replace(/\D/g, '');
      return digits.length > 10 ? digits.slice(-10) : digits;
    }).filter(p => p.length > 0);

    if (normalizedPhones.length > 0) {
      const phoneResult = await db.select({ id: contacts.id }).from(contacts).where(and(
        eq(contacts.contractorId, contractorId),
        inArray(contacts.normalizedPhone, normalizedPhones)
      )).limit(1);
      if (phoneResult.length > 0) return phoneResult[0].id;
    }
  }

  return null;
}

async function getLeads(contractorId: string, includeArchived = false): Promise<Lead[]> {
  const conditions = [eq(leads.contractorId, contractorId)];
  if (!includeArchived) conditions.push(eq(leads.archived, false));
  return await db.select().from(leads).where(and(...conditions)).orderBy(desc(leads.createdAt)).limit(1000);
}

async function getLeadsByContact(contactId: string, contractorId: string): Promise<Lead[]> {
  return await db.select().from(leads).where(and(
    eq(leads.contactId, contactId),
    eq(leads.contractorId, contractorId)
  )).orderBy(desc(leads.createdAt)).limit(200);
}

async function getLead(id: string, contractorId: string): Promise<Lead | undefined> {
  const result = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
  return result[0];
}

async function createLead(lead: Omit<InsertLead, 'contractorId'>, contractorId: string): Promise<Lead> {
  const result = await db.insert(leads).values({ ...lead, contractorId }).returning();
  return result[0];
}

async function updateLead(id: string, lead: Partial<InsertLead>, contractorId: string): Promise<Lead | undefined> {
  const result = await db.update(leads)
    .set({ ...lead, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function deleteLead(id: string, contractorId: string): Promise<boolean> {
  const lead = await db.select({ contactId: leads.contactId })
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)))
    .limit(1);

  if (lead.length === 0) return false;

  const contactId = lead[0].contactId;

  // Delete the lead row first
  const result = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
  if ((result.rowCount ?? 0) === 0) return false;

  if (contactId) {
    // If the contact has no remaining leads, estimates, or jobs, delete the contact too
    const [remainingLeads, remainingEstimates, remainingJobs] = await Promise.all([
      db.select({ id: leads.id }).from(leads).where(and(eq(leads.contactId, contactId), eq(leads.contractorId, contractorId))).limit(1),
      db.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.contactId, contactId), eq(estimates.contractorId, contractorId))).limit(1),
      db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.contactId, contactId), eq(jobs.contractorId, contractorId))).limit(1),
    ]);
    if (remainingLeads.length === 0 && remainingEstimates.length === 0 && remainingJobs.length === 0) {
      await deleteContact(contactId, contractorId);
    }
  }

  return true;
}

async function archiveLead(id: string, contractorId: string): Promise<Lead | undefined> {
  const result = await db.update(leads)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)))
    .returning();
  return result[0];
}

async function restoreLead(id: string, contractorId: string): Promise<Lead | undefined> {
  const result = await db.update(leads)
    .set({ archived: false, updatedAt: new Date() })
    .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)))
    .returning();
  return result[0];
}

// deduplicateContacts — moved to server/services/contact-deduper.ts
// Imported above and re-exported via contactMethods.deduplicateContacts below.

// getDashboardMetrics / getMetricsAggregates / MetricsAggregates — moved to
// server/services/dashboard-metrics.ts and re-imported above.
// Re-exported via contactMethods below for backward-compatibility with callers
// that access them through the storage interface.

async function getContactsWithFollowUp(contractorId: string, limit = 200): Promise<Contact[]> {
  return db.select()
    .from(contacts)
    .where(and(
      eq(contacts.contractorId, contractorId),
      isNotNull(contacts.followUpDate)
    ))
    .orderBy(contacts.followUpDate)
    .limit(limit) as unknown as Contact[];
}

async function bulkCreateContacts(contactList: Array<Omit<InsertContact, 'contractorId'>>, contractorId: string): Promise<{ inserted: number }> {
  if (contactList.length === 0) return { inserted: 0 };
  const prepared = contactList.map(c => ({
    ...c,
    phones: c.phones ? normalizePhoneArrayForStorage(c.phones) : [],
    contractorId,
  }));
  const result = await db.insert(contacts).values(prepared).onConflictDoNothing().returning({ id: contacts.id });
  return { inserted: result.length };
}

async function getContactsWithCounts(contractorId: string, options: {
  search?: string;
  cursor?: string;
  limit?: number;
} = {}): Promise<{
  data: Array<Contact & { leadCount: number; estimateCount: number; jobCount: number }>;
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
}> {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [eq(contacts.contractorId, contractorId)];

  if (options.cursor) conditions.push(lte(contacts.createdAt, new Date(options.cursor)));
  if (options.search) {
    conditions.push(or(
      ilike(contacts.name, `%${options.search}%`),
      sql`EXISTS (SELECT 1 FROM unnest(${contacts.emails}) e WHERE e ILIKE ${`%${options.search}%`})`
    )!);
  }

  const [rows, totalResult] = await Promise.all([
    db.select({
      id: contacts.id,
      name: contacts.name,
      emails: contacts.emails,
      phones: contacts.phones,
      address: contacts.address,
      type: contacts.type,
      status: contacts.status,
      source: contacts.source,
      notes: contacts.notes,
      tags: contacts.tags,
      followUpDate: contacts.followUpDate,
      housecallProCustomerId: contacts.housecallProCustomerId,
      externalId: contacts.externalId,
      externalSource: contacts.externalSource,
      contractorId: contacts.contractorId,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      leadCount: sql<number>`(SELECT COUNT(*) FROM leads WHERE leads.contact_id = ${contacts.id} AND leads.contractor_id = ${contractorId})::int`,
      estimateCount: sql<number>`(SELECT COUNT(*) FROM estimates WHERE estimates.contact_id = ${contacts.id} AND estimates.contractor_id = ${contractorId})::int`,
      jobCount: sql<number>`(SELECT COUNT(*) FROM jobs WHERE jobs.contact_id = ${contacts.id} AND jobs.contractor_id = ${contractorId})::int`,
    })
    .from(contacts)
    .where(and(...conditions))
    .orderBy(desc(contacts.createdAt))
    .limit(limit + 1),

    db.select({ count: count() }).from(contacts).where(and(
      eq(contacts.contractorId, contractorId),
      options.search ? or(
        ilike(contacts.name, `%${options.search}%`),
        sql`EXISTS (SELECT 1 FROM unnest(${contacts.emails}) e WHERE e ILIKE ${`%${options.search}%`})`
      )! : sql`true`
    )),
  ]);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1].createdAt?.toISOString() ?? null : null;

  return {
    data: data as Array<Contact & { leadCount: number; estimateCount: number; jobCount: number }>,
    pagination: { total: totalResult[0]?.count ?? 0, hasMore, nextCursor },
  };
}

export const contactMethods = {
  getContacts,
  getLeadTrend,
  getContactsPaginated,
  getContactsCount,
  getContactsStatusCounts,
  getContact,
  getContactByExternalId,
  getContactByPhone,
  getContactByHousecallProCustomerId,
  createContact,
  bulkCreateContacts,
  updateContact,
  markContactContacted,
  deleteContact,
  unlinkOrphanedEmailActivities,
  findMatchingContact,
  getLeads,
  getLeadsByContact,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  archiveLead,
  restoreLead,
  deduplicateContacts,
  getDashboardMetrics,
  getMetricsAggregates,
  getContactsWithFollowUp,
  getContactsWithCounts,
};
