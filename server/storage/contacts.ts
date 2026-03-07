import {
  type Contact, type InsertContact,
  type Lead, type InsertLead,
  contacts, leads, messages, activities, estimates, jobs,
  contactStatusEnum,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, ne, gt, lte, gte, ilike, isNotNull, notInArray, inArray, sql, count } from "drizzle-orm";
import { normalizePhoneArrayForStorage } from "../utils/phone-normalizer";
import type { UpdateContact } from "../storage-types";

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

  const isLeadType = !options.type || options.type === 'lead';
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
  const normalizedPhone = digits.length > 10 ? digits.slice(-10) : digits;
  // The SQL subquery strips all non-digit characters from each stored phone number
  // then takes the last 10 digits (RIGHT(..., 10)) to drop any country-code prefix,
  // and compares against the already-normalized 10-digit input.  This lets "+1 (555)
  // 867-5309", "5558675309", and "15558675309" all match each other.
  const result = await db.select().from(contacts)
    .where(and(
      sql`EXISTS (
        SELECT 1 FROM unnest(${contacts.phones}) AS phone_num
        WHERE RIGHT(REGEXP_REPLACE(phone_num, '[^0-9]', '', 'g'), 10) = ${normalizedPhone}
      )`,
      eq(contacts.contractorId, contractorId)
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
  const normalizedContact = {
    ...contact,
    phones: contact.phones ? normalizePhoneArrayForStorage(contact.phones) : []
  };
  const result = await db.insert(contacts).values({ ...normalizedContact, contractorId }).returning();
  return result[0];
}

async function updateContact(id: string, contact: UpdateContact, contractorId: string): Promise<Contact | undefined> {
  const normalizedContact = {
    ...contact,
    ...(contact.phones && { phones: normalizePhoneArrayForStorage(contact.phones) })
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

    await tx.update(messages).set({ contactId: null }).where(and(
      eq(messages.contactId, id), eq(messages.contractorId, contractorId)
    ));
    await tx.delete(estimates).where(and(eq(estimates.contactId, id), eq(estimates.contractorId, contractorId)));
    await tx.delete(jobs).where(and(eq(jobs.contactId, id), eq(jobs.contractorId, contractorId)));
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
    // Strip formatting from the input phones and keep the last 10 digits of each.
    // The SQL does the same stripping on stored phones so any format variant matches.
    const normalizedPhones = phones.map(phone => {
      const digits = phone.replace(/\D/g, '');
      return digits.length > 10 ? digits.slice(-10) : digits;
    }).filter(p => p.length > 0);

    if (normalizedPhones.length > 0) {
      const phoneResult = await db.select({ id: contacts.id }).from(contacts).where(and(
        eq(contacts.contractorId, contractorId),
        sql`EXISTS (
          SELECT 1 FROM unnest(${contacts.phones}) AS contact_phone
          WHERE RIGHT(REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g'), 10) = ANY(ARRAY[${sql.join(normalizedPhones.map(p => sql`${p}`), sql`, `)}]::text[])
        )`
      )).limit(1);
      if (phoneResult.length > 0) return phoneResult[0].id;
    }
  }

  return null;
}

async function getLeads(contractorId: string): Promise<Lead[]> {
  return await db.select().from(leads).where(eq(leads.contractorId, contractorId)).orderBy(desc(leads.createdAt)).limit(1000);
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
  if (contactId) {
    return deleteContact(contactId, contractorId);
  }

  const result = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Detect and merge duplicate contacts for a contractor using a Union-Find algorithm.
 *
 * Memory note: This function fetches ALL contacts for the contractor into memory.
 * For contractors with tens of thousands of contacts this can be significant.
 * If deduplication becomes a performance bottleneck, consider:
 *   - Running it as an off-hours background job.
 *   - Processing contacts in chunks by creation date.
 *   - Moving the Union-Find logic into a stored procedure.
 *
 * The algorithm (Union-Find / Disjoint Set Union):
 *   - Each contact starts as its own "root".
 *   - Contacts that share a phone number or email address are unioned together.
 *   - Unions are transitive: if A shares a phone with B and B shares an email
 *     with C, all three end up in the same group.
 *   - The oldest contact in each group becomes the merge target (primary record).
 *   - Path compression keeps subsequent find() calls O(1) amortized.
 */
/**
 * Batch size for the deduplication contact loader.
 *
 * Contacts are fetched from the database in pages of DEDUP_BATCH_SIZE rows,
 * then accumulated into the in-memory Union-Find structure. This bounds the
 * single DB round-trip to ~DEDUP_BATCH_SIZE rows so the Node.js heap never
 * holds the entire contacts table for a large tenant.
 *
 * Trade-off: total DB round-trips = Math.ceil(contactCount / DEDUP_BATCH_SIZE).
 * For a tenant with 100k contacts at 2k per batch: 50 queries — still far safer
 * than one 100k-row query that can OOM the process.
 *
 * Medium-term migration path: move deduplication into SQL using a temp table
 * + Postgres MERGE so zero rows are loaded into JS heap at all.
 */
const DEDUP_BATCH_SIZE = 2_000;

// Safety ceiling for deduplication. The Union-Find graph is built entirely in
// Node.js heap memory, so very large tenants can OOM the process. This guard
// prevents that by refusing to run deduplication above the threshold and
// returning early with a clear error. The limit can be raised once the
// algorithm is migrated to a SQL-side MERGE / temp-table approach (see the
// DEDUP_BATCH_SIZE comment above for the migration path).
const DEDUP_MAX_CONTACTS = 50_000;

async function deduplicateContacts(contractorId: string): Promise<{ duplicatesFound: number; contactsMerged: number; contactsDeleted: number }> {
  console.log(`[deduplicateContacts] Starting deduplication for contractor: ${contractorId}`);

  // Pre-flight count check — bail early before loading any rows into memory
  const [countRow] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(contacts)
    .where(eq(contacts.contractorId, contractorId));
  const totalContacts = countRow?.total ?? 0;

  if (totalContacts > DEDUP_MAX_CONTACTS) {
    const msg = `[deduplicateContacts] Aborted: tenant has ${totalContacts} contacts which exceeds the in-memory deduplication limit of ${DEDUP_MAX_CONTACTS}. Migrate to SQL-side MERGE to lift this restriction.`;
    console.error(msg);
    throw new Error(`Contact deduplication is limited to ${DEDUP_MAX_CONTACTS} contacts. This tenant has ${totalContacts}.`);
  }

  const phoneToContacts = new Map<string, string[]>();
  const emailToContacts = new Map<string, string[]>();
  const contactById = new Map<string, Contact>();

  const normalizePhone = (phone: string): string => phone.replace(/\D/g, '').slice(-10);

  let offset = 0;
  let totalLoaded = 0;

  while (true) {
    const batch = await db
      .select()
      .from(contacts)
      .where(eq(contacts.contractorId, contractorId))
      .orderBy(contacts.createdAt)
      .limit(DEDUP_BATCH_SIZE)
      .offset(offset);

    if (batch.length === 0) break;

    for (const contact of batch) {
      contactById.set(contact.id, contact);
      contact.phones?.forEach((phone: string) => {
        const normalized = normalizePhone(phone);
        if (normalized.length >= 10) {
          const existing = phoneToContacts.get(normalized) || [];
          existing.push(contact.id);
          phoneToContacts.set(normalized, existing);
        }
      });
      contact.emails?.forEach((email: string) => {
        const normalized = email.toLowerCase().trim();
        if (normalized) {
          const existing = emailToContacts.get(normalized) || [];
          existing.push(contact.id);
          emailToContacts.set(normalized, existing);
        }
      });
    }

    totalLoaded += batch.length;
    offset += DEDUP_BATCH_SIZE;

    if (batch.length < DEDUP_BATCH_SIZE) break;
  }

  console.log(`[deduplicateContacts] Loaded ${totalLoaded} contacts across batches`);

  // Union-Find (Disjoint Set Union) algorithm for grouping duplicate contacts.
  //
  // Problem: two contacts are "duplicates" if they share any phone number or email,
  // even if they share different fields (A shares a phone with B; B shares an email
  // with C → A, B, C are all the same person).  A naive O(N²) pairwise comparison
  // would be too slow for large contractors.
  //
  // How it works:
  //   `parent` maps each contact ID to its group's representative (root) ID.
  //   Initially every contact is its own root (lazy-initialized in `find`).
  //
  //   `find(id)` — path-compressed lookup: follows parent pointers to the root,
  //   then flattens the chain so future lookups are O(1) amortized.
  //
  //   `union(id1, id2)` — merges two groups: finds both roots, and if they differ,
  //   makes the OLDER contact (by createdAt) the authoritative root so the earliest
  //   record is kept as the "primary" after merging.
  //
  // After all phone/email collisions are unioned, we group every contact by its root
  // to get the final duplicate clusters.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!)); // path compression
    }
    return parent.get(id)!;
  };
  const union = (id1: string, id2: string) => {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      const contact1 = contactById.get(root1)!;
      const contact2 = contactById.get(root2)!;
      // Keep the oldest contact as the group root (it becomes the merge target)
      if (contact1.createdAt <= contact2.createdAt) {
        parent.set(root2, root1);
      } else {
        parent.set(root1, root2);
      }
    }
  };

  for (const contactIds of Array.from(phoneToContacts.values())) {
    for (let i = 1; i < contactIds.length; i++) union(contactIds[0], contactIds[i]);
  }
  for (const contactIds of Array.from(emailToContacts.values())) {
    for (let i = 1; i < contactIds.length; i++) union(contactIds[0], contactIds[i]);
  }

  const groups = new Map<string, Contact[]>();
  for (const contact of Array.from(contactById.values())) {
    const root = find(contact.id);
    const group = groups.get(root) || [];
    group.push(contact);
    groups.set(root, group);
  }

  const contactGroups = new Map<string, Contact[]>();
  for (const [root, group] of Array.from(groups)) {
    if (group.length > 1) {
      group.sort((a: Contact, b: Contact) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      contactGroups.set(root, group);
    }
  }

  console.log(`[deduplicateContacts] Found ${contactGroups.size} groups of duplicates`);

  let contactsMerged = 0;
  let contactsDeleted = 0;

  const allDuplicateIds: string[] = [];

  await Promise.all(Array.from(contactGroups.entries()).map(async ([, duplicates]) => {
    const primary = duplicates[0];
    const duplicatesToMerge = duplicates.slice(1);
    if (duplicatesToMerge.length === 0) return;

    const duplicateIds = duplicatesToMerge.map(d => d.id);

    const allPhones = new Set<string>();
    const allEmails = new Set<string>();
    for (const contact of duplicates) {
      contact.phones?.forEach(phone => allPhones.add(phone));
      contact.emails?.forEach(email => allEmails.add(email.toLowerCase()));
    }

    await Promise.all([
      db.update(contacts).set({ phones: Array.from(allPhones), emails: Array.from(allEmails), updatedAt: new Date() }).where(eq(contacts.id, primary.id)),
      db.update(messages).set({ contactId: primary.id }).where(inArray(messages.contactId, duplicateIds)),
      db.update(activities).set({ contactId: primary.id }).where(inArray(activities.contactId, duplicateIds)),
      db.update(estimates).set({ contactId: primary.id }).where(inArray(estimates.contactId, duplicateIds)),
      db.update(jobs).set({ contactId: primary.id }).where(inArray(jobs.contactId, duplicateIds)),
    ]);

    allDuplicateIds.push(...duplicateIds);
    contactsDeleted += duplicateIds.length;
    contactsMerged++;
  }));

  if (allDuplicateIds.length > 0) {
    await db.delete(contacts).where(inArray(contacts.id, allDuplicateIds));
  }

  console.log(`[deduplicateContacts] Completed: ${contactsMerged} contacts merged, ${contactsDeleted} duplicates deleted`);
  return { duplicatesFound: contactGroups.size, contactsMerged, contactsDeleted };
}

