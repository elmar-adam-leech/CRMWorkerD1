import { 
  type User, type InsertUser,
  type UserContractor, type InsertUserContractor,
  type Contractor, type InsertContractor,
  type Contact, type InsertContact,
  type ContactSummary, type PaginatedContacts,
  type Lead, type InsertLead,
  type Job, type InsertJob,
  type JobSummary, type PaginatedJobs,
  type Estimate, type InsertEstimate,
  type EstimateSummary, type PaginatedEstimates,
  type Message, type InsertMessage,
  type Template, type InsertTemplate,
  type Call, type InsertCall,
  type ContractorCredential, type InsertContractorCredential,
  type ContractorProvider, type InsertContractorProvider,
  type ContractorIntegration, type InsertContractorIntegration,
  type Employee, type InsertEmployee, type UpdateEmployeeRoles,
  type Activity, type InsertActivity,
  type BusinessTargets, type InsertBusinessTargets,
  type DialpadPhoneNumber, type InsertDialpadPhoneNumber,
  type UserPhoneNumberPermission, type InsertUserPhoneNumberPermission,
  type DialpadUser, type InsertDialpadUser,
  type DialpadDepartment, type InsertDialpadDepartment,
  type DialpadSyncJob, type InsertDialpadSyncJob,
  type SyncSchedule, type InsertSyncSchedule,
  type TerminologySettings, type InsertTerminologySettings,
  type Notification, type InsertNotification,
  type Workflow, type InsertWorkflow,
  type WorkflowStep, type InsertWorkflowStep,
  type WorkflowExecution, type InsertWorkflowExecution,
  users, userContractors, contractors, contacts, leads, jobs, estimates, messages, templates, calls, contractorCredentials, contractorProviders, contractorIntegrations, employees, activities, businessTargets, dialpadPhoneNumbers, userPhoneNumberPermissions, dialpadUsers, dialpadDepartments, dialpadSyncJobs, syncSchedules, terminologySettings, notifications, workflows, workflowSteps, workflowExecutions
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, and, or, sql, desc, asc, like, ilike, gt, gte, lt, lte, count, isNull, isNotNull, inArray } from "drizzle-orm";
import bcrypt from "bcrypt";
import { normalizePhoneForStorage, normalizePhoneArrayForStorage } from "./utils/phone-normalizer";

