import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, desc, asc } from 'drizzle-orm';
import {
  users,
  tenants,
  customers,
  jobs,
  leads,
  estimates,
  messages,
  templates,
  calls,
  tenantCredentials,
  tenantProviders,
  type User,
  type Tenant,
  type Customer,
  type Job,
  type Lead,
  type Estimate,
  type Message,
  type Template,
  type Call,
  type TenantCredential,
  type TenantProvider,
  type InsertUser,
  type InsertTenant,
  type InsertCustomer,
  type InsertJob,
  type InsertLead,
  type InsertEstimate,
  type InsertMessage,
  type InsertTemplate,
  type InsertCall,
  type InsertTenantCredential,
  type InsertTenantProvider,
} from '../shared/schema-d1';

// Interface for D1 environment
export interface D1Env {
  DB: any; // D1Database type will be available at runtime
}

export interface IStorage {
  // Users
  createUser(userData: InsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  getUsersByTenant(tenantId: string): Promise<User[]>;
  updateUser(id: string, userData: Partial<InsertUser>): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;

  // Tenants
  createTenant(tenantData: InsertTenant): Promise<Tenant>;
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantByDomain(domain: string): Promise<Tenant | null>;
  getAllTenants(): Promise<Tenant[]>;
  updateTenant(id: string, tenantData: Partial<InsertTenant>): Promise<Tenant | null>;
  deleteTenant(id: string): Promise<boolean>;

  // Customers
  createCustomer(customerData: InsertCustomer, tenantId: string): Promise<Customer>;
  getCustomers(tenantId: string): Promise<Customer[]>;
  getCustomerById(id: string, tenantId: string): Promise<Customer | null>;
  updateCustomer(id: string, customerData: Partial<InsertCustomer>, tenantId: string): Promise<Customer | null>;
  deleteCustomer(id: string, tenantId: string): Promise<boolean>;

  // Jobs
  createJob(jobData: InsertJob, tenantId: string): Promise<Job>;
  getJobs(tenantId: string): Promise<Job[]>;
  getJobById(id: string, tenantId: string): Promise<Job | null>;
  updateJob(id: string, jobData: Partial<InsertJob>, tenantId: string): Promise<Job | null>;
  deleteJob(id: string, tenantId: string): Promise<boolean>;

  // Leads
  createLead(leadData: InsertLead, tenantId: string): Promise<Lead>;
  getLeads(tenantId: string): Promise<Lead[]>;
  getLeadById(id: string, tenantId: string): Promise<Lead | null>;
  updateLead(id: string, leadData: Partial<InsertLead>, tenantId: string): Promise<Lead | null>;
  deleteLead(id: string, tenantId: string): Promise<boolean>;

  // Estimates
  createEstimate(estimateData: InsertEstimate, tenantId: string): Promise<Estimate>;
  getEstimates(tenantId: string): Promise<Estimate[]>;
  getEstimateById(id: string, tenantId: string): Promise<Estimate | null>;
  updateEstimate(id: string, estimateData: Partial<InsertEstimate>, tenantId: string): Promise<Estimate | null>;
  deleteEstimate(id: string, tenantId: string): Promise<boolean>;

  // Messages
  createMessage(messageData: InsertMessage, tenantId: string): Promise<Message>;
  getMessages(tenantId: string, filters?: { leadId?: string; customerId?: string; estimateId?: string }): Promise<Message[]>;
  getMessageById(id: string, tenantId: string): Promise<Message | null>;
  updateMessage(id: string, messageData: Partial<InsertMessage>, tenantId: string): Promise<Message | null>;
  deleteMessage(id: string, tenantId: string): Promise<boolean>;

  // Templates
  createTemplate(templateData: InsertTemplate, tenantId: string): Promise<Template>;
  getTemplates(tenantId: string, type?: 'text' | 'email'): Promise<Template[]>;
  getTemplate(id: string, tenantId: string): Promise<Template | null>;
  updateTemplate(id: string, templateData: Partial<InsertTemplate>, tenantId: string): Promise<Template | null>;
  deleteTemplate(id: string, tenantId: string): Promise<boolean>;

  // Calls
  createCall(callData: InsertCall, tenantId: string): Promise<Call>;
  getCalls(tenantId: string): Promise<Call[]>;
  getCallById(id: string, tenantId: string): Promise<Call | null>;
  getCallByExternalId(externalCallId: string, tenantId: string): Promise<Call | null>;
  updateCall(id: string, callData: Partial<InsertCall>, tenantId: string): Promise<Call | null>;
  deleteCall(id: string, tenantId: string): Promise<boolean>;

  // Tenant Credentials
  createTenantCredential(credentialData: InsertTenantCredential): Promise<TenantCredential>;
  getTenantCredentials(tenantId: string, service?: string): Promise<TenantCredential[]>;
  getTenantCredential(tenantId: string, service: string, credentialKey: string): Promise<TenantCredential | null>;
  updateTenantCredential(id: string, credentialData: Partial<InsertTenantCredential>): Promise<TenantCredential | null>;
  deleteTenantCredential(id: string): Promise<boolean>;

  // Tenant Providers
  createTenantProvider(providerData: InsertTenantProvider): Promise<TenantProvider>;
  getTenantProviders(tenantId: string): Promise<TenantProvider[]>;
  getTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling'): Promise<TenantProvider | null>;
  setTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<TenantProvider>;
  disableTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling'): Promise<boolean>;
}

export class D1Storage implements IStorage {
  private db: ReturnType<typeof drizzle>;