async function getDashboardMetrics(contractorId: string, userId: string, userRole: string, startDate?: Date, endDate?: Date): Promise<{
  speedToLeadMinutes: number;
  setRate: number;
  totalLeads: number;
  todaysFollowUps: number;
}> {
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';

  const baseConditions = [eq(contacts.contractorId, contractorId), eq(contacts.type, 'lead')];
  if (startDate) baseConditions.push(gte(contacts.createdAt, startDate));
  if (endDate) baseConditions.push(lte(contacts.createdAt, endDate));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [metricsRow] = await db.select({
    totalLeads: sql<number>`COUNT(*)::int`,
    scheduledAll: sql<number>`COUNT(*) FILTER (WHERE ${contacts.status} = 'scheduled')::int`,
    scheduledByUser: sql<number>`COUNT(*) FILTER (WHERE ${contacts.status} = 'scheduled' AND ${contacts.scheduledByUserId} = ${userId})::int`,
    touchedByUser: sql<number>`COUNT(*) FILTER (WHERE ${contacts.contactedByUserId} = ${userId} OR ${contacts.scheduledByUserId} = ${userId})::int`,
    speedToLeadAll: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${contacts.contactedAt} - ${contacts.createdAt})) / 60.0) FILTER (WHERE ${contacts.contactedAt} IS NOT NULL), 0)::float`,
    speedToLeadUser: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${contacts.contactedAt} - ${contacts.createdAt})) / 60.0) FILTER (WHERE ${contacts.contactedAt} IS NOT NULL AND ${contacts.contactedByUserId} = ${userId}), 0)::float`,
    todaysFollowUps: sql<number>`COUNT(*) FILTER (WHERE ${contacts.followUpDate} >= ${today} AND ${contacts.followUpDate} < ${tomorrow})::int`,
  }).from(contacts).where(and(...baseConditions));

  const totalLeads = metricsRow?.totalLeads ?? 0;
  const speedToLeadMinutes = isAdmin
    ? (metricsRow?.speedToLeadAll ?? 0)
    : (metricsRow?.speedToLeadUser ?? 0);

  const scheduledCount = isAdmin
    ? (metricsRow?.scheduledAll ?? 0)
    : (metricsRow?.scheduledByUser ?? 0);
  const denominatorCount = isAdmin
    ? totalLeads
    : (metricsRow?.touchedByUser ?? 0);
  const setRate = denominatorCount > 0 ? (scheduledCount / denominatorCount) * 100 : 0;

  return {
    speedToLeadMinutes: Math.round(speedToLeadMinutes * 10) / 10,
    setRate: Math.round(setRate * 10) / 10,
    totalLeads,
    todaysFollowUps: metricsRow?.todaysFollowUps ?? 0,
  };
}