// Safe update types that exclude restricted fields
export type UpdateUser = Omit<Partial<InsertUser>, 'contractorId'>;
export type UpdateContractor = Partial<InsertContractor>;
export type UpdateContact = Omit<Partial<InsertContact>, 'contractorId'>;
export type UpdateJob = Omit<Partial<InsertJob>, 'contractorId' | 'contactId'>;
export type UpdateEstimate = Omit<Partial<InsertEstimate>, 'contractorId' | 'contactId'>;
export type UpdateMessage = Omit<Partial<InsertMessage>, 'contractorId'>;
export type UpdateTemplate = Omit<Partial<InsertTemplate>, 'contractorId'>;
export type UpdateCall = Omit<Partial<InsertCall>, 'contractorId' | 'externalCallId'>;
export type UpdateContractorCredential = Omit<Partial<InsertContractorCredential>, 'contractorId' | 'service' | 'credentialKey'>;
export type UpdateContractorProvider = Omit<Partial<InsertContractorProvider>, 'contractorId' | 'providerType'>;
export type UpdateContractorIntegration = Omit<Partial<InsertContractorIntegration>, 'contractorId' | 'integrationName'>;
export type UpdateEmployee = Omit<Partial<InsertEmployee>, 'contractorId' | 'externalSource' | 'externalId'>;
export type UpdateActivity = Omit<Partial<InsertActivity>, 'contractorId'>;
export type UpdateBusinessTargets = Omit<Partial<InsertBusinessTargets>, 'contractorId'>;
export type UpdateDialpadPhoneNumber = Omit<Partial<InsertDialpadPhoneNumber>, 'contractorId' | 'phoneNumber'>;
export type UpdateUserPhoneNumberPermission = Omit<Partial<InsertUserPhoneNumberPermission>, 'userId' | 'phoneNumberId' | 'contractorId'>;
export type UpdateDialpadUser = Omit<Partial<InsertDialpadUser>, 'contractorId' | 'dialpadUserId'>;
export type UpdateDialpadDepartment = Omit<Partial<InsertDialpadDepartment>, 'contractorId' | 'dialpadDepartmentId'>;
export type UpdateDialpadSyncJob = Omit<Partial<InsertDialpadSyncJob>, 'contractorId' | 'syncType'>;
export type UpdateSyncSchedule = Omit<Partial<InsertSyncSchedule>, 'contractorId' | 'integrationName'>;
export type UpdateTerminologySettings = Omit<Partial<InsertTerminologySettings>, 'contractorId'>;
export type UpdateWorkflow = Omit<Partial<InsertWorkflow>, 'contractorId' | 'createdBy'>;
export type UpdateWorkflowStep = Omit<Partial<InsertWorkflowStep>, 'workflowId'>;
export type UpdateWorkflowExecution = Omit<Partial<InsertWorkflowExecution>, 'workflowId' | 'contractorId'>;

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByEmailAndContractor(email: string, contractorId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  verifyPassword(username: string, password: string): Promise<User | null>;
  verifyPasswordByEmail(email: string, password: string): Promise<User | null>;
  updateUser(id: string, user: UpdateUser): Promise<User | undefined>;
  switchContractor(userId: string, contractorId: string): Promise<User | undefined>;
  
  // User-Contractor relationship operations
  getUserContractors(userId: string): Promise<UserContractor[]>;
  getContractorUsers(contractorId: string): Promise<UserContractor[]>;
  getUserContractor(userId: string, contractorId: string): Promise<UserContractor | undefined>;
  addUserToContractor(userContractor: InsertUserContractor): Promise<UserContractor>;
  removeUserFromContractor(userId: string, contractorId: string): Promise<boolean>;
  updateUserContractor(userId: string, contractorId: string, updates: Partial<InsertUserContractor>): Promise<UserContractor | undefined>;
  ensureUserContractorEntry(userId: string, contractorId: string, role: 'super_admin' | 'admin' | 'manager' | 'user', canManageIntegrations?: boolean): Promise<UserContractor>;

  // Contractor operations
  getContractor(id: string): Promise<Contractor | undefined>;
  getContractorByDomain(domain: string): Promise<Contractor | undefined>;
  getContractorBySlug(slug: string): Promise<Contractor | undefined>;
  createContractor(contractor: InsertContractor): Promise<Contractor>;
  updateContractor(id: string, contractor: UpdateContractor): Promise<Contractor | undefined>;

  // Contact operations (unified leads and customers)
  getContacts(contractorId: string, type?: 'lead' | 'customer' | 'inactive'): Promise<Contact[]>;
  getContactsPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  }): Promise<PaginatedContacts>;
  getContactsCount(contractorId: string, options?: {
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  }): Promise<number>;
  getContactsStatusCounts(contractorId: string, options?: {
    search?: string;
    type?: 'lead' | 'customer' | 'inactive';
  }): Promise<{
    all: number;
    new: number;
    contacted: number;
    scheduled: number;
    disqualified: number;
  }>;
  getContact(id: string, contractorId: string): Promise<Contact | undefined>;
  getContactByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Contact | undefined>;
  getContactByPhone(phone: string, contractorId: string): Promise<Contact | undefined>;
  getContactByHousecallProCustomerId(housecallProCustomerId: string, contractorId: string): Promise<Contact | undefined>;
  createContact(contact: Omit<InsertContact, 'contractorId'>, contractorId: string): Promise<Contact>;
  updateContact(id: string, contact: UpdateContact, contractorId: string): Promise<Contact | undefined>;
  markContactContacted(contactId: string, contractorId: string, userId: string, contactedAt?: Date): Promise<Contact | undefined>;
  deleteContact(id: string, contractorId: string): Promise<boolean>;
  findMatchingContact(contractorId: string, emails?: string[], phones?: string[]): Promise<string | null>;

  // Lead operations (individual lead submissions)
  getLeads(contractorId: string): Promise<Lead[]>;
  getLeadsByContact(contactId: string, contractorId: string): Promise<Lead[]>;
  getLead(id: string, contractorId: string): Promise<Lead | undefined>;
  createLead(lead: Omit<InsertLead, 'contractorId'>, contractorId: string): Promise<Lead>;
  updateLead(id: string, lead: Partial<InsertLead>, contractorId: string): Promise<Lead | undefined>;
  deleteLead(id: string, contractorId: string): Promise<boolean>;

  // Job operations
  getJobs(contractorId: string): Promise<Job[]>;
  getJobsPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<PaginatedJobs>;
  getJobsCount(contractorId: string, options?: {
    status?: string;
    search?: string;
  }): Promise<number>;
  getJobsStatusCounts(contractorId: string, options?: {
    search?: string;
  }): Promise<{
    all: number;
    scheduled: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  }>;
  getJob(id: string, contractorId: string): Promise<Job | undefined>;
  getJobByEstimateId(estimateId: string, contractorId: string): Promise<Job | undefined>;
  getJobByHousecallProJobId(externalId: string, contractorId: string): Promise<Job | undefined>;
  createJob(job: Omit<InsertJob, 'contractorId'>, contractorId: string): Promise<Job>;
  updateJob(id: string, job: UpdateJob, contractorId: string): Promise<Job | undefined>;
  deleteJob(id: string, contractorId: string): Promise<boolean>;

  // Estimate operations
  getEstimates(contractorId: string): Promise<Estimate[]>;
  getEstimatesPaginated(contractorId: string, options?: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<PaginatedEstimates>;
  getEstimatesCount(contractorId: string, options?: {
    status?: string;
    search?: string;
  }): Promise<number>;
  getEstimatesStatusCounts(contractorId: string, options?: {
    search?: string;
  }): Promise<{
    all: number;
    sent: number;
    pending: number;
    approved: number;
    rejected: number;
  }>;
  getEstimate(id: string, contractorId: string): Promise<Estimate | undefined>;
  createEstimate(estimate: Omit<InsertEstimate, 'contractorId'>, contractorId: string): Promise<Estimate>;
  updateEstimate(id: string, estimate: UpdateEstimate, contractorId: string): Promise<Estimate | undefined>;
  deleteEstimate(id: string, contractorId: string): Promise<boolean>;

  // Dashboard metrics
  getDashboardMetrics(contractorId: string, userId: string, userRole: string, startDate?: Date, endDate?: Date): Promise<{
    speedToLeadMinutes: number;
    setRate: number;
    totalLeads: number;
    todaysFollowUps: number;
  }>;

  // Contact deduplication
  deduplicateContacts(contractorId: string): Promise<{
    duplicatesFound: number;
    contactsMerged: number;
    contactsDeleted: number;
  }>;

  // Message operations
  getMessages(contractorId: string, contactId?: string, estimateId?: string): Promise<Message[]>;
  getMessage(id: string, contractorId: string): Promise<Message | undefined>;
  createMessage(message: Omit<InsertMessage, 'contractorId'>, contractorId: string): Promise<Message>;
  
  // Enhanced message operations for unified communications
  getAllMessages(contractorId: string, options?: {
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Message[]>;
  getConversations(contractorId: string, options?: {
    search?: string;
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
  }): Promise<Array<{
    contactId: string;
    contactName: string;
    contactPhone?: string;
    contactEmail?: string;
    lastMessage: Message;
    unreadCount: number;
    totalMessages: number;
  }>>;
  getConversationMessages(contractorId: string, contactId: string): Promise<Message[]>;
  getConversationMessageCount(contractorId: string, contactId: string): Promise<number>;

  // Template operations
  getTemplates(contractorId: string, type?: 'text' | 'email'): Promise<Template[]>;
  getTemplate(id: string, contractorId: string): Promise<Template | undefined>;
  createTemplate(template: Omit<InsertTemplate, 'contractorId'>, contractorId: string): Promise<Template>;
  updateTemplate(id: string, template: UpdateTemplate, contractorId: string): Promise<Template | undefined>;
  deleteTemplate(id: string, contractorId: string): Promise<boolean>;

  // Call operations
  getCalls(contractorId: string): Promise<Call[]>;
  getCall(id: string, contractorId: string): Promise<Call | undefined>;
  getCallByExternalId(externalCallId: string, contractorId: string): Promise<Call | undefined>;
  createCall(call: Omit<InsertCall, 'contractorId'>, contractorId: string): Promise<Call>;
  updateCall(id: string, call: UpdateCall, contractorId: string): Promise<Call | undefined>;

  // Contractor credential operations
  getContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<ContractorCredential | undefined>;
  getContractorServiceCredentials(contractorId: string, service: string): Promise<ContractorCredential[]>;
  setContractorCredential(contractorId: string, service: string, credentialKey: string, encryptedValue: string): Promise<ContractorCredential>;
  disableContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<void>;

  // Contractor provider operations
  getContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined>;
  setContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider>;
  getContractorProviders(contractorId: string): Promise<ContractorProvider[]>;
  disableContractorProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void>;

  // Contractor integration enablement operations
  getContractorIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined>;
  getContractorIntegrations(contractorId: string): Promise<ContractorIntegration[]>;
  getEnabledIntegrations(contractorId: string): Promise<ContractorIntegration[]>;
  enableContractorIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration>;
  disableContractorIntegration(contractorId: string, integrationName: string): Promise<void>;
  isIntegrationEnabled(contractorId: string, integrationName: string): Promise<boolean>;

  // Housecall Pro integration operations
  getContactByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Contact | undefined>;
  getEstimateByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Estimate | undefined>;
  getEstimatesByHousecallProIds(housecallProEstimateIds: string[], contractorId: string): Promise<Map<string, Estimate>>;
  getScheduledContacts(contractorId: string): Promise<Contact[]>;
  getUnscheduledContacts(contractorId: string): Promise<Contact[]>;
  scheduleContactAsEstimate(contactId: string, housecallProData: {
    housecallProCustomerId: string;
    housecallProEstimateId: string;
    scheduledAt: Date;
    scheduledEmployeeId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    description?: string;
  }, contractorId: string): Promise<{ contact: Contact; estimate: Estimate } | undefined>;

  // Activity operations
  getActivities(contractorId: string, options?: {
    contactId?: string;
    estimateId?: string;
    jobId?: string;
    type?: 'note' | 'call' | 'email' | 'meeting' | 'follow_up' | 'status_change';
    limit?: number;
    offset?: number;
  }): Promise<Activity[]>;
  getActivity(id: string, contractorId: string): Promise<Activity | undefined>;
  createActivity(activity: Omit<InsertActivity, 'contractorId'>, contractorId: string): Promise<Activity>;
  updateActivity(id: string, activity: UpdateActivity, contractorId: string): Promise<Activity | undefined>;
  deleteActivity(id: string, contractorId: string): Promise<boolean>;

  // Employee operations
  getEmployees(contractorId: string): Promise<Employee[]>;
  getEmployee(id: string, contractorId: string): Promise<Employee | undefined>;
  getEmployeeByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Employee | undefined>;
  upsertEmployees(employees: Omit<InsertEmployee, 'contractorId'>[], contractorId: string): Promise<Employee[]>;
  updateEmployeeRoles(id: string, roles: string[], contractorId: string): Promise<Employee | undefined>;

  // Business targets operations
  getBusinessTargets(contractorId: string): Promise<BusinessTargets | undefined>;
  createBusinessTargets(targets: Omit<InsertBusinessTargets, 'contractorId'>, contractorId: string): Promise<BusinessTargets>;
  updateBusinessTargets(targets: UpdateBusinessTargets, contractorId: string): Promise<BusinessTargets | undefined>;

  // Dialpad phone number operations
  getDialpadPhoneNumbers(contractorId: string): Promise<DialpadPhoneNumber[]>;
  getDialpadPhoneNumber(id: string, contractorId: string): Promise<DialpadPhoneNumber | undefined>;
  getDialpadPhoneNumberByNumber(contractorId: string, phoneNumber: string): Promise<DialpadPhoneNumber | undefined>;
  getDialpadPhoneNumbersByIds(ids: string[]): Promise<DialpadPhoneNumber[]>;
  createDialpadPhoneNumber(phoneNumber: InsertDialpadPhoneNumber): Promise<DialpadPhoneNumber>;
  updateDialpadPhoneNumber(id: string, phoneNumber: UpdateDialpadPhoneNumber): Promise<DialpadPhoneNumber>;

  // User phone number permission operations
  getUserPhoneNumberPermissions(userId: string): Promise<UserPhoneNumberPermission[]>;
  getUserPhoneNumberPermission(userId: string, phoneNumberId: string): Promise<UserPhoneNumberPermission | undefined>;
  createUserPhoneNumberPermission(permission: InsertUserPhoneNumberPermission): Promise<UserPhoneNumberPermission>;
  updateUserPhoneNumberPermission(id: string, permission: UpdateUserPhoneNumberPermission): Promise<UserPhoneNumberPermission>;
  deleteUserPhoneNumberPermission(id: string): Promise<boolean>;

  // Dialpad caching operations
  getDialpadUsers(contractorId: string): Promise<DialpadUser[]>;
  getDialpadUser(id: string, contractorId: string): Promise<DialpadUser | undefined>;
  getDialpadUserByDialpadId(dialpadUserId: string, contractorId: string): Promise<DialpadUser | undefined>;
  createDialpadUser(user: InsertDialpadUser): Promise<DialpadUser>;
  updateDialpadUser(id: string, user: UpdateDialpadUser): Promise<DialpadUser>;
  deleteDialpadUser(id: string): Promise<boolean>;

  getDialpadDepartments(contractorId: string): Promise<DialpadDepartment[]>;
  getDialpadDepartment(id: string, contractorId: string): Promise<DialpadDepartment | undefined>;
  getDialpadDepartmentByDialpadId(dialpadDepartmentId: string, contractorId: string): Promise<DialpadDepartment | undefined>;
  createDialpadDepartment(department: InsertDialpadDepartment): Promise<DialpadDepartment>;
  updateDialpadDepartment(id: string, department: UpdateDialpadDepartment): Promise<DialpadDepartment>;
  deleteDialpadDepartment(id: string): Promise<boolean>;

  getDialpadSyncJobs(contractorId: string, limit?: number): Promise<DialpadSyncJob[]>;
  getDialpadSyncJob(id: string, contractorId: string): Promise<DialpadSyncJob | undefined>;
  getLatestDialpadSyncJob(contractorId: string, syncType?: string): Promise<DialpadSyncJob | undefined>;
  createDialpadSyncJob(syncJob: InsertDialpadSyncJob): Promise<DialpadSyncJob>;
  updateDialpadSyncJob(id: string, syncJob: UpdateDialpadSyncJob): Promise<DialpadSyncJob>;

  // Sync schedule operations
  getSyncSchedules(contractorId: string): Promise<SyncSchedule[]>;
  getSyncSchedule(contractorId: string, integrationName: string): Promise<SyncSchedule | undefined>;
  getDueSyncSchedules(): Promise<SyncSchedule[]>;
  createSyncSchedule(schedule: InsertSyncSchedule): Promise<SyncSchedule>;
  updateSyncSchedule(contractorId: string, integrationName: string, schedule: UpdateSyncSchedule): Promise<SyncSchedule | undefined>;
  deleteSyncSchedule(contractorId: string, integrationName: string): Promise<boolean>;

  // Terminology settings operations
  getTerminologySettings(contractorId: string): Promise<TerminologySettings | undefined>;
  createTerminologySettings(settings: Omit<InsertTerminologySettings, 'contractorId'>, contractorId: string): Promise<TerminologySettings>;
  updateTerminologySettings(settings: UpdateTerminologySettings, contractorId: string): Promise<TerminologySettings | undefined>;

  // Notification operations
  getNotifications(userId: string, contractorId: string, limit?: number): Promise<Notification[]>;
  getUnreadNotifications(userId: string, contractorId: string): Promise<Notification[]>;
  getNotification(id: string, userId: string): Promise<Notification | undefined>;
  createNotification(notification: Omit<InsertNotification, 'contractorId'>, contractorId: string): Promise<Notification>;
  markNotificationAsRead(id: string, userId: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string, contractorId: string): Promise<void>;
  deleteNotification(id: string, userId: string): Promise<boolean>;

  // Workflow operations
  getWorkflows(contractorId: string, approvalStatus?: string): Promise<Workflow[]>;
  getActiveWorkflows(contractorId: string): Promise<Workflow[]>;
  getWorkflowsPendingApproval(contractorId: string): Promise<Workflow[]>;
  getWorkflow(id: string, contractorId: string): Promise<Workflow | undefined>;
  createWorkflow(workflow: Omit<InsertWorkflow, 'contractorId'>, contractorId: string, userId: string): Promise<Workflow>;
  updateWorkflow(id: string, workflow: UpdateWorkflow, contractorId: string): Promise<Workflow | undefined>;
  deleteWorkflow(id: string, contractorId: string): Promise<boolean>;
  approveWorkflow(id: string, contractorId: string, approvedByUserId: string): Promise<Workflow | undefined>;
  rejectWorkflow(id: string, contractorId: string, rejectedByUserId: string, rejectionReason?: string): Promise<Workflow | undefined>;
  
  // Workflow step operations
  getWorkflowSteps(workflowId: string): Promise<WorkflowStep[]>;
  getWorkflowStep(id: string): Promise<WorkflowStep | undefined>;
  createWorkflowStep(step: InsertWorkflowStep): Promise<WorkflowStep>;
  updateWorkflowStep(id: string, step: UpdateWorkflowStep): Promise<WorkflowStep | undefined>;
  deleteWorkflowStep(id: string): Promise<boolean>;
  deleteWorkflowSteps(workflowId: string): Promise<boolean>;
  
  // Workflow execution operations
  getWorkflowExecutions(workflowId: string, contractorId: string, limit?: number): Promise<WorkflowExecution[]>;
  getWorkflowExecution(id: string, contractorId: string): Promise<WorkflowExecution | undefined>;
  getRecentWorkflowExecutions(contractorId: string, limit?: number): Promise<WorkflowExecution[]>;
  createWorkflowExecution(execution: Omit<InsertWorkflowExecution, 'contractorId'>, contractorId: string): Promise<WorkflowExecution>;
  updateWorkflowExecution(id: string, execution: UpdateWorkflowExecution, contractorId: string): Promise<WorkflowExecution | undefined>;
  
  // Enriched entity fetching for workflows (includes related contact data)
  getEstimateWithContact(id: string, contractorId: string): Promise<any>;
  getJobWithContact(id: string, contractorId: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Use lower() for consistent case-insensitive matching and order by createdAt DESC
    // to return the most recent record in case of duplicates with different casing
    const result = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .orderBy(desc(users.createdAt))
      .limit(1);
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(user.password, 12);
    const userWithHashedPassword = { ...user, password: hashedPassword };
    const result = await db.insert(users).values(userWithHashedPassword).returning();
    return result[0];
  }

  async verifyPassword(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }
  
  async getUserByEmailAndContractor(email: string, contractorId: string): Promise<User | undefined> {
    // Use lower() for consistent case-insensitive matching and order by createdAt DESC
    // to return the most recent record in case of duplicates with different casing
    const result = await db
      .select()
      .from(users)
      .innerJoin(userContractors, eq(users.id, userContractors.userId))
      .where(and(sql`lower(${users.email}) = lower(${email})`, eq(userContractors.contractorId, contractorId)))
      .orderBy(desc(users.createdAt))
      .limit(1);
    return result[0]?.users;
  }
  
  async updateUser(id: string, user: UpdateUser): Promise<User | undefined> {
    const result = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return result[0];
  }
  
  async switchContractor(userId: string, contractorId: string): Promise<User | undefined> {
    // Verify the user has access to this contractor
    const userContractor = await this.getUserContractor(userId, contractorId);
    if (!userContractor) {
      throw new Error('User does not have access to this contractor');
    }
    
    // Update the current contractor
    const result = await db
      .update(users)
      .set({ contractorId })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }
  
  // User-Contractor relationship operations
  async getUserContractors(userId: string): Promise<UserContractor[]> {
    return await db.select().from(userContractors).where(eq(userContractors.userId, userId));
  }
  
  async getContractorUsers(contractorId: string): Promise<UserContractor[]> {
    return await db.select().from(userContractors).where(eq(userContractors.contractorId, contractorId));
  }
  
  async getUserContractor(userId: string, contractorId: string): Promise<UserContractor | undefined> {
    const result = await db
      .select()
      .from(userContractors)
      .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }
  
  async addUserToContractor(userContractor: InsertUserContractor): Promise<UserContractor> {
    const result = await db.insert(userContractors).values(userContractor).returning();
    return result[0];
  }
  
  async removeUserFromContractor(userId: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(userContractors)
      .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, contractorId)))
      .returning();
    return result.length > 0;
  }
  
  async updateUserContractor(userId: string, contractorId: string, updates: Partial<InsertUserContractor>): Promise<UserContractor | undefined> {
    const result = await db
      .update(userContractors)
      .set(updates)
      .where(and(eq(userContractors.userId, userId), eq(userContractors.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async ensureUserContractorEntry(userId: string, contractorId: string, role: 'super_admin' | 'admin' | 'manager' | 'user', canManageIntegrations: boolean = false): Promise<UserContractor> {
    // Use INSERT ... ON CONFLICT DO NOTHING to handle concurrent logins safely
    // This prevents race conditions where two simultaneous logins could both try to insert
    const result = await db
      .insert(userContractors)
      .values({
        userId,
        contractorId,
        role,
        canManageIntegrations
      })
      .onConflictDoNothing()
      .returning();
    
    // If insert succeeded, return the new record
    if (result.length > 0) {
      return result[0];
    }
    
    // If insert was skipped (conflict), fetch and return existing record
    const existing = await this.getUserContractor(userId, contractorId);
    if (!existing) {
      throw new Error('Failed to ensure user contractor entry');
    }
    return existing;
  }

  async verifyPasswordByEmail(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }

  // Contractor operations
  async getContractor(id: string): Promise<Contractor | undefined> {
    const result = await db.select().from(contractors).where(eq(contractors.id, id)).limit(1);
    return result[0];
  }

  async getContractorByDomain(domain: string): Promise<Contractor | undefined> {
    const result = await db.select().from(contractors).where(eq(contractors.domain, domain)).limit(1);
    return result[0];
  }

  async getContractorBySlug(slug: string): Promise<Contractor | undefined> {
    const result = await db.select().from(contractors).where(eq(contractors.bookingSlug, slug)).limit(1);
    return result[0];
  }

  async createContractor(contractor: InsertContractor): Promise<Contractor> {
    const result = await db.insert(contractors).values(contractor).returning();
    return result[0];
  }

  async updateContractor(id: string, contractor: UpdateContractor): Promise<Contractor | undefined> {
    const result = await db.update(contractors)
      .set({ ...contractor, createdAt: undefined })
      .where(eq(contractors.id, id))
      .returning();
    return result[0];
  }

  // Contact operations (unified leads and customers)
  async getContacts(contractorId: string, type?: 'lead' | 'customer' | 'inactive'): Promise<Contact[]> {
    const conditions = [eq(contacts.contractorId, contractorId)];
    if (type) {
      conditions.push(eq(contacts.type, type));
    }
    return await db.select().from(contacts).where(and(...conditions)).orderBy(desc(contacts.createdAt));
  }

  async getContactsPaginated(contractorId: string, options: {
    cursor?: string;
    limit?: number;
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  } = {}): Promise<PaginatedContacts> {
    const limit = Math.min(options.limit || 50, 100); // Max 100 items per page
    
    // Build where conditions
    const conditions = [eq(contacts.contractorId, contractorId)];
    
    if (options.cursor) {
      conditions.push(gt(contacts.createdAt, new Date(options.cursor)));
    }
    
    // Filter by type (lead, customer, inactive)
    if (options.type) {
      conditions.push(eq(contacts.type, options.type));
    }
    
    // Filter by status
    if (options.status && options.status !== 'all') {
      conditions.push(eq(contacts.status, options.status as any));
    } else if (!options.status || options.status === 'all') {
      // When viewing 'all', exclude disqualified and scheduled for leads
      if (!options.type || options.type === 'lead') {
        conditions.push(ne(contacts.status, 'disqualified'));
        conditions.push(ne(contacts.status, 'scheduled'));
      }
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(contacts.name, `%${options.search}%`),
          ilike(contacts.address, `%${options.search}%`),
          ilike(contacts.source, `%${options.search}%`)
        )!
      );
    }

    // Get contacts with all fields - ensure arrays are never null
    // Include hasJobs by checking if any jobs exist for this contact
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
    .limit(limit + 1); // Get one extra to check if there are more

    // Check if there are more items
    const hasMore = contactsData.length > limit;
    if (hasMore) {
      contactsData.pop(); // Remove the extra item
    }

    // Generate next cursor
    const nextCursor = hasMore && contactsData.length > 0 
      ? contactsData[contactsData.length - 1].createdAt.toISOString()
      : null;

    // Get total count
    const total = await this.getContactsCount(contractorId, {
      type: options.type,
      status: options.status,
      search: options.search,
    });

    return {
      data: contactsData,
      pagination: {
        total,
        hasMore,
        nextCursor,
      },
    };
  }

  async getContactsCount(contractorId: string, options: {
    type?: 'lead' | 'customer' | 'inactive';
    status?: string;
    search?: string;
  } = {}): Promise<number> {
    const conditions = [eq(contacts.contractorId, contractorId)];
    
    // Filter by type
    if (options.type) {
      conditions.push(eq(contacts.type, options.type));
    }
    
    // Filter by status
    if (options.status && options.status !== 'all') {
      conditions.push(eq(contacts.status, options.status as any));
    } else if (!options.status || options.status === 'all') {
      // When viewing 'all', exclude disqualified and scheduled for leads
      if (!options.type || options.type === 'lead') {
        conditions.push(ne(contacts.status, 'disqualified'));
        conditions.push(ne(contacts.status, 'scheduled'));
      }
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(contacts.name, `%${options.search}%`),
          ilike(contacts.address, `%${options.search}%`),
          ilike(contacts.source, `%${options.search}%`)
        )!
      );
    }

    const result = await db.select({ count: sql`count(*)` })
      .from(contacts)
      .where(and(...conditions));
    
    return Number(result[0]?.count || 0);
  }

  async getContactsStatusCounts(contractorId: string, options: {
    search?: string;
    type?: 'lead' | 'customer' | 'inactive';
  } = {}): Promise<{
    all: number;
    new: number;
    contacted: number;
    scheduled: number;
    disqualified: number;
  }> {
    const baseConditions = [eq(contacts.contractorId, contractorId)];
    
    // Filter by type if specified
    if (options.type) {
      baseConditions.push(eq(contacts.type, options.type));
    }
    
    if (options.search) {
      baseConditions.push(
        or(
          ilike(contacts.name, `%${options.search}%`),
          ilike(contacts.address, `%${options.search}%`),
          ilike(contacts.source, `%${options.search}%`)
        )!
      );
    }

    // Get counts for each status in a single query using conditional aggregation
    // For leads, 'all' excludes scheduled and disqualified statuses
    const isLeadType = !options.type || options.type === 'lead';
    const result = await db.select({
      all: isLeadType 
        ? sql<number>`COUNT(CASE WHEN ${contacts.status} NOT IN ('scheduled', 'disqualified') THEN 1 END)`
        : count(),
      new: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'new' THEN 1 END)`,
      contacted: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'contacted' THEN 1 END)`,
      scheduled: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'scheduled' THEN 1 END)`,
      disqualified: sql<number>`COUNT(CASE WHEN ${contacts.status} = 'disqualified' THEN 1 END)`,
    })
      .from(contacts)
      .where(and(...baseConditions));
    
    const counts = result[0];
    return {
      all: Number(counts.all),
      new: Number(counts.new),
      contacted: Number(counts.contacted),
      scheduled: Number(counts.scheduled),
      disqualified: Number(counts.disqualified),
    };
  }

  async getContact(id: string, contractorId: string): Promise<Contact | undefined> {
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
    return result[0];
  }

  async getContactByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Contact | undefined> {
    const result = await db.select().from(contacts).where(and(
      eq(contacts.externalId, externalId), 
      eq(contacts.externalSource, externalSource),
      eq(contacts.contractorId, contractorId)
    )).limit(1);
    return result[0];
  }

  async getContactByPhone(phone: string, contractorId: string): Promise<Contact | undefined> {
    // Normalize phone number by removing all non-digit characters and taking last 10 digits for comparison
    const digits = phone.replace(/\D/g, '');
    const normalizedPhone = digits.length > 10 ? digits.slice(-10) : digits;
    
    // Search for the normalized phone in the phones array
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

  async getContactByHousecallProCustomerId(housecallProCustomerId: string, contractorId: string): Promise<Contact | undefined> {
    const result = await db.select().from(contacts).where(and(
      eq(contacts.housecallProCustomerId, housecallProCustomerId),
      eq(contacts.contractorId, contractorId)
    )).limit(1);
    return result[0];
  }

  async createContact(contact: Omit<InsertContact, 'contractorId'>, contractorId: string): Promise<Contact> {
    // Normalize phone numbers to (xxx) xxx-xxxx format
    const normalizedContact = {
      ...contact,
      phones: contact.phones ? normalizePhoneArrayForStorage(contact.phones) : []
    };
    
    const result = await db.insert(contacts).values({ ...normalizedContact, contractorId }).returning();
    return result[0];
  }

  async updateContact(id: string, contact: UpdateContact, contractorId: string): Promise<Contact | undefined> {
    // Normalize phone numbers if provided
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

  async markContactContacted(contactId: string, contractorId: string, userId: string, contactedAt: Date = new Date()): Promise<Contact | undefined> {
    // Update contactedAt timestamp and status (if status is 'new')
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

  async deleteContact(id: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.contractorId, contractorId)));
    return (result.rowCount ?? 0) > 0;
  }

  async findMatchingContact(contractorId: string, emails?: string[], phones?: string[]): Promise<string | null> {
    // Try to find a contact with matching email first (case-insensitive) using SQL
    if (emails && emails.length > 0) {
      const lowerEmails = emails.map(e => e.toLowerCase());
      
      // Use SQL to find contacts where any email matches (case-insensitive)
      // Using EXISTS with unnest for efficient array element comparison
      // Cast the array properly for PostgreSQL using ARRAY constructor
      const emailResult = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(
          eq(contacts.contractorId, contractorId),
          sql`EXISTS (
            SELECT 1 FROM unnest(${contacts.emails}) AS contact_email
            WHERE LOWER(contact_email) = ANY(ARRAY[${sql.join(lowerEmails.map(e => sql`${e}`), sql`, `)}]::text[])
          )`
        ))
        .limit(1);
      
      if (emailResult.length > 0) {
        return emailResult[0].id;
      }
    }

    // If no email match, try phone numbers using a single SQL query
    if (phones && phones.length > 0) {
      // Normalize all phone numbers to last 10 digits for comparison
      const normalizedPhones = phones.map(phone => {
        const digits = phone.replace(/\D/g, '');
        return digits.length > 10 ? digits.slice(-10) : digits;
      }).filter(p => p.length > 0);
      
      if (normalizedPhones.length > 0) {
        // Use SQL to find contacts where any phone matches (normalized comparison)
        // Cast the array properly for PostgreSQL using ARRAY constructor
        const phoneResult = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(
            eq(contacts.contractorId, contractorId),
            sql`EXISTS (
              SELECT 1 FROM unnest(${contacts.phones}) AS contact_phone
              WHERE RIGHT(REGEXP_REPLACE(contact_phone, '[^0-9]', '', 'g'), 10) = ANY(ARRAY[${sql.join(normalizedPhones.map(p => sql`${p}`), sql`, `)}]::text[])
            )`
          ))
          .limit(1);
        
        if (phoneResult.length > 0) {
          return phoneResult[0].id;
        }
      }
    }

    return null;
  }

  // Lead operations - tracks individual lead submissions
  async getLeads(contractorId: string): Promise<Lead[]> {
    return await db
      .select()
      .from(leads)
      .where(eq(leads.contractorId, contractorId))
      .orderBy(desc(leads.createdAt));
  }

  async getLeadsByContact(contactId: string, contractorId: string): Promise<Lead[]> {
    return await db
      .select()
      .from(leads)
      .where(and(
        eq(leads.contactId, contactId),
        eq(leads.contractorId, contractorId)
      ))
      .orderBy(desc(leads.createdAt));
  }

  async getLead(id: string, contractorId: string): Promise<Lead | undefined> {
    const result = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
    return result[0];
  }

  async createLead(lead: Omit<InsertLead, 'contractorId'>, contractorId: string): Promise<Lead> {
    const result = await db
      .insert(leads)
      .values({ ...lead, contractorId })
      .returning();
    return result[0];
  }

  async updateLead(id: string, lead: Partial<InsertLead>, contractorId: string): Promise<Lead | undefined> {
    const result = await db
      .update(leads)
      .set({ ...lead, updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async deleteLead(id: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(leads)
      .where(and(eq(leads.id, id), eq(leads.contractorId, contractorId)));
    return (result.rowCount ?? 0) > 0;
  }

  async deduplicateContacts(contractorId: string): Promise<{
    duplicatesFound: number;
    contactsMerged: number;
    contactsDeleted: number;
  }> {
    console.log(`[deduplicateContacts] Starting deduplication for contractor: ${contractorId}`);
    
    // Get all contacts for this contractor
    const allContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.contractorId, contractorId))
      .orderBy(contacts.createdAt); // Oldest first
    
    console.log(`[deduplicateContacts] Found ${allContacts.length} total contacts`);
    
    // OPTIMIZED: Use Union-Find with index-based lookups (O(n) instead of O(n²))
    // Build lookup indices for phones and emails
    const phoneToContacts = new Map<string, string[]>();
    const emailToContacts = new Map<string, string[]>();
    const contactById = new Map<string, Contact>();
    
    // Helper to normalize phone to last 10 digits
    const normalizePhone = (phone: string): string => phone.replace(/\D/g, '').slice(-10);
    
    // O(n) - Build indices
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
    
    // Union-Find data structure for grouping
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!)); // Path compression
      }
      return parent.get(id)!;
    };
    const union = (id1: string, id2: string) => {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        // Prefer older contact as root (lower createdAt)
        const contact1 = contactById.get(root1)!;
        const contact2 = contactById.get(root2)!;
        if (contact1.createdAt <= contact2.createdAt) {
          parent.set(root2, root1);
        } else {
          parent.set(root1, root2);
        }
      }
    };
    
    // O(n) - Union contacts that share phone numbers
    for (const contactIds of phoneToContacts.values()) {
      for (let i = 1; i < contactIds.length; i++) {
        union(contactIds[0], contactIds[i]);
      }
    }
    
    // O(n) - Union contacts that share emails
    for (const contactIds of emailToContacts.values()) {
      for (let i = 1; i < contactIds.length; i++) {
        union(contactIds[0], contactIds[i]);
      }
    }
    
    // O(n) - Group contacts by their root
    const groups = new Map<string, Contact[]>();
    for (const contact of allContacts) {
      const root = find(contact.id);
      const group = groups.get(root) || [];
      group.push(contact);
      groups.set(root, group);
    }
    
    // Filter to only groups with duplicates (more than 1 contact)
    const contactGroups = new Map<string, Contact[]>();
    for (const [root, group] of groups) {
      if (group.length > 1) {
        // Sort by createdAt to ensure oldest is first
        group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        contactGroups.set(root, group);
      }
    }
    
    console.log(`[deduplicateContacts] Found ${contactGroups.size} groups of duplicates`);
    
    let contactsMerged = 0;
    let contactsDeleted = 0;
    
    // Process each group of duplicates
    const contactGroupsArray = Array.from(contactGroups.entries());
    for (const [, duplicates] of contactGroupsArray) {
      // Primary contact is the oldest (first in the sorted array)
      const primary = duplicates[0];
      const duplicatesToMerge = duplicates.slice(1);
      
      console.log(`[deduplicateContacts] Merging ${duplicatesToMerge.length} duplicates into primary: ${primary.id} (${primary.name})`);
      
      // Merge phones and emails, removing duplicates
      const allPhones = new Set<string>();
      const allEmails = new Set<string>();
      
      for (const contact of duplicates) {
        contact.phones?.forEach(phone => allPhones.add(phone));
        contact.emails?.forEach(email => allEmails.add(email.toLowerCase()));
      }
      
      // Update primary contact with merged data
      await db.update(contacts)
        .set({
          phones: Array.from(allPhones),
          emails: Array.from(allEmails),
          updatedAt: new Date()
        })
        .where(eq(contacts.id, primary.id));
      
      // Update all foreign key references to point to primary contact
      for (const duplicate of duplicatesToMerge) {
        console.log(`[deduplicateContacts] Updating references from ${duplicate.id} to ${primary.id}`);
        
        // Update messages
        await db.update(messages)
          .set({ contactId: primary.id })
          .where(eq(messages.contactId, duplicate.id));
        
        // Update activities
        await db.update(activities)
          .set({ contactId: primary.id })
          .where(eq(activities.contactId, duplicate.id));
        
        // Update estimates
        await db.update(estimates)
          .set({ contactId: primary.id })
          .where(eq(estimates.contactId, duplicate.id));
        
        // Update jobs
        await db.update(jobs)
          .set({ contactId: primary.id })
          .where(eq(jobs.contactId, duplicate.id));
        
        // Delete the duplicate contact
        await db.delete(contacts)
          .where(eq(contacts.id, duplicate.id));
        
        contactsDeleted++;
      }
      
      contactsMerged++;
    }
    
    console.log(`[deduplicateContacts] Completed: ${contactsMerged} contacts merged, ${contactsDeleted} duplicates deleted`);
    
    return {
      duplicatesFound: contactGroups.size,
      contactsMerged,
      contactsDeleted
    };
  }

  // Job operations
  async getJobs(contractorId: string): Promise<Job[]> {
    return await db.select().from(jobs).where(eq(jobs.contractorId, contractorId));
  }

  async getJobsPaginated(contractorId: string, options: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  } = {}): Promise<PaginatedJobs> {
    const limit = Math.min(options.limit || 50, 100); // Max 100 items per page
    
    // Build where conditions
    const conditions = [eq(jobs.contractorId, contractorId)];
    
    if (options.cursor) {
      conditions.push(lt(jobs.createdAt, new Date(options.cursor)));
    }
    
    if (options.status && options.status !== 'all') {
      conditions.push(eq(jobs.status, options.status as any));
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(jobs.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    // Get jobs with contact data (lightweight)
    const jobsData = await db.select({
      id: jobs.id,
      title: jobs.title,
      type: jobs.type,
      status: jobs.status,
      priority: jobs.priority,
      value: jobs.value,
      scheduledDate: jobs.scheduledDate,
      contactId: jobs.contactId,
      contactName: contacts.name,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .leftJoin(contacts, eq(jobs.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt))
    .limit(limit + 1); // Get one extra to check if there are more

    // Check if there are more items
    const hasMore = jobsData.length > limit;
    if (hasMore) {
      jobsData.pop(); // Remove the extra item
    }

    // Generate next cursor
    const nextCursor = hasMore && jobsData.length > 0 
      ? jobsData[jobsData.length - 1].createdAt.toISOString()
      : null;

    // Get total count
    const total = await this.getJobsCount(contractorId, {
      status: options.status,
      search: options.search,
    });

    return {
      data: jobsData.map(job => ({
        ...job,
        contactName: job.contactName || 'Unknown Contact'
      })),
      pagination: {
        total,
        hasMore,
        nextCursor,
      },
    };
  }

  async getJobsCount(contractorId: string, options: {
    status?: string;
    search?: string;
  } = {}): Promise<number> {
    const conditions = [eq(jobs.contractorId, contractorId)];
    
    if (options.status && options.status !== 'all') {
      conditions.push(eq(jobs.status, options.status as any));
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(jobs.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    const result = await db.select({ count: sql`count(*)` })
      .from(jobs)
      .leftJoin(contacts, eq(jobs.contactId, contacts.id))
      .where(and(...conditions));
    
    return Number(result[0]?.count || 0);
  }

  async getJobsStatusCounts(contractorId: string, options: {
    search?: string;
  } = {}): Promise<{
    all: number;
    scheduled: number;
    in_progress: number;
    completed: number;
    cancelled: number;
  }> {
    const baseConditions = [eq(jobs.contractorId, contractorId)];
    
    if (options.search) {
      baseConditions.push(
        or(
          ilike(jobs.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    // Get counts for each status in a single query using conditional aggregation
    const result = await db.select({
      all: count(),
      scheduled: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'scheduled' THEN 1 END)`,
      in_progress: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'in_progress' THEN 1 END)`,
      completed: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'completed' THEN 1 END)`,
      cancelled: sql<number>`COUNT(CASE WHEN ${jobs.status} = 'cancelled' THEN 1 END)`,
    })
      .from(jobs)
      .leftJoin(contacts, eq(jobs.contactId, contacts.id))
      .where(and(...baseConditions));
    
    const counts = result[0];
    return {
      all: Number(counts.all),
      scheduled: Number(counts.scheduled),
      in_progress: Number(counts.in_progress),
      completed: Number(counts.completed),
      cancelled: Number(counts.cancelled),
    };
  }

  async getJob(id: string, contractorId: string): Promise<Job | undefined> {
    const result = await db.select().from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createJob(job: Omit<InsertJob, 'contractorId'>, contractorId: string): Promise<Job> {
    // Validate that the contact belongs to the same contractor
    if (job.contactId) {
      const contact = await this.getContact(job.contactId, contractorId);
      if (!contact) {
        throw new Error('Contact not found or does not belong to this contractor');
      }
    }
    
    const result = await db.insert(jobs).values({ ...job, contractorId }).returning();
    return result[0];
  }

  async updateJob(id: string, job: UpdateJob, contractorId: string): Promise<Job | undefined> {
    const result = await db.update(jobs)
      .set({ ...job, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async deleteJob(id: string, contractorId: string): Promise<boolean> {
    const result = await db.delete(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
      .returning();
    return result.length > 0;
  }

  async getJobByEstimateId(estimateId: string, contractorId: string): Promise<Job | undefined> {
    const result = await db.select().from(jobs)
      .where(and(eq(jobs.estimateId, estimateId), eq(jobs.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async getJobByHousecallProJobId(externalId: string, contractorId: string): Promise<Job | undefined> {
    const result = await db.select().from(jobs)
      .where(and(eq(jobs.externalId, externalId), eq(jobs.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  // Estimate operations
  async getEstimates(contractorId: string): Promise<Estimate[]> {
    return await db.select({
      id: estimates.id,
      title: estimates.title,
      description: estimates.description,
      amount: estimates.amount,
      status: estimates.status,
      validUntil: estimates.validUntil,
      followUpDate: estimates.followUpDate,
      contactId: estimates.contactId,
      contractorId: estimates.contractorId,
      scheduledStart: estimates.scheduledStart,
      scheduledEnd: estimates.scheduledEnd,
      scheduledEmployeeId: estimates.scheduledEmployeeId,
      housecallProCustomerId: estimates.housecallProCustomerId,
      housecallProEstimateId: estimates.housecallProEstimateId,
      externalId: estimates.externalId,
      externalSource: estimates.externalSource,
      syncedAt: estimates.syncedAt,
      createdAt: estimates.createdAt,
      updatedAt: estimates.updatedAt,
      // Include contact data
      contact: {
        id: contacts.id,
        name: contacts.name,
        emails: contacts.emails,
        phones: contacts.phones,
        address: contacts.address,
      }
    })
    .from(estimates)
    .leftJoin(contacts, eq(estimates.contactId, contacts.id))
    .where(eq(estimates.contractorId, contractorId))
    .orderBy(desc(estimates.createdAt));
  }

  async getEstimatesPaginated(contractorId: string, options: {
    cursor?: string;
    limit?: number;
    status?: string;
    search?: string;
  } = {}): Promise<PaginatedEstimates> {
    const limit = Math.min(options.limit || 50, 100); // Max 100 items per page
    
    // Build where conditions
    const conditions = [eq(estimates.contractorId, contractorId)];
    
    if (options.cursor) {
      conditions.push(gt(estimates.createdAt, new Date(options.cursor)));
    }
    
    if (options.status) {
      conditions.push(eq(estimates.status, options.status as any));
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(estimates.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    // Get estimates with contact data (lightweight)
    const estimatesData = await db.select({
      id: estimates.id,
      title: estimates.title,
      amount: estimates.amount,
      status: estimates.status,
      validUntil: estimates.validUntil,
      contactId: estimates.contactId,
      contactName: sql<string>`COALESCE(${contacts.name}, 'Unknown Contact')`,
      createdAt: estimates.createdAt,
      updatedAt: estimates.updatedAt,
    })
    .from(estimates)
    .leftJoin(contacts, eq(estimates.contactId, contacts.id))
    .where(and(...conditions))
    .orderBy(desc(estimates.createdAt))
    .limit(limit + 1); // Get one extra to check if there are more

    // Check if there are more results
    const hasMore = estimatesData.length > limit;
    if (hasMore) {
      estimatesData.pop(); // Remove the extra item
    }

    // Get next cursor from the last item
    const nextCursor = hasMore && estimatesData.length > 0 
      ? estimatesData[estimatesData.length - 1].createdAt.toISOString()
      : null;

    // Get total count
    const total = await this.getEstimatesCount(contractorId, {
      status: options.status,
      search: options.search,
    });

    return {
      data: estimatesData,
      pagination: {
        total,
        hasMore,
        nextCursor,
      },
    };
  }

  async getEstimatesCount(contractorId: string, options: {
    status?: string;
    search?: string;
  } = {}): Promise<number> {
    const conditions = [eq(estimates.contractorId, contractorId)];
    
    if (options.status) {
      conditions.push(eq(estimates.status, options.status as any));
    }
    
    if (options.search) {
      conditions.push(
        or(
          ilike(estimates.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    const result = await db.select({ count: count() })
      .from(estimates)
      .leftJoin(contacts, eq(estimates.contactId, contacts.id))
      .where(and(...conditions));
    
    return result[0].count;
  }

  async getEstimatesStatusCounts(contractorId: string, options: {
    search?: string;
  } = {}): Promise<{
    all: number;
    sent: number;
    pending: number;
    approved: number;
    rejected: number;
  }> {
    const baseConditions = [eq(estimates.contractorId, contractorId)];
    
    if (options.search) {
      baseConditions.push(
        or(
          ilike(estimates.title, `%${options.search}%`),
          ilike(contacts.name, `%${options.search}%`)
        )!
      );
    }

    // Get counts for each status in a single query using conditional aggregation
    const result = await db.select({
      all: count(),
      sent: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'sent' THEN 1 END)`,
      pending: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'pending' THEN 1 END)`,
      approved: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'approved' THEN 1 END)`,
      rejected: sql<number>`COUNT(CASE WHEN ${estimates.status} = 'rejected' THEN 1 END)`,
    })
      .from(estimates)
      .leftJoin(contacts, eq(estimates.contactId, contacts.id))
      .where(and(...baseConditions));
    
    const counts = result[0];
    return {
      all: Number(counts.all),
      sent: Number(counts.sent),
      pending: Number(counts.pending),
      approved: Number(counts.approved),
      rejected: Number(counts.rejected),
    };
  }

  async getEstimate(id: string, contractorId: string): Promise<Estimate | undefined> {
    const result = await db.select().from(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createEstimate(estimate: Omit<InsertEstimate, 'contractorId'>, contractorId: string): Promise<Estimate> {
    // Validate that the contact belongs to the same contractor
    if (estimate.contactId) {
      const contact = await this.getContact(estimate.contactId, contractorId);
      if (!contact) {
        throw new Error('Contact not found or does not belong to this contractor');
      }
    }
    
    const result = await db.insert(estimates).values({ ...estimate, contractorId }).returning();
    return result[0];
  }

  async updateEstimate(id: string, estimate: UpdateEstimate, contractorId: string): Promise<Estimate | undefined> {
    const result = await db.update(estimates)
      .set({ ...estimate, updatedAt: new Date() })
      .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async deleteEstimate(id: string, contractorId: string): Promise<boolean> {
    // First, delete all associated activities
    await db.delete(activities)
      .where(and(
        eq(activities.estimateId, id),
        eq(activities.contractorId, contractorId)
      ));
    
    // Then delete the estimate
    const result = await db.delete(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
      .returning();
    return result.length > 0;
  }

  // Dashboard metrics
  async getDashboardMetrics(contractorId: string, userId: string, userRole: string, startDate?: Date, endDate?: Date): Promise<{
    speedToLeadMinutes: number;
    setRate: number;
    totalLeads: number;
    todaysFollowUps: number;
  }> {
    const conditions = [eq(contacts.contractorId, contractorId), eq(contacts.type, 'lead')];
    
    if (startDate) {
      conditions.push(gte(contacts.createdAt, startDate));
    }
    
    if (endDate) {
      conditions.push(lte(contacts.createdAt, endDate));
    }

    const allLeads = await db
      .select()
      .from(contacts)
      .where(and(...conditions));

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
      ? allLeads.filter(contact => contact.status === "scheduled")
      : allLeads.filter(contact => contact.status === "scheduled" && contact.scheduledByUserId === userId);
    
    const totalLeadsForUser = isAdmin ? totalLeads : allLeads.filter(contact => 
      contact.contactedByUserId === userId || contact.scheduledByUserId === userId
    ).length;
    
    const setRate = totalLeadsForUser > 0 ? (scheduledLeadsForUser.length / totalLeadsForUser) * 100 : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const allLeadsForFollowUp = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.contractorId, contractorId),
          eq(contacts.type, 'lead'),
          gte(contacts.followUpDate, today),
          lt(contacts.followUpDate, tomorrow)
        )
      );
    
    const todaysFollowUps = allLeadsForFollowUp.length;

    return {
      speedToLeadMinutes: Math.round(speedToLeadMinutes * 10) / 10,
      setRate: Math.round(setRate * 10) / 10,
      totalLeads,
      todaysFollowUps,
    };
  }

  // Message operations
  async getMessages(contractorId: string, contactId?: string, estimateId?: string): Promise<Message[]> {
    let conditions = [eq(messages.contractorId, contractorId)];
    
    if (contactId) {
      conditions.push(eq(messages.contactId, contactId));
    }
    
    if (estimateId) {
      conditions.push(eq(messages.estimateId, estimateId));
    }
    
    const result = await db.select().from(messages).where(and(...conditions));
    return result;
  }

  async getMessage(id: string, contractorId: string): Promise<Message | undefined> {
    const result = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createMessage(message: Omit<InsertMessage, 'contractorId'>, contractorId: string): Promise<Message> {
    const result = await db
      .insert(messages)
      .values({ ...message, contractorId })
      .returning();
    return result[0];
  }

  // Enhanced message operations for unified communications
  async getAllMessages(contractorId: string, options: {
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Message[]> {
    let conditions = [eq(messages.contractorId, contractorId)];
    
    if (options.type) {
      conditions.push(eq(messages.type, options.type));
    }
    
    if (options.status) {
      conditions.push(eq(messages.status, options.status));
    }
    
    if (options.search) {
      // Use lower() for database-agnostic case-insensitive search (works with SQLite and PostgreSQL)
      conditions.push(like(sql`lower(${messages.content})`, `%${options.search.toLowerCase()}%`));
    }
    
    const result = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);
    
    return result;
  }

  async getConversations(contractorId: string, options: {
    search?: string;
    type?: 'text' | 'email';
    status?: 'sent' | 'delivered' | 'failed';
  } = {}): Promise<Array<{
    contactId: string;
    contactName: string;
    contactPhone?: string;
    contactEmail?: string;
    lastMessage: Message;
    unreadCount: number;
    totalMessages: number;
  }>> {
    // Build query conditions for filtering SMS messages
    let smsConditions = [eq(messages.contractorId, contractorId)];
    
    // Only query SMS messages if type is not specifically 'email'
    if (options.type !== 'email') {
      if (options.type) {
        smsConditions.push(eq(messages.type, options.type));
      }
      
      if (options.status) {
        smsConditions.push(eq(messages.status, options.status));
      }
      
      if (options.search) {
        smsConditions.push(like(sql`lower(${messages.content})`, `%${options.search.toLowerCase()}%`));
      }
    }

    // Build query conditions for filtering email activities
    let emailConditions = [
      eq(activities.contractorId, contractorId),
      eq(activities.type, 'email')
    ];
    
    // Only query email activities if type is not specifically 'text'
    if (options.type !== 'text') {
      if (options.search) {
        emailConditions.push(like(sql`lower(${activities.content})`, `%${options.search.toLowerCase()}%`));
      }
      // Note: Email activities don't have a 'status' field, so we skip status filtering for emails
    }

    // Fetch SMS messages and email activities in parallel
    const [smsMessages, emailActivities] = await Promise.all([
      options.type === 'email' ? Promise.resolve([]) : db
        .select()
        .from(messages)
        .where(and(...smsConditions))
        .orderBy(desc(messages.createdAt)),
      options.type === 'text' ? Promise.resolve([]) : db
        .select({
          id: activities.id,
          content: activities.content,
          contactId: activities.contactId,
          estimateId: activities.estimateId,
          userId: activities.userId,
          contractorId: activities.contractorId,
          createdAt: activities.createdAt,
          metadata: activities.metadata,
          userName: users.name,
        })
        .from(activities)
        .leftJoin(users, eq(activities.userId, users.id))
        .where(and(...emailConditions))
        .orderBy(desc(activities.createdAt))
    ]);

    // Transform email activities to Message format
    const emailMessages = emailActivities.map(activity => {
      const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
      return {
        id: activity.id,
        type: 'email' as const,
        status: 'sent' as const,
        direction: metadata.direction || 'outbound',
        content: activity.content || '',
        toNumber: metadata.to?.[0] || '', // Use first recipient email
        fromNumber: metadata.from || '', // Use sender email
        contactId: activity.contactId,
        estimateId: activity.estimateId,
        userId: activity.userId,
        externalMessageId: metadata.messageId || null,
        contractorId: activity.contractorId,
        createdAt: activity.createdAt,
        userName: activity.userName,
      };
    });

    // Merge SMS messages and email messages
    const filteredMessages = [...smsMessages, ...emailMessages as Message[]];
    filteredMessages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // If search/filters are applied, we only want conversations that contain matching messages
    let allMessages: Message[];
    if (options.search || options.type || options.status) {
      // Get unique contact IDs from filtered messages
      const conversationKeys = new Set<string>();
      filteredMessages.forEach(msg => {
        if (msg.contactId) {
          conversationKeys.add(msg.contactId);
        }
      });

      if (conversationKeys.size === 0) {
        return []; // No conversations match the search criteria
      }

      // Get all messages AND email activities for conversations that had matching messages/emails
      const contactIds = Array.from(conversationKeys);

      // Query all messages and email activities for these specific conversations in parallel
      const conversationQueries = contactIds.map(async (contactId) => {
        let smsContactConditions = [
          eq(messages.contractorId, contractorId),
          eq(messages.contactId, contactId)
        ];
        let emailContactConditions = [
          eq(activities.contractorId, contractorId),
          eq(activities.type, 'email'),
          eq(activities.contactId, contactId)
        ];
        
        const [contactSms, contactEmails] = await Promise.all([
          db
            .select()
            .from(messages)
            .where(and(...smsContactConditions))
            .orderBy(desc(messages.createdAt)),
          db
            .select({
              id: activities.id,
              content: activities.content,
              contactId: activities.contactId,
              estimateId: activities.estimateId,
              userId: activities.userId,
              contractorId: activities.contractorId,
              createdAt: activities.createdAt,
              metadata: activities.metadata,
              userName: users.name,
            })
            .from(activities)
            .leftJoin(users, eq(activities.userId, users.id))
            .where(and(...emailContactConditions))
            .orderBy(desc(activities.createdAt))
        ]);
        
        // Transform email activities to Message format
        const contactEmailMessages = contactEmails.map(activity => {
          const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
          return {
            id: activity.id,
            type: 'email' as const,
            status: 'sent' as const,
            direction: metadata.direction || 'outbound',
            content: activity.content || '',
            toNumber: metadata.to?.[0] || '',
            fromNumber: metadata.from || '',
            contactId: activity.contactId,
            estimateId: activity.estimateId,
            userId: activity.userId,
            externalMessageId: metadata.messageId || null,
            contractorId: activity.contractorId,
            createdAt: activity.createdAt,
            userName: activity.userName,
          };
        });
        
        return [...contactSms, ...contactEmailMessages as Message[]];
      });

      const conversationResults = await Promise.all(conversationQueries);
      allMessages = conversationResults.flat();
    } else {
      // No filters applied, get all messages and email activities
      const [allSms, allEmailActivities] = await Promise.all([
        db
          .select()
          .from(messages)
          .where(eq(messages.contractorId, contractorId))
          .orderBy(desc(messages.createdAt)),
        db
          .select({
            id: activities.id,
            content: activities.content,
            contactId: activities.contactId,
            estimateId: activities.estimateId,
            userId: activities.userId,
            contractorId: activities.contractorId,
            createdAt: activities.createdAt,
            metadata: activities.metadata,
            userName: users.name,
          })
          .from(activities)
          .leftJoin(users, eq(activities.userId, users.id))
          .where(and(
            eq(activities.contractorId, contractorId),
            eq(activities.type, 'email')
          ))
          .orderBy(desc(activities.createdAt))
      ]);
      
      // Transform email activities to Message format
      const allEmailMessages = allEmailActivities.map(activity => {
        const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
        return {
          id: activity.id,
          type: 'email' as const,
          status: 'sent' as const,
          direction: metadata.direction || 'outbound',
          content: activity.content || '',
          toNumber: metadata.to?.[0] || '',
          fromNumber: metadata.from || '',
          contactId: activity.contactId,
          estimateId: activity.estimateId,
          userId: activity.userId,
          externalMessageId: metadata.messageId || null,
          contractorId: activity.contractorId,
          createdAt: activity.createdAt,
          userName: activity.userName,
        };
      });
      
      allMessages = [...allSms, ...allEmailMessages as Message[]];
    }

    // Group messages by contactId
    const conversationMap = new Map<string, {
      contactId: string;
      messages: Message[];
    }>();

    for (const message of allMessages) {
      if (!message.contactId) continue;

      if (!conversationMap.has(message.contactId)) {
        conversationMap.set(message.contactId, {
          contactId: message.contactId,
          messages: []
        });
      }

      conversationMap.get(message.contactId)!.messages.push(message);
    }

    // Build conversation list with contact details
    const conversations = [];
    
    for (const [contactId, conversation] of Array.from(conversationMap.entries())) {
      let contactName = 'Unknown';
      let contactPhone: string | undefined;
      let contactEmail: string | undefined;

      // Get contact details from unified contacts table
      const contact = await this.getContact(contactId, contractorId);
      if (contact) {
        contactName = contact.name;
        contactPhone = contact.phones?.[0] || undefined;
        contactEmail = contact.emails?.[0] || undefined;
      }

      conversations.push({
        contactId,
        contactName,
        contactPhone,
        contactEmail,
        lastMessage: conversation.messages[0], // Already sorted by newest first
        unreadCount: 0, // TODO: Implement read/unread tracking
        totalMessages: conversation.messages.length
      });
    }

    // Sort by last message time
    conversations.sort((a, b) => 
      new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
    );

    return conversations;
  }

  async getConversationMessages(contractorId: string, contactId: string): Promise<Message[]> {
    console.log(`[getConversationMessages] Called with contactId: ${contactId}`);
    
    // Get contact's phone numbers and emails from unified contacts table
    const contact = await db
      .select({ phones: contacts.phones, emails: contacts.emails })
      .from(contacts)
      .where(and(
        eq(contacts.id, contactId),
        eq(contacts.contractorId, contractorId)
      ))
      .limit(1);
    
    const contactPhones = contact[0]?.phones || [];
    const contactEmails = contact[0]?.emails || [];
    
    console.log(`[getConversationMessages] Contact phones: ${JSON.stringify(contactPhones)}, emails: ${JSON.stringify(contactEmails)}`);
    
    // Build conditions to match messages by contactId
    let messageConditions = [
      eq(messages.contractorId, contractorId),
      eq(messages.contactId, contactId)
    ];
    
    const smsMessages = await db
      .select({
        id: messages.id,
        type: messages.type,
        status: messages.status,
        direction: messages.direction,
        content: messages.content,
        toNumber: messages.toNumber,
        fromNumber: messages.fromNumber,
        contactId: messages.contactId,
        estimateId: messages.estimateId,
        userId: messages.userId,
        externalMessageId: messages.externalMessageId,
        contractorId: messages.contractorId,
        createdAt: messages.createdAt,
        userName: users.name,
      })
      .from(messages)
      .leftJoin(users, eq(messages.userId, users.id))
      .where(and(...messageConditions));
    
    console.log(`[getConversationMessages] Found ${smsMessages.length} SMS messages`);
    
    // Get email activities from activities table
    let activityConditions = [
      eq(activities.contractorId, contractorId),
      eq(activities.type, 'email'),
      eq(activities.contactId, contactId)
    ];
    
    const emailActivities = await db
      .select({
        id: activities.id,
        content: activities.content,
        contactId: activities.contactId,
        estimateId: activities.estimateId,
        userId: activities.userId,
        contractorId: activities.contractorId,
        createdAt: activities.createdAt,
        metadata: activities.metadata,
        userName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(and(...activityConditions));
    
    // Transform email activities to Message format
    const emailMessages = emailActivities.map(activity => {
      const metadata = activity.metadata ? JSON.parse(activity.metadata) : {};
      return {
        id: activity.id,
        type: 'email' as const,
        status: 'sent' as const,
        direction: metadata.direction || 'outbound',
        content: activity.content || '',
        toNumber: metadata.to?.[0] || '', // Use first recipient email
        fromNumber: metadata.from || '', // Use sender email
        contactId: activity.contactId,
        estimateId: activity.estimateId,
        userId: activity.userId,
        externalMessageId: metadata.messageId || null,
        contractorId: activity.contractorId,
        createdAt: activity.createdAt,
        userName: activity.userName,
      };
    });
    
    // Merge and sort by createdAt (oldest first for chat interface)
    const allMessages = [...smsMessages, ...emailMessages as Message[]];
    allMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    return allMessages;
  }

  async getConversationMessageCount(contractorId: string, contactId: string): Promise<number> {
    // Count SMS messages
    const smsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(
        eq(messages.contractorId, contractorId),
        eq(messages.contactId, contactId)
      ));
    
    // Count email activities
    const emailResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(
        eq(activities.contractorId, contractorId),
        eq(activities.type, 'email'),
        eq(activities.contactId, contactId)
      ));
    
    return (smsResult[0]?.count || 0) + (emailResult[0]?.count || 0);
  }

  // Template operations
  async getTemplates(contractorId: string, type?: 'text' | 'email'): Promise<Template[]> {
    let conditions = [eq(templates.contractorId, contractorId)];
    
    if (type) {
      conditions.push(eq(templates.type, type));
    }
    
    const result = await db.select().from(templates).where(and(...conditions));
    return result;
  }

  async getTemplate(id: string, contractorId: string): Promise<Template | undefined> {
    const result = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createTemplate(template: Omit<InsertTemplate, 'contractorId'>, contractorId: string): Promise<Template> {
    const result = await db
      .insert(templates)
      .values({ ...template, contractorId })
      .returning();
    return result[0];
  }

  async updateTemplate(id: string, template: UpdateTemplate, contractorId: string): Promise<Template | undefined> {
    const result = await db
      .update(templates)
      .set({ ...template, updatedAt: new Date() })
      .where(and(eq(templates.id, id), eq(templates.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async deleteTemplate(id: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.contractorId, contractorId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Call operations
  async getCalls(contractorId: string): Promise<Call[]> {
    return await db.select().from(calls).where(eq(calls.contractorId, contractorId));
  }

  async getCall(id: string, contractorId: string): Promise<Call | undefined> {
    const result = await db
      .select()
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async getCallByExternalId(externalCallId: string, contractorId: string): Promise<Call | undefined> {
    const result = await db
      .select()
      .from(calls)
      .where(and(eq(calls.externalCallId, externalCallId), eq(calls.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createCall(call: Omit<InsertCall, 'contractorId'>, contractorId: string): Promise<Call> {
    const result = await db
      .insert(calls)
      .values({ ...call, contractorId })
      .returning();
    return result[0];
  }

  async updateCall(id: string, call: UpdateCall, contractorId: string): Promise<Call | undefined> {
    const result = await db
      .update(calls)
      .set({ ...call, updatedAt: new Date() })
      .where(and(eq(calls.id, id), eq(calls.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  // Contractor credential operations
  async getContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<ContractorCredential | undefined> {
    const result = await db
      .select()
      .from(contractorCredentials)
      .where(and(
        eq(contractorCredentials.contractorId, contractorId),
        eq(contractorCredentials.service, service),
        eq(contractorCredentials.credentialKey, credentialKey)
      ))
      .limit(1);
    return result[0];
  }

  async getContractorServiceCredentials(contractorId: string, service: string): Promise<ContractorCredential[]> {
    return await db
      .select()
      .from(contractorCredentials)
      .where(and(
        eq(contractorCredentials.contractorId, contractorId),
        eq(contractorCredentials.service, service)
      ));
  }

  async setContractorCredential(contractorId: string, service: string, credentialKey: string, encryptedValue: string): Promise<ContractorCredential> {
    // Check if credential already exists
    const existing = await this.getContractorCredential(contractorId, service, credentialKey);
    
    if (existing) {
      // Update existing credential
      const result = await db
        .update(contractorCredentials)
        .set({ 
          encryptedValue, 
          isActive: true,
          updatedAt: new Date() 
        })
        .where(and(
          eq(contractorCredentials.contractorId, contractorId),
          eq(contractorCredentials.service, service),
          eq(contractorCredentials.credentialKey, credentialKey)
        ))
        .returning();
      return result[0];
    } else {
      // Create new credential
      const result = await db
        .insert(contractorCredentials)
        .values({
          contractorId,
          service,
          credentialKey,
          encryptedValue,
          isActive: true
        })
        .returning();
      return result[0];
    }
  }

  async disableContractorCredential(contractorId: string, service: string, credentialKey: string): Promise<void> {
    await db
      .update(contractorCredentials)
      .set({ 
        isActive: false,
        updatedAt: new Date() 
      })
      .where(and(
        eq(contractorCredentials.contractorId, contractorId),
        eq(contractorCredentials.service, service),
        eq(contractorCredentials.credentialKey, credentialKey)
      ));
  }

  // Tenant provider operations
  async getTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<ContractorProvider | undefined> {
    const result = await db
      .select()
      .from(contractorProviders)
      .where(and(
        eq(contractorProviders.contractorId, contractorId),
        eq(contractorProviders.providerType, providerType),
        eq(contractorProviders.isActive, true)
      ))
      .limit(1);
    return result[0];
  }

  async setTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling', providerName: string): Promise<ContractorProvider> {
    // Check if provider preference already exists (regardless of isActive status)
    const existingResult = await db
      .select()
      .from(contractorProviders)
      .where(and(
        eq(contractorProviders.contractorId, contractorId),
        eq(contractorProviders.providerType, providerType)
      ))
      .limit(1);
    
    const existing = existingResult[0];
    
    if (existing) {
      // Update existing provider preference
      const updateData: any = {
        isActive: true,
        updatedAt: new Date()
      };
      
      // Set only the appropriate provider field based on type
      if (providerType === 'email') {
        updateData.emailProvider = providerName;
      } else if (providerType === 'sms') {
        updateData.smsProvider = providerName;
      } else if (providerType === 'calling') {
        updateData.callingProvider = providerName;
      }
      
      const result = await db
        .update(contractorProviders)
        .set(updateData)
        .where(and(
          eq(contractorProviders.contractorId, contractorId),
          eq(contractorProviders.providerType, providerType)
        ))
        .returning();
      return result[0];
    } else {
      // Create new provider preference
      const insertData: any = {
        contractorId,
        providerType,
        isActive: true
      };
      
      // Set only the appropriate provider field based on type
      if (providerType === 'email') {
        insertData.emailProvider = providerName;
      } else if (providerType === 'sms') {
        insertData.smsProvider = providerName;
      } else if (providerType === 'calling') {
        insertData.callingProvider = providerName;
      }
      
      const result = await db
        .insert(contractorProviders)
        .values(insertData)
        .returning();
      return result[0];
    }
  }

  async getTenantProviders(contractorId: string): Promise<ContractorProvider[]> {
    return await db
      .select()
      .from(contractorProviders)
      .where(and(
        eq(contractorProviders.contractorId, contractorId),
        eq(contractorProviders.isActive, true)
      ));
  }

  async disableTenantProvider(contractorId: string, providerType: 'email' | 'sms' | 'calling'): Promise<void> {
    await db
      .update(contractorProviders)
      .set({ 
        isActive: false,
        updatedAt: new Date() 
      })
      .where(and(
        eq(contractorProviders.contractorId, contractorId),
        eq(contractorProviders.providerType, providerType)
      ));
  }

  // Tenant integration enablement operations
  async getTenantIntegration(contractorId: string, integrationName: string): Promise<ContractorIntegration | undefined> {
    const result = await db
      .select()
      .from(contractorIntegrations)
      .where(and(
        eq(contractorIntegrations.contractorId, contractorId),
        eq(contractorIntegrations.integrationName, integrationName)
      ))
      .limit(1);
    return result[0];
  }

  async getTenantIntegrations(contractorId: string): Promise<ContractorIntegration[]> {
    return await db
      .select()
      .from(contractorIntegrations)
      .where(eq(contractorIntegrations.contractorId, contractorId))
      .orderBy(asc(contractorIntegrations.integrationName));
  }

  async getEnabledIntegrations(contractorId: string): Promise<ContractorIntegration[]> {
    return await db
      .select()
      .from(contractorIntegrations)
      .where(and(
        eq(contractorIntegrations.contractorId, contractorId),
        eq(contractorIntegrations.isEnabled, true)
      ))
      .orderBy(asc(contractorIntegrations.integrationName));
  }

  async enableTenantIntegration(contractorId: string, integrationName: string, enabledBy?: string): Promise<ContractorIntegration> {
    const now = new Date();
    
    // Check if record already exists
    const existing = await this.getTenantIntegration(contractorId, integrationName);
    
    if (existing) {
      // Update existing record to enable it
      const result = await db
        .update(contractorIntegrations)
        .set({
          isEnabled: true,
          enabledAt: now,
          disabledAt: null,
          enabledBy,
          updatedAt: now
        })
        .where(and(
          eq(contractorIntegrations.contractorId, contractorId),
          eq(contractorIntegrations.integrationName, integrationName)
        ))
        .returning();
      return result[0];
    } else {
      // Create new enabled record
      const result = await db
        .insert(contractorIntegrations)
        .values({
          contractorId,
          integrationName,
          isEnabled: true,
          enabledAt: now,
          enabledBy,
          createdAt: now,
          updatedAt: now
        })
        .returning();
      return result[0];
    }
  }

  async disableTenantIntegration(contractorId: string, integrationName: string): Promise<void> {
    const now = new Date();
    
    await db
      .update(contractorIntegrations)
      .set({
        isEnabled: false,
        disabledAt: now,
        updatedAt: now
      })
      .where(and(
        eq(contractorIntegrations.contractorId, contractorId),
        eq(contractorIntegrations.integrationName, integrationName)
      ));
  }

  async isIntegrationEnabled(contractorId: string, integrationName: string): Promise<boolean> {
    const result = await db
      .select({ isEnabled: contractorIntegrations.isEnabled })
      .from(contractorIntegrations)
      .where(and(
        eq(contractorIntegrations.contractorId, contractorId),
        eq(contractorIntegrations.integrationName, integrationName)
      ))
      .limit(1);
    
    return result[0]?.isEnabled ?? false;
  }

  // Housecall Pro integration operations
  async getContactByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Contact | undefined> {
    const result = await db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.housecallProEstimateId, housecallProEstimateId),
        eq(contacts.contractorId, contractorId),
        eq(contacts.type, 'lead')
      ))
      .limit(1);
    return result[0];
  }

  async getEstimateByHousecallProEstimateId(housecallProEstimateId: string, contractorId: string): Promise<Estimate | undefined> {
    const result = await db
      .select()
      .from(estimates)
      .where(and(
        eq(estimates.externalId, housecallProEstimateId),
        eq(estimates.externalSource, 'housecall-pro'),
        eq(estimates.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getEstimatesByHousecallProIds(housecallProEstimateIds: string[], contractorId: string): Promise<Map<string, Estimate>> {
    if (housecallProEstimateIds.length === 0) {
      return new Map();
    }
    const result = await db
      .select()
      .from(estimates)
      .where(and(
        inArray(estimates.externalId, housecallProEstimateIds),
        eq(estimates.externalSource, 'housecall-pro'),
        eq(estimates.contractorId, contractorId)
      ));
    const estimateMap = new Map<string, Estimate>();
    for (const estimate of result) {
      if (estimate.externalId) {
        estimateMap.set(estimate.externalId, estimate);
      }
    }
    return estimateMap;
  }

  async getScheduledContacts(contractorId: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.contractorId, contractorId),
        eq(contacts.isScheduled, true),
        eq(contacts.type, 'lead')
      ))
      .orderBy(desc(contacts.scheduledAt));
  }

  async getUnscheduledContacts(contractorId: string): Promise<Contact[]> {
    return await db
      .select()
      .from(contacts)
      .where(and(
        eq(contacts.contractorId, contractorId),
        eq(contacts.isScheduled, false),
        eq(contacts.type, 'lead')
      ))
      .orderBy(desc(contacts.createdAt));
  }

  async scheduleContactAsEstimate(contactId: string, housecallProData: {
    housecallProCustomerId: string;
    housecallProEstimateId: string;
    scheduledAt: Date;
    scheduledEmployeeId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    description?: string;
  }, contractorId: string): Promise<{ contact: Contact; estimate: Estimate } | undefined> {
    // Get the original contact data first
    const originalContact = await this.getContact(contactId, contractorId);
    if (!originalContact) {
      return undefined;
    }

    // Use database transaction to ensure atomicity
    return await db.transaction(async (tx) => {
      // Update the contact with Housecall Pro data
      const [updatedContact] = await tx
        .update(contacts)
        .set({
          housecallProCustomerId: housecallProData.housecallProCustomerId,
          housecallProEstimateId: housecallProData.housecallProEstimateId,
          scheduledAt: housecallProData.scheduledAt,
          scheduledEmployeeId: housecallProData.scheduledEmployeeId,
          isScheduled: true,
          updatedAt: new Date()
        })
        .where(and(
          eq(contacts.id, contactId),
          eq(contacts.contractorId, contractorId)
        ))
        .returning();

      // Create corresponding estimate record
      const [newEstimate] = await tx
        .insert(estimates)
        .values({
          title: `Estimate for ${originalContact.name}`,
          contactId: contactId,
          description: housecallProData.description || `Estimate for ${originalContact.name}`,
          amount: '0.00', // Default amount, to be filled in during estimation
          status: 'draft',
          contractorId: contractorId,
          externalId: housecallProData.housecallProEstimateId,
          externalSource: 'housecall-pro',
          scheduledStart: housecallProData.scheduledStart,
          scheduledEnd: housecallProData.scheduledEnd,
          syncedAt: new Date()
        })
        .returning();

      return {
        contact: updatedContact,
        estimate: newEstimate
      };
    });
  }

  // Activity operations
  async getActivities(contractorId: string, options: {
    contactId?: string;
    estimateId?: string;
    jobId?: string;
    type?: 'note' | 'call' | 'email' | 'sms' | 'meeting' | 'follow_up' | 'status_change';
    limit?: number;
    offset?: number;
  } = {}): Promise<Activity[]> {
    let conditions = [eq(activities.contractorId, contractorId)];
    
    // Always filter out activities that aren't assigned to any entity
    // Activities must have at least one of: contactId, estimateId, or jobId
    conditions.push(or(
      isNotNull(activities.contactId),
      isNotNull(activities.estimateId),
      isNotNull(activities.jobId)
    )!);
    
    if (options.contactId) {
      conditions.push(eq(activities.contactId, options.contactId));
    }
    
    if (options.estimateId) {
      conditions.push(eq(activities.estimateId, options.estimateId));
    }
    
    if (options.jobId) {
      conditions.push(eq(activities.jobId, options.jobId));
    }
    
    if (options.type) {
      conditions.push(eq(activities.type, options.type));
    }
    
    const result = await db
      .select({
        id: activities.id,
        type: activities.type,
        title: activities.title,
        content: activities.content,
        contactId: activities.contactId,
        estimateId: activities.estimateId,
        jobId: activities.jobId,
        userId: activities.userId,
        contractorId: activities.contractorId,
        createdAt: activities.createdAt,
        updatedAt: activities.updatedAt,
        userName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(activities.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(activities.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);
    
    return result as Activity[];
  }

  async getActivity(id: string, contractorId: string): Promise<Activity | undefined> {
    const result = await db
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), eq(activities.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async createActivity(activity: Omit<InsertActivity, 'contractorId'>, contractorId: string): Promise<Activity> {
    const result = await db
      .insert(activities)
      .values({ ...activity, contractorId })
      .returning();
    return result[0];
  }

  async updateActivity(id: string, activity: UpdateActivity, contractorId: string): Promise<Activity | undefined> {
    const result = await db
      .update(activities)
      .set({ ...activity, updatedAt: new Date() })
      .where(and(eq(activities.id, id), eq(activities.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  async deleteActivity(id: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(activities)
      .where(and(eq(activities.id, id), eq(activities.contractorId, contractorId)))
      .returning();
    return result.length > 0;
  }

  // Employee operations
  async getEmployees(contractorId: string): Promise<Employee[]> {
    return await db
      .select()
      .from(employees)
      .where(eq(employees.contractorId, contractorId))
      .orderBy(asc(employees.lastName), asc(employees.firstName));
  }

  async getEmployee(id: string, contractorId: string): Promise<Employee | undefined> {
    const result = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.contractorId, contractorId)))
      .limit(1);
    return result[0];
  }

  async getEmployeeByExternalId(externalId: string, externalSource: string, contractorId: string): Promise<Employee | undefined> {
    const result = await db
      .select()
      .from(employees)
      .where(and(
        eq(employees.externalId, externalId),
        eq(employees.externalSource, externalSource),
        eq(employees.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async upsertEmployees(employeeData: Omit<InsertEmployee, 'contractorId'>[], contractorId: string): Promise<Employee[]> {
    const results: Employee[] = [];
    
    for (const empData of employeeData) {
      // Check if employee already exists
      let existingEmployee: Employee | undefined;
      if (empData.externalId && empData.externalSource) {
        existingEmployee = await this.getEmployeeByExternalId(empData.externalId, empData.externalSource, contractorId);
      }

      if (existingEmployee) {
        // Update existing employee (preserve existing roles if not empty)
        const updateData: UpdateEmployee = {
          firstName: empData.firstName,
          lastName: empData.lastName,
          email: empData.email,
          isActive: empData.isActive,
          externalRole: empData.externalRole,
          // Only update roles if current roles are empty and we have external role to map
          ...(existingEmployee.roles.length === 0 && empData.externalRole ? {
            roles: this.mapExternalRoleToInternalRoles(empData.externalRole)
          } : {})
        };

        const result = await db
          .update(employees)
          .set(updateData)
          .where(eq(employees.id, existingEmployee.id))
          .returning();
        
        results.push(result[0]);
      } else {
        // Create new employee
        const newEmployee = await db
          .insert(employees)
          .values({
            ...empData,
            contractorId,
            roles: empData.externalRole ? this.mapExternalRoleToInternalRoles(empData.externalRole) : [],
            createdAt: new Date(),
            updatedAt: new Date()
          })
          .returning();
        
        results.push(newEmployee[0]);
      }
    }
    
    return results;
  }

  async updateEmployeeRoles(id: string, roles: string[], contractorId: string): Promise<Employee | undefined> {
    const result = await db
      .update(employees)
      .set({ 
        roles,
        updatedAt: new Date()
      })
      .where(and(eq(employees.id, id), eq(employees.contractorId, contractorId)))
      .returning();
    return result[0];
  }

  // Helper method to map Housecall Pro roles to internal roles
  private mapExternalRoleToInternalRoles(externalRole: string): string[] {
    const role = externalRole.toLowerCase();
    
    if (role.includes('field') || role.includes('technician')) {
      return ['technician'];
    } else if (role.includes('estimator')) {
      return ['estimator'];
    } else if (role.includes('sales')) {
      return ['sales'];
    } else if (role.includes('dispatch')) {
      return ['dispatcher'];
    } else if (role.includes('admin') || role.includes('manager')) {
      return ['manager'];
    }
    
    // Default mapping
    return ['technician'];
  }

  // Housecall Pro sync start date operations
  async getHousecallProSyncStartDate(contractorId: string): Promise<Date | null> {
    const result = await db
      .select({ housecallProSyncStartDate: contractors.housecallProSyncStartDate })
      .from(contractors)
      .where(eq(contractors.id, contractorId))
      .limit(1);
    
    return result[0]?.housecallProSyncStartDate || null;
  }

  async setHousecallProSyncStartDate(contractorId: string, syncStartDate: Date | null): Promise<void> {
    await db
      .update(contractors)
      .set({ housecallProSyncStartDate: syncStartDate })
      .where(eq(contractors.id, contractorId));
  }

  // Business targets operations
  async getBusinessTargets(contractorId: string): Promise<BusinessTargets | undefined> {
    const result = await db
      .select()
      .from(businessTargets)
      .where(eq(businessTargets.contractorId, contractorId))
      .limit(1);
    return result[0];
  }

  async createBusinessTargets(targets: Omit<InsertBusinessTargets, 'contractorId'>, contractorId: string): Promise<BusinessTargets> {
    const result = await db
      .insert(businessTargets)
      .values({ ...targets, contractorId })
      .returning();
    return result[0];
  }

  async updateBusinessTargets(targets: UpdateBusinessTargets, contractorId: string): Promise<BusinessTargets | undefined> {
    const result = await db
      .update(businessTargets)
      .set({ ...targets, updatedAt: new Date() })
      .where(eq(businessTargets.contractorId, contractorId))
      .returning();
    return result[0];
  }

  // Dialpad phone number operations
  async getDialpadPhoneNumbers(contractorId: string): Promise<DialpadPhoneNumber[]> {
    return await db
      .select()
      .from(dialpadPhoneNumbers)
      .where(eq(dialpadPhoneNumbers.contractorId, contractorId))
      .orderBy(asc(dialpadPhoneNumbers.phoneNumber));
  }

  async getDialpadPhoneNumber(id: string, contractorId: string): Promise<DialpadPhoneNumber | undefined> {
    const result = await db
      .select()
      .from(dialpadPhoneNumbers)
      .where(and(
        eq(dialpadPhoneNumbers.id, id),
        eq(dialpadPhoneNumbers.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getDialpadPhoneNumberByNumber(contractorId: string, phoneNumber: string): Promise<DialpadPhoneNumber | undefined> {
    const result = await db
      .select()
      .from(dialpadPhoneNumbers)
      .where(and(
        eq(dialpadPhoneNumbers.contractorId, contractorId),
        eq(dialpadPhoneNumbers.phoneNumber, phoneNumber)
      ))
      .limit(1);
    return result[0];
  }

  async getDialpadPhoneNumbersByIds(ids: string[]): Promise<DialpadPhoneNumber[]> {
    if (ids.length === 0) return [];
    
    return await db
      .select()
      .from(dialpadPhoneNumbers)
      .where(sql`${dialpadPhoneNumbers.id} = ANY(${ids})`);
  }

  async createDialpadPhoneNumber(phoneNumber: InsertDialpadPhoneNumber): Promise<DialpadPhoneNumber> {
    const result = await db
      .insert(dialpadPhoneNumbers)
      .values(phoneNumber)
      .returning();
    return result[0];
  }

  async updateDialpadPhoneNumber(id: string, phoneNumber: UpdateDialpadPhoneNumber): Promise<DialpadPhoneNumber> {
    const result = await db
      .update(dialpadPhoneNumbers)
      .set({ ...phoneNumber, updatedAt: new Date() })
      .where(eq(dialpadPhoneNumbers.id, id))
      .returning();
    return result[0];
  }

  // User phone number permission operations
  async getUserPhoneNumberPermissions(userId: string): Promise<UserPhoneNumberPermission[]> {
    return await db
      .select()
      .from(userPhoneNumberPermissions)
      .where(eq(userPhoneNumberPermissions.userId, userId));
  }

  async getUserPhoneNumberPermission(userId: string, phoneNumberId: string): Promise<UserPhoneNumberPermission | undefined> {
    const result = await db
      .select()
      .from(userPhoneNumberPermissions)
      .where(and(
        eq(userPhoneNumberPermissions.userId, userId),
        eq(userPhoneNumberPermissions.phoneNumberId, phoneNumberId)
      ))
      .limit(1);
    return result[0];
  }

  async createUserPhoneNumberPermission(permission: InsertUserPhoneNumberPermission): Promise<UserPhoneNumberPermission> {
    const result = await db
      .insert(userPhoneNumberPermissions)
      .values(permission)
      .returning();
    return result[0];
  }

  async updateUserPhoneNumberPermission(id: string, permission: UpdateUserPhoneNumberPermission): Promise<UserPhoneNumberPermission> {
    const result = await db
      .update(userPhoneNumberPermissions)
      .set({ ...permission, updatedAt: new Date() })
      .where(eq(userPhoneNumberPermissions.id, id))
      .returning();
    return result[0];
  }

  async deleteUserPhoneNumberPermission(id: string): Promise<boolean> {
    const result = await db
      .delete(userPhoneNumberPermissions)
      .where(eq(userPhoneNumberPermissions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Dialpad caching operations
  async getDialpadUsers(contractorId: string): Promise<DialpadUser[]> {
    return await db
      .select()
      .from(dialpadUsers)
      .where(eq(dialpadUsers.contractorId, contractorId))
      .orderBy(asc(dialpadUsers.fullName));
  }

  async getDialpadUser(id: string, contractorId: string): Promise<DialpadUser | undefined> {
    const result = await db
      .select()
      .from(dialpadUsers)
      .where(and(
        eq(dialpadUsers.id, id),
        eq(dialpadUsers.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getDialpadUserByDialpadId(dialpadUserId: string, contractorId: string): Promise<DialpadUser | undefined> {
    const result = await db
      .select()
      .from(dialpadUsers)
      .where(and(
        eq(dialpadUsers.dialpadUserId, dialpadUserId),
        eq(dialpadUsers.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async createDialpadUser(user: InsertDialpadUser): Promise<DialpadUser> {
    const result = await db
      .insert(dialpadUsers)
      .values(user)
      .returning();
    return result[0];
  }

  async updateDialpadUser(id: string, user: UpdateDialpadUser): Promise<DialpadUser> {
    const result = await db
      .update(dialpadUsers)
      .set({ ...user, updatedAt: new Date() })
      .where(eq(dialpadUsers.id, id))
      .returning();
    return result[0];
  }

  async deleteDialpadUser(id: string): Promise<boolean> {
    const result = await db
      .delete(dialpadUsers)
      .where(eq(dialpadUsers.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getDialpadDepartments(contractorId: string): Promise<DialpadDepartment[]> {
    return await db
      .select()
      .from(dialpadDepartments)
      .where(eq(dialpadDepartments.contractorId, contractorId))
      .orderBy(asc(dialpadDepartments.name));
  }

  async getDialpadDepartment(id: string, contractorId: string): Promise<DialpadDepartment | undefined> {
    const result = await db
      .select()
      .from(dialpadDepartments)
      .where(and(
        eq(dialpadDepartments.id, id),
        eq(dialpadDepartments.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getDialpadDepartmentByDialpadId(dialpadDepartmentId: string, contractorId: string): Promise<DialpadDepartment | undefined> {
    const result = await db
      .select()
      .from(dialpadDepartments)
      .where(and(
        eq(dialpadDepartments.dialpadDepartmentId, dialpadDepartmentId),
        eq(dialpadDepartments.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async createDialpadDepartment(department: InsertDialpadDepartment): Promise<DialpadDepartment> {
    const result = await db
      .insert(dialpadDepartments)
      .values(department)
      .returning();
    return result[0];
  }

  async updateDialpadDepartment(id: string, department: UpdateDialpadDepartment): Promise<DialpadDepartment> {
    const result = await db
      .update(dialpadDepartments)
      .set({ ...department, updatedAt: new Date() })
      .where(eq(dialpadDepartments.id, id))
      .returning();
    return result[0];
  }

  async deleteDialpadDepartment(id: string): Promise<boolean> {
    const result = await db
      .delete(dialpadDepartments)
      .where(eq(dialpadDepartments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getDialpadSyncJobs(contractorId: string, limit = 10): Promise<DialpadSyncJob[]> {
    return await db
      .select()
      .from(dialpadSyncJobs)
      .where(eq(dialpadSyncJobs.contractorId, contractorId))
      .orderBy(desc(dialpadSyncJobs.createdAt))
      .limit(limit);
  }

  async getDialpadSyncJob(id: string, contractorId: string): Promise<DialpadSyncJob | undefined> {
    const result = await db
      .select()
      .from(dialpadSyncJobs)
      .where(and(
        eq(dialpadSyncJobs.id, id),
        eq(dialpadSyncJobs.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getLatestDialpadSyncJob(contractorId: string, syncType?: string): Promise<DialpadSyncJob | undefined> {
    const conditions = [eq(dialpadSyncJobs.contractorId, contractorId)];
    if (syncType) {
      conditions.push(eq(dialpadSyncJobs.syncType, syncType));
    }

    const result = await db
      .select()
      .from(dialpadSyncJobs)
      .where(and(...conditions))
      .orderBy(desc(dialpadSyncJobs.createdAt))
      .limit(1);
    return result[0];
  }

  async createDialpadSyncJob(syncJob: InsertDialpadSyncJob): Promise<DialpadSyncJob> {
    const result = await db
      .insert(dialpadSyncJobs)
      .values(syncJob)
      .returning();
    return result[0];
  }

  async updateDialpadSyncJob(id: string, syncJob: UpdateDialpadSyncJob): Promise<DialpadSyncJob> {
    const result = await db
      .update(dialpadSyncJobs)
      .set({ ...syncJob, updatedAt: new Date() })
      .where(eq(dialpadSyncJobs.id, id))
      .returning();
    return result[0];
  }

  // Sync schedule operations
  async getSyncSchedules(contractorId: string): Promise<SyncSchedule[]> {
    return await db
      .select()
      .from(syncSchedules)
      .where(eq(syncSchedules.contractorId, contractorId))
      .orderBy(asc(syncSchedules.nextSyncAt));
  }

  async getSyncSchedule(contractorId: string, integrationName: string): Promise<SyncSchedule | undefined> {
    const result = await db
      .select()
      .from(syncSchedules)
      .where(and(
        eq(syncSchedules.contractorId, contractorId),
        eq(syncSchedules.integrationName, integrationName)
      ))
      .limit(1);
    return result[0];
  }

  async getDueSyncSchedules(): Promise<SyncSchedule[]> {
    return await db
      .select()
      .from(syncSchedules)
      .where(and(
        eq(syncSchedules.isEnabled, true),
        lte(syncSchedules.nextSyncAt, new Date())
      ))
      .orderBy(asc(syncSchedules.nextSyncAt));
  }

  async createSyncSchedule(schedule: InsertSyncSchedule): Promise<SyncSchedule> {
    const result = await db
      .insert(syncSchedules)
      .values(schedule)
      .returning();
    return result[0];
  }

  async updateSyncSchedule(contractorId: string, integrationName: string, schedule: UpdateSyncSchedule): Promise<SyncSchedule | undefined> {
    const result = await db
      .update(syncSchedules)
      .set({ ...schedule, updatedAt: new Date() })
      .where(and(
        eq(syncSchedules.contractorId, contractorId),
        eq(syncSchedules.integrationName, integrationName)
      ))
      .returning();
    return result[0];
  }

  async deleteSyncSchedule(contractorId: string, integrationName: string): Promise<boolean> {
    const result = await db
      .delete(syncSchedules)
      .where(and(
        eq(syncSchedules.contractorId, contractorId),
        eq(syncSchedules.integrationName, integrationName)
      ))
      .returning();
    return result.length > 0;
  }

  // Terminology settings operations
  async getTerminologySettings(contractorId: string): Promise<TerminologySettings | undefined> {
    const result = await db.select()
      .from(terminologySettings)
      .where(eq(terminologySettings.contractorId, contractorId))
      .limit(1);
    return result[0];
  }

  async createTerminologySettings(
    settings: Omit<InsertTerminologySettings, 'contractorId'>,
    contractorId: string
  ): Promise<TerminologySettings> {
    const result = await db.insert(terminologySettings)
      .values({ ...settings, contractorId })
      .returning();
    return result[0]!;
  }

  async updateTerminologySettings(
    settings: UpdateTerminologySettings,
    contractorId: string
  ): Promise<TerminologySettings | undefined> {
    const result = await db.update(terminologySettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(terminologySettings.contractorId, contractorId))
      .returning();
    return result[0];
  }

  // Notification operations
  async getNotifications(userId: string, contractorId: string, limit: number = 50): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.contractorId, contractorId)
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotifications(userId: string, contractorId: string): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.contractorId, contractorId),
        eq(notifications.read, false)
      ))
      .orderBy(desc(notifications.createdAt));
  }

  async getNotification(id: string, userId: string): Promise<Notification | undefined> {
    const result = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.id, id),
        eq(notifications.userId, userId)
      ))
      .limit(1);
    return result[0];
  }

  async createNotification(
    notification: Omit<InsertNotification, 'contractorId'>,
    contractorId: string
  ): Promise<Notification> {
    const result = await db
      .insert(notifications)
      .values({ ...notification, contractorId })
      .returning();
    return result[0];
  }

  async markNotificationAsRead(id: string, userId: string): Promise<Notification | undefined> {
    const result = await db
      .update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.userId, userId)
      ))
      .returning();
    return result[0];
  }

  async markAllNotificationsAsRead(userId: string, contractorId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.contractorId, contractorId),
        eq(notifications.read, false)
      ));
  }

  async deleteNotification(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(notifications)
      .where(and(
        eq(notifications.id, id),
        eq(notifications.userId, userId)
      ))
      .returning();
    return result.length > 0;
  }

  // Workflow operations
  async getWorkflows(contractorId: string, approvalStatus?: string): Promise<Workflow[]> {
    const conditions = [eq(workflows.contractorId, contractorId)];
    
    if (approvalStatus && approvalStatus !== 'all') {
      conditions.push(eq(workflows.approvalStatus, approvalStatus as any));
    }
    
    return await db
      .select()
      .from(workflows)
      .where(and(...conditions))
      .orderBy(desc(workflows.createdAt));
  }

  async getActiveWorkflows(contractorId: string): Promise<Workflow[]> {
    return await db
      .select()
      .from(workflows)
      .where(and(
        eq(workflows.contractorId, contractorId),
        eq(workflows.isActive, true)
      ))
      .orderBy(desc(workflows.createdAt));
  }

  async getWorkflowsPendingApproval(contractorId: string): Promise<Workflow[]> {
    return await db
      .select()
      .from(workflows)
      .where(and(
        eq(workflows.contractorId, contractorId),
        eq(workflows.approvalStatus, 'pending_approval')
      ))
      .orderBy(desc(workflows.createdAt));
  }

  async getWorkflow(id: string, contractorId: string): Promise<Workflow | undefined> {
    const result = await db
      .select()
      .from(workflows)
      .where(and(
        eq(workflows.id, id),
        eq(workflows.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async createWorkflow(
    workflow: Omit<InsertWorkflow, 'contractorId'>,
    contractorId: string,
    userId: string
  ): Promise<Workflow> {
    // Get user's role for this contractor
    const userContractor = await this.getUserContractor(userId, contractorId);
    
    // Auto-approve for admin and manager roles
    const isAdminOrManager = userContractor && (userContractor.role === 'admin' || userContractor.role === 'manager' || userContractor.role === 'super_admin');
    
    const result = await db
      .insert(workflows)
      .values({ 
        ...workflow,
        contractorId,
        createdBy: userId,
        approvalStatus: isAdminOrManager ? 'approved' : 'pending_approval',
        approvedBy: isAdminOrManager ? userId : null,
        approvedAt: isAdminOrManager ? new Date() : null,
      })
      .returning();
    return result[0];
  }

  async updateWorkflow(
    id: string,
    workflow: UpdateWorkflow,
    contractorId: string
  ): Promise<Workflow | undefined> {
    const result = await db
      .update(workflows)
      .set({ ...workflow, updatedAt: new Date() })
      .where(and(
        eq(workflows.id, id),
        eq(workflows.contractorId, contractorId)
      ))
      .returning();
    return result[0];
  }

  async deleteWorkflow(id: string, contractorId: string): Promise<boolean> {
    const result = await db
      .delete(workflows)
      .where(and(
        eq(workflows.id, id),
        eq(workflows.contractorId, contractorId)
      ))
      .returning();
    return result.length > 0;
  }

  async approveWorkflow(id: string, contractorId: string, approvedByUserId: string): Promise<Workflow | undefined> {
    const result = await db
      .update(workflows)
      .set({ 
        approvalStatus: 'approved',
        approvedBy: approvedByUserId,
        approvedAt: new Date(),
        rejectionReason: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(workflows.id, id),
        eq(workflows.contractorId, contractorId)
      ))
      .returning();
    return result[0];
  }

  async rejectWorkflow(id: string, contractorId: string, rejectedByUserId: string, rejectionReason?: string): Promise<Workflow | undefined> {
    const result = await db
      .update(workflows)
      .set({ 
        approvalStatus: 'rejected',
        approvedBy: rejectedByUserId,
        approvedAt: new Date(),
        rejectionReason: rejectionReason || null,
        updatedAt: new Date()
      })
      .where(and(
        eq(workflows.id, id),
        eq(workflows.contractorId, contractorId)
      ))
      .returning();
    return result[0];
  }

  // Workflow step operations
  async getWorkflowSteps(workflowId: string): Promise<WorkflowStep[]> {
    return await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowId, workflowId))
      .orderBy(asc(workflowSteps.stepOrder));
  }

  async getWorkflowStep(id: string): Promise<WorkflowStep | undefined> {
    const result = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.id, id))
      .limit(1);
    return result[0];
  }

  async createWorkflowStep(step: InsertWorkflowStep): Promise<WorkflowStep> {
    const result = await db
      .insert(workflowSteps)
      .values(step)
      .returning();
    return result[0];
  }

  async updateWorkflowStep(
    id: string,
    step: UpdateWorkflowStep
  ): Promise<WorkflowStep | undefined> {
    const result = await db
      .update(workflowSteps)
      .set({ ...step, updatedAt: new Date() })
      .where(eq(workflowSteps.id, id))
      .returning();
    return result[0];
  }

  async deleteWorkflowStep(id: string): Promise<boolean> {
    const result = await db
      .delete(workflowSteps)
      .where(eq(workflowSteps.id, id))
      .returning();
    return result.length > 0;
  }

  async deleteWorkflowSteps(workflowId: string): Promise<boolean> {
    const result = await db
      .delete(workflowSteps)
      .where(eq(workflowSteps.workflowId, workflowId))
      .returning();
    return result.length > 0;
  }

  // Workflow execution operations
  async getWorkflowExecutions(workflowId: string, contractorId: string, limit: number = 50): Promise<WorkflowExecution[]> {
    return await db
      .select()
      .from(workflowExecutions)
      .where(and(
        eq(workflowExecutions.workflowId, workflowId),
        eq(workflowExecutions.contractorId, contractorId)
      ))
      .orderBy(desc(workflowExecutions.createdAt))
      .limit(limit);
  }

  async getWorkflowExecution(id: string, contractorId: string): Promise<WorkflowExecution | undefined> {
    const result = await db
      .select()
      .from(workflowExecutions)
      .where(and(
        eq(workflowExecutions.id, id),
        eq(workflowExecutions.contractorId, contractorId)
      ))
      .limit(1);
    return result[0];
  }

  async getRecentWorkflowExecutions(contractorId: string, limit: number = 50): Promise<WorkflowExecution[]> {
    return await db
      .select()
      .from(workflowExecutions)
      .where(eq(workflowExecutions.contractorId, contractorId))
      .orderBy(desc(workflowExecutions.createdAt))
      .limit(limit);
  }

  async createWorkflowExecution(
    execution: Omit<InsertWorkflowExecution, 'contractorId'>,
    contractorId: string
  ): Promise<WorkflowExecution> {
    const result = await db
      .insert(workflowExecutions)
      .values({ ...execution, contractorId })
      .returning();
    return result[0];
  }

  async updateWorkflowExecution(
    id: string,
    execution: UpdateWorkflowExecution,
    contractorId: string
  ): Promise<WorkflowExecution | undefined> {
    const result = await db
      .update(workflowExecutions)
      .set(execution)
      .where(and(
        eq(workflowExecutions.id, id),
        eq(workflowExecutions.contractorId, contractorId)
      ))
      .returning();
    return result[0];
  }

  /**
   * Get estimate with related contact data for workflow execution
   */
  async getEstimateWithContact(id: string, contractorId: string): Promise<any> {
    const result = await db
      .select()
      .from(estimates)
      .leftJoin(contacts, eq(estimates.contactId, contacts.id))
      .where(and(eq(estimates.id, id), eq(estimates.contractorId, contractorId)))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    const { estimates: estimate, contacts: contact } = result[0];
    
    // Return estimate with nested contact data
    return {
      ...estimate,
      contact: contact || undefined
    };
  }

  /**
   * Get job with related contact data for workflow execution
   */
  async getJobWithContact(id: string, contractorId: string): Promise<any> {
    const result = await db
      .select()
      .from(jobs)
      .leftJoin(contacts, eq(jobs.contactId, contacts.id))
      .where(and(eq(jobs.id, id), eq(jobs.contractorId, contractorId)))
      .limit(1);
    
    if (!result[0]) return undefined;
    
    const { jobs: job, contacts: contact } = result[0];
    
    // Return job with nested contact data
    return {
      ...job,
      contact: contact || undefined
    };
  }
}

export const storage = new DatabaseStorage();