  constructor(d1Database: any) { // D1Database type will be available at runtime
    this.db = drizzle(d1Database);
  }

  // Users
  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await this.db.insert(users).values(userData).returning();
    return user;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const user = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return user[0] || null;
  }

  async getUserById(id: string): Promise<User | null> {
    const user = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user[0] || null;
  }

  async getUsersByTenant(tenantId: string): Promise<User[]> {
    return await this.db.select().from(users).where(eq(users.tenantId, tenantId));
  }

  async updateUser(id: string, userData: Partial<InsertUser>): Promise<User | null> {
    const [user] = await this.db.update(users).set(userData).where(eq(users.id, id)).returning();
    return user || null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.db.delete(users).where(eq(users.id, id));
    return result.success;
  }

  // Tenants
  async createTenant(tenantData: InsertTenant): Promise<Tenant> {
    const [tenant] = await this.db.insert(tenants).values(tenantData).returning();
    return tenant;
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const tenant = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return tenant[0] || null;
  }

  async getTenantByDomain(domain: string): Promise<Tenant | null> {
    const tenant = await this.db.select().from(tenants).where(eq(tenants.domain, domain)).limit(1);
    return tenant[0] || null;
  }

  async getAllTenants(): Promise<Tenant[]> {
    return await this.db.select().from(tenants);
  }

  async updateTenant(id: string, tenantData: Partial<InsertTenant>): Promise<Tenant | null> {
    const [tenant] = await this.db.update(tenants).set(tenantData).where(eq(tenants.id, id)).returning();
    return tenant || null;
  }

  async deleteTenant(id: string): Promise<boolean> {
    const result = await this.db.delete(tenants).where(eq(tenants.id, id));
    return result.success;
  }

  // Customers
  async createCustomer(customerData: InsertCustomer, tenantId: string): Promise<Customer> {
    const [customer] = await this.db.insert(customers).values({ ...customerData, tenantId }).returning();
    return customer;
  }

  async getCustomers(tenantId: string): Promise<Customer[]> {
    return await this.db.select().from(customers).where(eq(customers.tenantId, tenantId)).orderBy(desc(customers.createdAt));
  }

  async getCustomerById(id: string, tenantId: string): Promise<Customer | null> {
    const customer = await this.db.select().from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .limit(1);
    return customer[0] || null;
  }

  async updateCustomer(id: string, customerData: Partial<InsertCustomer>, tenantId: string): Promise<Customer | null> {
    const [customer] = await this.db.update(customers)
      .set({ ...customerData, updatedAt: new Date().toISOString() })
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .returning();
    return customer || null;
  }

  async deleteCustomer(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
    return result.success;
  }

  // Jobs
  async createJob(jobData: InsertJob, tenantId: string): Promise<Job> {
    const [job] = await this.db.insert(jobs).values({ ...jobData, tenantId }).returning();
    return job;
  }

  async getJobs(tenantId: string): Promise<Job[]> {
    return await this.db.select().from(jobs).where(eq(jobs.tenantId, tenantId)).orderBy(desc(jobs.createdAt));
  }

