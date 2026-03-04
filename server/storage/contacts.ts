import {
  type Contact, type InsertContact,
  type Lead, type InsertLead,
  contacts, leads, messages, activities, estimates, jobs, users,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, desc, ne, gt, lte, gte, lt, ilike, isNotNull, sql, count } from "drizzle-orm";
import { normalizePhoneArrayForStorage } from "../utils/phone-normalizer";
import type { UpdateContact } from "../storage-types";

type PaginatedContacts = {
  data: any[];
  pagination: { total: number; hasMore: boolean; nextCursor: string | null };
};

async function getContacts(contractorId: string, type?: 'lead' | 'customer' | 'inactive'): Promise<Contact[]> {
  const conditions = [eq(contacts.contractorId, contractorId)];
  if (type) conditions.push(eq(contacts.type, type));
  return await db.select().from(contacts).where(and(...conditions)).orderBy(desc(contacts.createdAt));
}

async function getContactsPaginated(contractorId: string, options: {
  cursor?: string;
  limit?: number;
  type?: 'lead' | 'customer' | 'inactive';
  status?: string;
  search?: string;
} = {}): Promise<PaginatedContacts> {
  const limit = Math.min(options.limit || 50, 100);
  const conditions = [eq(contacts.contractorId, contractorId)];

  if (options.cursor) {
    conditions.push(gt(contacts.createdAt, new Date(options.cursor)));
  }
  if (options.type) {
    conditions.push(eq(contacts.type, options.type));
  }
  if (options.status && options.status !== 'all') {
    conditions.push(eq(contacts.status, options.status as any));
  } else if (!options.status || options.status === 'all') {
    if (!options.type || options.type === 'lead') {
      conditions.push(ne(contacts.status, 'disqualified'));
      conditions.push(ne(contacts.status, 'scheduled'));
    }
  }
  if (options.search) {
    conditions.push(or(
      ilike(contacts.name, `%${options.search}%`),
      ilike(contacts.address, `%${options.search}%`),
      ilike(contacts.source, `%${options.search}%`)
    )!);
  }

  const contactsData = await db.select({
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
  .limit(limit + 1);

  const hasMore = contactsData.length > limit;
  if (hasMore) contactsData.pop();

  const nextCursor = hasMore && contactsData.length > 0
    ? contactsData[contactsData.length - 1].createdAt.toISOString()
    : null;

  const total = await getContactsCount(contractorId, {
    type: options.type,
    status: options.status,
    search: options.search,
  });

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
    conditions.push(eq(contacts.status, options.status as any));
  } else if (!options.status || options.status === 'all') {
    if (!options.type || options.type === 'lead') {
      conditions.push(ne(contacts.status, 'disqualified'));
      conditions.push(ne(contacts.status, 'scheduled'));
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

    await tx.update(messages as any).set({ contactId: null }).where(and(
      eq((messages as any).contactId, id), eq((messages as any).contractorId, contractorId)
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

  const lowerCurrentEmails = currentEmails.map(e => e.toLowerCase());
  for (const activity of emailActivities) {
    if (!activity.metadata) continue;
    try {
      const meta = JSON.parse(activity.metadata);
      const fromEmail = (meta.from || '').toLowerCase();
      const toEmails: string[] = (meta.to || []).map((e: string) => e.toLowerCase());
      const allEmails = [fromEmail, ...toEmails];
      const stillMatches = allEmails.some(e => lowerCurrentEmails.includes(e));
      if (!stillMatches) {
        await db.update(activities).set({ contactId: null }).where(eq(activities.id, activity.id));
      }
    } catch {
      // Skip unparseable metadata
    }
  }
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
  return await db.select().from(leads).where(eq(leads.contractorId, contractorId)).orderBy(desc(leads.createdAt));
}

async function getLeadsByContact(contactId: string, contractorId: string): Promise<Lead[]> {
  return await db.select().from(leads).where(and(
    eq(leads.contactId, contactId),
    eq(leads.contractorId, contractorId)
  )).orderBy(desc(leads.createdAt));
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
  const result = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
  return (result.rowCount ?? 0) > 0;
}

async function deduplicateContacts(contractorId: string): Promise<{ duplicatesFound: number; contactsMerged: number; contactsDeleted: number }> {
  console.log(`[deduplicateContacts] Starting deduplication for contractor: ${contractorId}`);
  const allContacts = await db.select().from(contacts).where(eq(contacts.contractorId, contractorId)).orderBy(contacts.createdAt);
  console.log(`[deduplicateContacts] Found ${allContacts.length} total contacts`);

  const phoneToContacts = new Map<string, string[]>();
  const emailToContacts = new Map<string, string[]>();
  const contactById = new Map<string, Contact>();

  const normalizePhone = (phone: string): string => phone.replace(/\D/g, '').slice(-10);

  for (const contact of allContacts) {
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

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  };
  const union = (id1: string, id2: string) => {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      const contact1 = contactById.get(root1)!;
      const contact2 = contactById.get(root2)!;
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
  for (const contact of allContacts) {
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

  for (const [, duplicates] of Array.from(contactGroups.entries())) {
    const primary = duplicates[0];
    const duplicatesToMerge = duplicates.slice(1);
    console.log(`[deduplicateContacts] Merging ${duplicatesToMerge.length} duplicates into primary: ${primary.id} (${primary.name})`);

    const allPhones = new Set<string>();
    const allEmails = new Set<string>();
    for (const contact of duplicates) {
      contact.phones?.forEach(phone => allPhones.add(phone));
      contact.emails?.forEach(email => allEmails.add(email.toLowerCase()));
    }

    await db.update(contacts).set({ phones: Array.from(allPhones), emails: Array.from(allEmails), updatedAt: new Date() }).where(eq(contacts.id, primary.id));

    for (const duplicate of duplicatesToMerge) {
      console.log(`[deduplicateContacts] Updating references from ${duplicate.id} to ${primary.id}`);
      await db.update(messages as any).set({ contactId: primary.id }).where(eq((messages as any).contactId, duplicate.id));
      await db.update(activities).set({ contactId: primary.id }).where(eq(activities.contactId, duplicate.id));
      await db.update(estimates).set({ contactId: primary.id }).where(eq(estimates.contactId, duplicate.id));
      await db.update(jobs).set({ contactId: primary.id }).where(eq(jobs.contactId, duplicate.id));
      await db.delete(contacts).where(eq(contacts.id, duplicate.id));
      contactsDeleted++;
    }
    contactsMerged++;
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
  const conditions = [eq(contacts.contractorId, contractorId), eq(contacts.type, 'lead')];
  if (startDate) conditions.push(gte(contacts.createdAt, startDate));
  if (endDate) conditions.push(lte(contacts.createdAt, endDate));

  const allLeads = await db.select().from(contacts).where(and(...conditions));
  const totalLeads = allLeads.length;
  const contactedLeads = allLeads.filter(contact => contact.contactedAt !== null);

  let speedToLeadMinutes = 0;
  if (contactedLeads.length > 0) {
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    const relevantLeads = isAdmin
      ? contactedLeads
      : contactedLeads.filter(contact => contact.contactedByUserId === userId);

    if (relevantLeads.length > 0) {
      const totalMinutes = relevantLeads.reduce((sum, contact) => {
        if (contact.contactedAt && contact.createdAt) {
          const diff = contact.contactedAt.getTime() - contact.createdAt.getTime();
          return sum + (diff / (1000 * 60));
        }
        return sum;
      }, 0);
      speedToLeadMinutes = totalMinutes / relevantLeads.length;
    }
  }

  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const scheduledLeadsForUser = isAdmin
    ? allLeads.filter(contact => contact.status === 'scheduled')
    : allLeads.filter(contact => contact.status === 'scheduled' && contact.scheduledByUserId === userId);

  const totalLeadsForUser = isAdmin ? totalLeads : allLeads.filter(contact =>
    contact.contactedByUserId === userId || contact.scheduledByUserId === userId
  ).length;

  const setRate = totalLeadsForUser > 0 ? (scheduledLeadsForUser.length / totalLeadsForUser) * 100 : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const allLeadsForFollowUp = await db.select().from(contacts).where(and(
    eq(contacts.contractorId, contractorId),
    eq(contacts.type, 'lead'),
    gte(contacts.followUpDate, today),
    lt(contacts.followUpDate, tomorrow)
  ));

  return {
    speedToLeadMinutes: Math.round(speedToLeadMinutes * 10) / 10,
    setRate: Math.round(setRate * 10) / 10,
    totalLeads,
    todaysFollowUps: allLeadsForFollowUp.length,
  };
}

export const contactMethods = {
  getContacts,
  getContactsPaginated,
  getContactsCount,
  getContactsStatusCounts,
  getContact,
  getContactByExternalId,
  getContactByPhone,
  getContactByHousecallProCustomerId,
  createContact,
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
};