export interface MetricsAggregates {
  totalLeads: number;
  contactedLeads: number;
  avgSpeedToLeadHours: number;
  scheduledLeads: number;
  totalEstimates: number;
  completedJobs: number;
  revenue: number;
}

async function getMetricsAggregates(contractorId: string, periodStart: Date): Promise<MetricsAggregates> {
  const [leadRow] = await db.select({
    totalLeads: sql<number>`COUNT(*)::int`,
    contactedLeads: sql<number>`COUNT(${contacts.contactedAt})::int`,
    avgSpeedToLeadHours: sql<number>`COALESCE(
      AVG(EXTRACT(EPOCH FROM (${contacts.contactedAt} - ${contacts.createdAt})) / 3600.0)
        FILTER (WHERE ${contacts.contactedAt} IS NOT NULL), 0
    )::float`,
    scheduledLeads: sql<number>`COUNT(*) FILTER (WHERE ${contacts.isScheduled} = true)::int`,
  })
    .from(contacts)
    .where(and(
      eq(contacts.contractorId, contractorId),
      eq(contacts.type, 'lead'),
      gte(contacts.createdAt, periodStart)
    ));

  const [estimateRow] = await db.select({
    totalEstimates: sql<number>`COUNT(*)::int`,
  })
    .from(estimates)
    .where(and(
      eq(estimates.contractorId, contractorId),
      gte(estimates.createdAt, periodStart)
    ));

  const [jobRow] = await db.select({
    completedJobs: sql<number>`COUNT(*)::int`,
    revenue: sql<number>`COALESCE(SUM(${jobs.value}::numeric), 0)::float`,
  })
    .from(jobs)
    .where(and(
      eq(jobs.contractorId, contractorId),
      eq(jobs.status, 'completed'),
      gte(jobs.createdAt, periodStart)
    ));

  return {
    totalLeads: leadRow?.totalLeads ?? 0,
    contactedLeads: leadRow?.contactedLeads ?? 0,
    avgSpeedToLeadHours: leadRow?.avgSpeedToLeadHours ?? 0,
    scheduledLeads: leadRow?.scheduledLeads ?? 0,
    totalEstimates: estimateRow?.totalEstimates ?? 0,
    completedJobs: jobRow?.completedJobs ?? 0,
    revenue: jobRow?.revenue ?? 0,
  };
}

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
  deduplicateContacts,
  getDashboardMetrics,
  getMetricsAggregates,
  getContactsWithFollowUp,
};