  async getJobById(id: string, tenantId: string): Promise<Job | null> {
    const job = await this.db.select().from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.tenantId, tenantId)))
      .limit(1);
    return job[0] || null;
  }

  async updateJob(id: string, jobData: Partial<InsertJob>, tenantId: string): Promise<Job | null> {
    const [job] = await this.db.update(jobs)
      .set({ ...jobData, updatedAt: new Date().toISOString() })
      .where(and(eq(jobs.id, id), eq(jobs.tenantId, tenantId)))
      .returning();
    return job || null;
  }

  async deleteJob(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.tenantId, tenantId)));
    return result.success;
  }

  // Leads
  async createLead(leadData: InsertLead, tenantId: string): Promise<Lead> {
    const [lead] = await this.db.insert(leads).values({ ...leadData, tenantId }).returning();
    return lead;
  }

  async getLeads(tenantId: string): Promise<Lead[]> {
    return await this.db.select().from(leads).where(eq(leads.tenantId, tenantId)).orderBy(desc(leads.createdAt));
  }

  async getLeadById(id: string, tenantId: string): Promise<Lead | null> {
    const lead = await this.db.select().from(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
      .limit(1);
    return lead[0] || null;
  }

  async updateLead(id: string, leadData: Partial<InsertLead>, tenantId: string): Promise<Lead | null> {
    const [lead] = await this.db.update(leads)
      .set({ ...leadData, updatedAt: new Date().toISOString() })
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
      .returning();
    return lead || null;
  }

  async deleteLead(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));
    return result.success;
  }

  // Estimates
  async createEstimate(estimateData: InsertEstimate, tenantId: string): Promise<Estimate> {
    const [estimate] = await this.db.insert(estimates).values({ ...estimateData, tenantId }).returning();
    return estimate;
  }

  async getEstimates(tenantId: string): Promise<Estimate[]> {
    return await this.db.select().from(estimates).where(eq(estimates.tenantId, tenantId)).orderBy(desc(estimates.createdAt));
  }

  async getEstimateById(id: string, tenantId: string): Promise<Estimate | null> {
    const estimate = await this.db.select().from(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.tenantId, tenantId)))
      .limit(1);
    return estimate[0] || null;
  }

  async updateEstimate(id: string, estimateData: Partial<InsertEstimate>, tenantId: string): Promise<Estimate | null> {
    const [estimate] = await this.db.update(estimates)
      .set({ ...estimateData, updatedAt: new Date().toISOString() })
      .where(and(eq(estimates.id, id), eq(estimates.tenantId, tenantId)))
      .returning();
    return estimate || null;
  }

  async deleteEstimate(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.tenantId, tenantId)));
    return result.success;
  }

  // Messages
  async createMessage(messageData: InsertMessage, tenantId: string): Promise<Message> {
    const [message] = await this.db.insert(messages).values({ ...messageData, tenantId }).returning();
    return message;
  }

  async getMessages(tenantId: string, filters?: { leadId?: string; customerId?: string; estimateId?: string }): Promise<Message[]> {
    let whereClause: any = eq(messages.tenantId, tenantId);
    
    if (filters) {
      if (filters.leadId) {
        whereClause = and(whereClause, eq(messages.leadId, filters.leadId)!);
      }
      if (filters.customerId) {
        whereClause = and(whereClause, eq(messages.customerId, filters.customerId)!);
      }
      if (filters.estimateId) {
        whereClause = and(whereClause, eq(messages.estimateId, filters.estimateId)!);
      }
    }

    return await this.db.select().from(messages).where(whereClause).orderBy(desc(messages.createdAt));
  }

  async getMessageById(id: string, tenantId: string): Promise<Message | null> {
    const message = await this.db.select().from(messages)
      .where(and(eq(messages.id, id), eq(messages.tenantId, tenantId)))
      .limit(1);
    return message[0] || null;
  }

  async updateMessage(id: string, messageData: Partial<InsertMessage>, tenantId: string): Promise<Message | null> {
    const [message] = await this.db.update(messages)
      .set(messageData)
      .where(and(eq(messages.id, id), eq(messages.tenantId, tenantId)))
      .returning();
    return message || null;
  }

  async deleteMessage(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(messages)
      .where(and(eq(messages.id, id), eq(messages.tenantId, tenantId)));
    return result.success;
  }

  // Templates
  async createTemplate(templateData: InsertTemplate, tenantId: string): Promise<Template> {
    const [template] = await this.db.insert(templates).values({ ...templateData, tenantId }).returning();
    return template;
  }

  async getTemplates(tenantId: string, type?: 'text' | 'email'): Promise<Template[]> {
    let whereClause: any = eq(templates.tenantId, tenantId);
    if (type) {
      whereClause = and(whereClause, eq(templates.type, type)!);
    }
    return await this.db.select().from(templates).where(whereClause).orderBy(asc(templates.title));
  }

  async getTemplate(id: string, tenantId: string): Promise<Template | null> {
    const template = await this.db.select().from(templates)
      .where(and(eq(templates.id, id), eq(templates.tenantId, tenantId)))
      .limit(1);
    return template[0] || null;
  }

  async updateTemplate(id: string, templateData: Partial<InsertTemplate>, tenantId: string): Promise<Template | null> {
    const [template] = await this.db.update(templates)
      .set({ ...templateData, updatedAt: new Date().toISOString() })
      .where(and(eq(templates.id, id), eq(templates.tenantId, tenantId)))
      .returning();
    return template || null;
  }

  async deleteTemplate(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(templates)
      .where(and(eq(templates.id, id), eq(templates.tenantId, tenantId)));
    return result.success;
  }

  // Calls
  async createCall(callData: InsertCall, tenantId: string): Promise<Call> {
    const [call] = await this.db.insert(calls).values({ ...callData, tenantId }).returning();
    return call;
  }

  async getCalls(tenantId: string): Promise<Call[]> {
    return await this.db.select().from(calls).where(eq(calls.tenantId, tenantId)).orderBy(desc(calls.createdAt));
  }

  async getCallById(id: string, tenantId: string): Promise<Call | null> {
    const call = await this.db.select().from(calls)
      .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
      .limit(1);
    return call[0] || null;
  }

  async getCallByExternalId(externalCallId: string, tenantId: string): Promise<Call | null> {
    const call = await this.db.select().from(calls)
      .where(and(eq(calls.externalCallId, externalCallId), eq(calls.tenantId, tenantId)))
      .limit(1);
    return call[0] || null;
  }

  async updateCall(id: string, callData: Partial<InsertCall>, tenantId: string): Promise<Call | null> {
    const [call] = await this.db.update(calls)
      .set({ ...callData, updatedAt: new Date().toISOString() })
      .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)))
      .returning();
    return call || null;
  }

  async deleteCall(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db.delete(calls)
      .where(and(eq(calls.id, id), eq(calls.tenantId, tenantId)));
    return result.success;
  }

  // Tenant Credentials
  async createTenantCredential(credentialData: InsertTenantCredential): Promise<TenantCredential> {
    const [credential] = await this.db.insert(tenantCredentials).values(credentialData).returning();
    return credential;
  }

  async getTenantCredentials(tenantId: string, service?: string): Promise<TenantCredential[]> {
    let whereClause: any = eq(tenantCredentials.tenantId, tenantId);
    if (service) {
      whereClause = and(whereClause, eq(tenantCredentials.service, service)!);
    }
    return await this.db.select().from(tenantCredentials).where(whereClause);
  }

  async getTenantCredential(tenantId: string, service: string, credentialKey: string): Promise<TenantCredential | null> {
    const credential = await this.db.select().from(tenantCredentials)
      .where(and(
        eq(tenantCredentials.tenantId, tenantId),
        eq(tenantCredentials.service, service),
        eq(tenantCredentials.credentialKey, credentialKey)
      ))
      .limit(1);
    return credential[0] || null;
  }

  async updateTenantCredential(id: string, credentialData: Partial<InsertTenantCredential>): Promise<TenantCredential | null> {
    const [credential] = await this.db.update(tenantCredentials)
      .set({ ...credentialData, updatedAt: new Date().toISOString() })
      .where(eq(tenantCredentials.id, id))
      .returning();
    return credential || null;
  }

  async deleteTenantCredential(id: string): Promise<boolean> {
    const result = await this.db.delete(tenantCredentials).where(eq(tenantCredentials.id, id));
    return result.success;
  }

  // Tenant Providers
  async createTenantProvider(providerData: InsertTenantProvider): Promise<TenantProvider> {
    const [provider] = await this.db.insert(tenantProviders).values(providerData).returning();
    return provider;
  }

  async getTenantProviders(tenantId: string): Promise<TenantProvider[]> {
    return await this.db.select().from(tenantProviders).where(eq(tenantProviders.tenantId, tenantId));
  }

  async getTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling'): Promise<TenantProvider | null> {
    const provider = await this.db.select().from(tenantProviders)
      .where(and(eq(tenantProviders.tenantId, tenantId), eq(tenantProviders.providerType, providerType)))
      .limit(1);
    return provider[0] || null;
  }

  async setTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<TenantProvider> {
    // Check if provider already exists
    const existing = await this.getTenantProvider(tenantId, providerType);
    
    const providerData: InsertTenantProvider = {
      tenantId,
      providerType,
      emailProvider: providerType === 'email' ? providerName as any : null,
      smsProvider: providerType === 'sms' ? providerName as any : null,
      callingProvider: providerType === 'calling' ? providerName as any : null,
      isActive: true,
    };

    if (existing) {
      // Update existing
      const [updated] = await this.db.update(tenantProviders)
        .set({ ...providerData, updatedAt: new Date().toISOString() })
        .where(eq(tenantProviders.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new
      const [created] = await this.db.insert(tenantProviders).values(providerData).returning();
      return created;
    }
  }

  async disableTenantProvider(tenantId: string, providerType: 'email' | 'sms' | 'calling'): Promise<boolean> {
    const result = await this.db.update(tenantProviders)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(and(eq(tenantProviders.tenantId, tenantId), eq(tenantProviders.providerType, providerType)));
    return result.success;
  }
}

// Initialize storage with D1 database
export function createD1Storage(d1Database: any): IStorage {
  return new D1Storage(d1Database);
}